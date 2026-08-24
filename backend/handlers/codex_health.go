package handlers

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/tools/remotecommand"
)

// Live Codex auth health for the Dev Hub card and scaffolder pre-flight.
//
// The old status check ("auth.json present and well-formed") stayed green
// through the 2026-08-23 16-hour newsroom outage. This endpoint reports
// what actually matters:
//
//  1. the stored access token's real JWT expiry,
//  2. whether the refresh token is ALIVE — proven by a real refresh against
//     the OpenAI token endpoint (the same form-POST openclaw/codex use).
//     The rotated tokens are persisted back to the Secret only on success;
//     a failed or inconclusive probe never touches stored credentials.
//  3. per-gateway agent auth health — whether each agent's openclaw
//     auth_profile_store still holds an openai oauth profile (the thing
//     openclaw prunes on a refresh hiccup), plus desk activity from the
//     newsroom MCPs where configured.
//
// Note on ESO: codex-subscription-credentials is nominally owned by an
// ExternalSecret. While ESO can read its Vault path it may overwrite a
// probe-persisted rotation with Vault's copy — that is fine: reporting
// never depends on persistence succeeding, and OpenAI keeps the prior
// grant lineage valid.

// Constants mirror openclaw's openai-chatgpt-oauth-flow runtime (which
// itself mirrors openai/codex): form-encoded POST, no client secret.
const (
	codexTokenURL = "https://auth.openai.com/oauth/token"
	codexClientID = "app_EMoamEEZ73f0CkXaXp7hrann"

	gatewayLabelComponent = "app.kubernetes.io/component=agent-gateway"
	gatewayNameLabel      = "agentoffice.ai/gateway"
	codexAuthVolumeName   = "codex-auth-src"
	openclawContainer     = "openclaw"
)

// Probe cache TTLs. A successful refresh rotates the stored tokens, so we
// deliberately do NOT probe on every card view.
const (
	refreshTTLAlive        = 1 * time.Hour
	refreshTTLDead         = 10 * time.Minute
	refreshTTLInconclusive = 5 * time.Minute
	agentProbeTTL          = 2 * time.Minute
	deskTTL                = 1 * time.Minute
)

type CodexAuthHealth struct {
	// Legacy fields the v0.0.5 card understands — kept truthful so a
	// not-yet-updated card stops lying the moment the backend ships.
	OK          bool   `json:"ok"`
	Reason      string `json:"reason,omitempty"`
	LastRefresh string `json:"lastRefresh,omitempty"`

	CheckedAt   string             `json:"checkedAt"`
	Credentials []CredentialHealth `json:"credentials"`
	Gateways    []GatewayHealth    `json:"gateways"`
}

type CredentialHealth struct {
	Secret               string   `json:"secret"`
	SecretExists         bool     `json:"secretExists"`
	AuthMode             string   `json:"authMode,omitempty"`
	AccountID            string   `json:"accountId,omitempty"`
	HasRefreshToken      bool     `json:"hasRefreshToken"`
	AccessTokenExpiresAt string   `json:"accessTokenExpiresAt,omitempty"`
	AccessTokenExpired   bool     `json:"accessTokenExpired"`
	LastRefresh          string   `json:"lastRefresh,omitempty"`
	RefreshAlive         *bool    `json:"refreshAlive"` // null = not proven either way
	RefreshError         string   `json:"refreshError,omitempty"`
	RefreshCheckedAt     string   `json:"refreshCheckedAt,omitempty"`
	Gateways             []string `json:"gateways"`
}

type GatewayHealth struct {
	Name              string            `json:"name"`
	Secret            string            `json:"secret,omitempty"`
	Agents            []AgentAuthHealth `json:"agents"`
	AgentsWithProfile int               `json:"agentsWithProfile"`
	ProbeError        string            `json:"probeError,omitempty"`
	Desk              *DeskHealth       `json:"desk,omitempty"`
	LastActivity      string            `json:"lastActivity,omitempty"`
}

type AgentAuthHealth struct {
	Name             string `json:"name"`
	ProfilePresent   bool   `json:"profilePresent"`
	ProfileExpiresAt string `json:"profileExpiresAt,omitempty"`
	LastUsed         string `json:"lastUsed,omitempty"`
	ErrorCount       int    `json:"errorCount"`
	Error            string `json:"error,omitempty"`
}

type DeskHealth struct {
	URL          string            `json:"url"`
	Verdict      string            `json:"verdict,omitempty"`
	Last         map[string]string `json:"last,omitempty"`
	LastActivity string            `json:"lastActivity,omitempty"`
	Error        string            `json:"error,omitempty"`
}

type refreshProbeResult struct {
	alive     *bool
	err       string
	checkedAt time.Time
	ttl       time.Duration
}

type agentProbeResult struct {
	agents    []AgentAuthHealth
	err       string
	checkedAt time.Time
}

type deskProbeResult struct {
	desk      *DeskHealth
	checkedAt time.Time
}

// GetAuthHealth handles GET /codex-auth/status — the endpoint the Dev Hub
// card and scaffolder pre-flight fetch through Backstage's proxy plugin.
// ?probe=1 bypasses the refresh-probe cache.
func (h *CodexHandler) GetAuthHealth(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()
	force := r.URL.Query().Get("probe") == "1"

	health := CodexAuthHealth{
		CheckedAt:   time.Now().UTC().Format(time.RFC3339),
		Credentials: []CredentialHealth{},
		Gateways:    []GatewayHealth{},
	}

	gateways, err := h.discoverGateways(ctx)
	if err != nil {
		// Without gateway discovery we can still report on the default
		// credential secret rather than nothing at all.
		log.Printf("codex health: gateway discovery failed: %v", err)
	}

	secretNames := map[string][]string{} // secret -> gateway names
	for _, gw := range gateways {
		if gw.secret != "" {
			secretNames[gw.secret] = append(secretNames[gw.secret], gw.name)
		}
	}
	if len(secretNames) == 0 {
		secretNames[codexSecretName] = nil
	}

	// Credential health (JWT expiry + throttled live refresh probe),
	// probed concurrently per unique secret.
	var mu sync.Mutex
	var wg sync.WaitGroup
	for secretName, gwNames := range secretNames {
		wg.Add(1)
		go func(secretName string, gwNames []string) {
			defer wg.Done()
			ch := h.credentialHealth(ctx, secretName, force)
			sort.Strings(gwNames)
			ch.Gateways = gwNames
			mu.Lock()
			health.Credentials = append(health.Credentials, ch)
			mu.Unlock()
		}(secretName, gwNames)
	}

	// Per-gateway agent auth health (exec probe) + desk activity.
	deskURLs := deskURLsFromEnv()
	for _, gw := range gateways {
		wg.Add(1)
		go func(gw gatewayInfo) {
			defer wg.Done()
			gh := GatewayHealth{Name: gw.name, Secret: gw.secret, Agents: []AgentAuthHealth{}}

			probe := h.probeGatewayAgents(ctx, gw.name)
			gh.ProbeError = probe.err
			gh.Agents = h.orderAgents(gw.name, probe.agents)
			for _, a := range gh.Agents {
				if a.ProfilePresent {
					gh.AgentsWithProfile++
				}
			}

			if deskURL := deskURLs[gw.name]; deskURL != "" {
				gh.Desk = h.probeDesk(ctx, deskURL)
			}
			gh.LastActivity = latestActivity(gh)

			mu.Lock()
			health.Gateways = append(health.Gateways, gh)
			mu.Unlock()
		}(gw)
	}
	wg.Wait()

	sort.Slice(health.Credentials, func(i, j int) bool { return health.Credentials[i].Secret < health.Credentials[j].Secret })
	sort.Slice(health.Gateways, func(i, j int) bool { return health.Gateways[i].Name < health.Gateways[j].Name })

	// Overall verdict: every credential set must either have a proven-alive
	// refresh token or an unexpired access token with no proof of death.
	health.OK = true
	for _, c := range health.Credentials {
		healthy := false
		switch {
		case c.RefreshAlive != nil && *c.RefreshAlive:
			healthy = true
		case c.RefreshAlive == nil && c.SecretExists && !c.AccessTokenExpired:
			healthy = true
		}
		if !healthy {
			health.OK = false
			if health.Reason == "" {
				health.Reason = credentialProblem(c)
			}
		}
		if c.LastRefresh > health.LastRefresh {
			health.LastRefresh = c.LastRefresh
		}
	}

	sendJSON(w, http.StatusOK, health)
}

func credentialProblem(c CredentialHealth) string {
	switch {
	case !c.SecretExists:
		return fmt.Sprintf("secret %s not found", c.Secret)
	case c.RefreshAlive != nil && !*c.RefreshAlive:
		return fmt.Sprintf("%s: refresh token rejected — %s", c.Secret, c.RefreshError)
	case c.AccessTokenExpired:
		reason := fmt.Sprintf("%s: access token expired %s", c.Secret, c.AccessTokenExpiresAt)
		if c.RefreshError != "" {
			reason += " and refresh could not be verified: " + c.RefreshError
		}
		return reason
	default:
		return fmt.Sprintf("%s: unhealthy", c.Secret)
	}
}

// ─── credential (secret + refresh probe) ────────────────────────────────

func (h *CodexHandler) credentialHealth(ctx context.Context, secretName string, force bool) CredentialHealth {
	ch := CredentialHealth{Secret: secretName}

	secret, err := h.clients.Clientset.CoreV1().Secrets(h.namespace).Get(ctx, secretName, metav1.GetOptions{})
	if err != nil {
		return ch
	}
	authData, ok := secret.Data["auth.json"]
	if !ok {
		ch.SecretExists = true
		return ch
	}

	var creds struct {
		AuthMode    string `json:"auth_mode"`
		LastRefresh string `json:"last_refresh"`
		Tokens      struct {
			AccessToken  string `json:"access_token"`
			RefreshToken string `json:"refresh_token"`
			AccountID    string `json:"account_id"`
		} `json:"tokens"`
	}
	if err := json.Unmarshal(authData, &creds); err != nil {
		ch.SecretExists = true
		ch.RefreshError = "auth.json is not valid JSON"
		return ch
	}

	ch.SecretExists = true
	ch.AuthMode = creds.AuthMode
	ch.LastRefresh = creds.LastRefresh
	ch.HasRefreshToken = creds.Tokens.RefreshToken != ""
	if creds.Tokens.AccountID != "" {
		ch.AccountID = truncateID(creds.Tokens.AccountID)
	}
	if exp, ok := jwtExpiry(creds.Tokens.AccessToken); ok {
		ch.AccessTokenExpiresAt = exp.UTC().Format(time.RFC3339)
		ch.AccessTokenExpired = time.Now().After(exp)
	}

	if ch.HasRefreshToken {
		res := h.refreshProbe(ctx, secretName, force)
		ch.RefreshAlive = res.alive
		ch.RefreshError = res.err
		if !res.checkedAt.IsZero() {
			ch.RefreshCheckedAt = res.checkedAt.UTC().Format(time.RFC3339)
		}
		// A successful probe persisted rotated tokens — re-report the
		// stored state so expiry/lastRefresh reflect what is now saved.
		if res.alive != nil && *res.alive {
			if fresh, err := h.clients.Clientset.CoreV1().Secrets(h.namespace).Get(ctx, secretName, metav1.GetOptions{}); err == nil {
				if data, ok := fresh.Data["auth.json"]; ok {
					var updated struct {
						LastRefresh string `json:"last_refresh"`
						Tokens      struct {
							AccessToken string `json:"access_token"`
						} `json:"tokens"`
					}
					if json.Unmarshal(data, &updated) == nil {
						if exp, ok := jwtExpiry(updated.Tokens.AccessToken); ok {
							ch.AccessTokenExpiresAt = exp.UTC().Format(time.RFC3339)
							ch.AccessTokenExpired = time.Now().After(exp)
						}
						if updated.LastRefresh != "" {
							ch.LastRefresh = updated.LastRefresh
						}
					}
				}
			}
		}
	}
	return ch
}

// refreshProbe proves the refresh token is alive by performing a real
// refresh, at most once per TTL. On success the rotated tokens are written
// back to the Secret; on any failure the Secret is left untouched.
func (h *CodexHandler) refreshProbe(ctx context.Context, secretName string, force bool) refreshProbeResult {
	h.probeMu.Lock()
	if h.probeCache == nil {
		h.probeCache = map[string]refreshProbeResult{}
	}
	cached, ok := h.probeCache[secretName]
	if ok && !force && time.Since(cached.checkedAt) < cached.ttl {
		h.probeMu.Unlock()
		return cached
	}
	h.probeMu.Unlock()

	res := h.doRefresh(ctx, secretName)

	h.probeMu.Lock()
	h.probeCache[secretName] = res
	h.probeMu.Unlock()
	return res
}

func (h *CodexHandler) invalidateRefreshProbe(secretName string) {
	h.probeMu.Lock()
	delete(h.probeCache, secretName)
	h.probeMu.Unlock()
}

func (h *CodexHandler) doRefresh(ctx context.Context, secretName string) refreshProbeResult {
	res := refreshProbeResult{checkedAt: time.Now(), ttl: refreshTTLInconclusive}

	secret, err := h.clients.Clientset.CoreV1().Secrets(h.namespace).Get(ctx, secretName, metav1.GetOptions{})
	if err != nil {
		res.err = fmt.Sprintf("reading secret: %v", err)
		return res
	}
	// Full-fidelity view: auth.json carries fields our typed structs don't
	// (OPENAI_API_KEY, last_refresh, id_token) — mutate, never re-shape.
	var auth map[string]interface{}
	if err := json.Unmarshal(secret.Data["auth.json"], &auth); err != nil {
		res.err = "auth.json is not valid JSON"
		return res
	}
	tokens, _ := auth["tokens"].(map[string]interface{})
	refreshToken, _ := tokens["refresh_token"].(string)
	if refreshToken == "" {
		f := false
		res.alive = &f
		res.err = "no refresh token stored"
		res.ttl = refreshTTLDead
		return res
	}

	form := url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {refreshToken},
		"client_id":     {codexClientID},
	}
	reqCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, codexTokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		res.err = err.Error()
		return res
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		res.err = fmt.Sprintf("token endpoint unreachable: %v", err)
		return res
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024))

	if resp.StatusCode != http.StatusOK {
		// A definitive rejection means the stored refresh token is dead.
		// auth.openai.com speaks two error dialects: OAuth-standard
		// {"error":"invalid_grant","error_description":...} and OpenAI
		// API-style {"error":{"code":"refresh_token_reused","message":...}}
		// (seen live when a secret's token is superseded by a pod's
		// rotation chain). Anything non-JSON — Cloudflare challenge,
		// 5xx HTML — proves nothing, so stay inconclusive.
		if msg := decodeTokenError(body); msg != "" {
			f := false
			res.alive = &f
			res.err = msg
			res.ttl = refreshTTLDead
			log.Printf("codex refresh probe: %s refresh token REJECTED (%s)", secretName, res.err)
			return res
		}
		res.err = fmt.Sprintf("token endpoint returned HTTP %d (not an OAuth error — inconclusive)", resp.StatusCode)
		return res
	}

	var tr struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		IDToken      string `json:"id_token"`
		ExpiresIn    int64  `json:"expires_in"`
	}
	if err := json.Unmarshal(body, &tr); err != nil || tr.AccessToken == "" || tr.RefreshToken == "" {
		res.err = "token endpoint returned 200 but response is missing tokens"
		return res
	}

	t := true
	res.alive = &t
	res.ttl = refreshTTLAlive

	// Persist the rotated tokens — only now, on proven success.
	if tokens == nil {
		tokens = map[string]interface{}{}
		auth["tokens"] = tokens
	}
	tokens["access_token"] = tr.AccessToken
	tokens["refresh_token"] = tr.RefreshToken
	if tr.IDToken != "" {
		tokens["id_token"] = tr.IDToken
	}
	auth["last_refresh"] = time.Now().UTC().Format("2006-01-02T15:04:05.000Z")

	updated, err := json.Marshal(auth)
	if err != nil {
		res.err = fmt.Sprintf("refresh succeeded but re-encoding auth.json failed: %v", err)
		return res
	}
	secret.Data["auth.json"] = updated
	if _, err := h.clients.Clientset.CoreV1().Secrets(h.namespace).Update(ctx, secret, metav1.UpdateOptions{}); err != nil {
		// The probe still proved the token alive; report that but surface
		// the persistence failure.
		res.err = fmt.Sprintf("refresh succeeded but persisting to secret failed: %v", err)
		log.Printf("codex refresh probe: %s: %s", secretName, res.err)
		return res
	}
	log.Printf("codex refresh probe: %s refresh token alive; rotated tokens persisted", secretName)
	return res
}

// ─── per-gateway agent auth health (pods/exec probe) ────────────────────

type gatewayInfo struct {
	name   string
	secret string
}

func (h *CodexHandler) discoverGateways(ctx context.Context) ([]gatewayInfo, error) {
	deps, err := h.clients.Clientset.AppsV1().Deployments(h.namespace).List(ctx, metav1.ListOptions{
		LabelSelector: gatewayLabelComponent,
	})
	if err != nil {
		return nil, err
	}
	var out []gatewayInfo
	for _, d := range deps.Items {
		gw := gatewayInfo{name: d.Name}
		for _, v := range d.Spec.Template.Spec.Volumes {
			if v.Name == codexAuthVolumeName && v.Secret != nil {
				gw.secret = v.Secret.SecretName
			}
		}
		// Gateways without a codex credential mount (e.g. a future
		// claude-backed gateway) aren't part of Codex auth health.
		if gw.secret != "" {
			out = append(out, gw)
		}
	}
	return out, nil
}

// agentProbeJS runs inside the gateway pod via pods/exec. It reads each
// agent's openclaw auth_profile_store/auth_profile_state (read-only) and
// reports profile PRESENCE and usage metadata — never token material.
const agentProbeJS = `
const fs=require('fs');
const {DatabaseSync}=require('node:sqlite');
const base='/home/node/.openclaw/agents';
const out=[];
let dirs=[];
try{dirs=fs.readdirSync(base);}catch(e){console.log(JSON.stringify({error:'agents dir: '+e.message,agents:[]}));process.exit(0);}
for(const name of dirs){
  const file=base+'/'+name+'/agent/openclaw-agent.sqlite';
  if(!fs.existsSync(file)){continue;}
  const a={name:name,profilePresent:false,errorCount:0};
  try{
    const db=new DatabaseSync(file,{readOnly:true});
    let profs={};
    try{
      for(const row of db.prepare('select store_json from auth_profile_store').all()){
        const p=JSON.parse(row.store_json||'{}').profiles||{};
        for(const k of Object.keys(p)){profs[k]=p[k];}
      }
    }catch(e){}
    const ids=Object.keys(profs).filter(k=>profs[k]&&profs[k].provider==='openai');
    a.profilePresent=ids.length>0;
    let exp=null;
    for(const id of ids){const e=profs[id].expires;if(typeof e==='number'&&(exp===null||e<exp)){exp=e;}}
    if(exp!==null){a.profileExpiresAt=new Date(exp).toISOString();}
    try{
      for(const row of db.prepare('select state_json from auth_profile_state').all()){
        const st=JSON.parse(row.state_json||'{}');const us=st.usageStats||{};
        let last=null;
        for(const id of ids){const u=us[id];if(u){if(typeof u.lastUsed==='number'&&(last===null||u.lastUsed>last)){last=u.lastUsed;}a.errorCount+=(u.errorCount||0);}}
        if(last!==null){a.lastUsed=new Date(last).toISOString();}
      }
    }catch(e){}
    db.close();
  }catch(e){a.error=String(e.message||e);}
  out.push(a);
}
console.log(JSON.stringify({agents:out}));
`

func (h *CodexHandler) probeGatewayAgents(ctx context.Context, gateway string) agentProbeResult {
	h.probeMu.Lock()
	if h.agentCacheByGW == nil {
		h.agentCacheByGW = map[string]agentProbeResult{}
	}
	if cached, ok := h.agentCacheByGW[gateway]; ok && time.Since(cached.checkedAt) < agentProbeTTL {
		h.probeMu.Unlock()
		return cached
	}
	h.probeMu.Unlock()

	res := h.doProbeGatewayAgents(ctx, gateway)

	h.probeMu.Lock()
	h.agentCacheByGW[gateway] = res
	h.probeMu.Unlock()
	return res
}

func (h *CodexHandler) doProbeGatewayAgents(ctx context.Context, gateway string) agentProbeResult {
	res := agentProbeResult{checkedAt: time.Now()}

	pods, err := h.clients.Clientset.CoreV1().Pods(h.namespace).List(ctx, metav1.ListOptions{
		LabelSelector: gatewayNameLabel + "=" + gateway,
	})
	if err != nil {
		res.err = fmt.Sprintf("listing gateway pods: %v", err)
		return res
	}
	var podName string
	for _, p := range pods.Items {
		if p.Status.Phase == corev1.PodRunning && p.DeletionTimestamp == nil {
			podName = p.Name
			break
		}
	}
	if podName == "" {
		res.err = "no running gateway pod"
		return res
	}

	execCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	req := h.clients.Clientset.CoreV1().RESTClient().Post().
		Resource("pods").Name(podName).Namespace(h.namespace).SubResource("exec").
		VersionedParams(&corev1.PodExecOptions{
			Container: openclawContainer,
			Command:   []string{"node", "-e", agentProbeJS},
			Stdout:    true,
			Stderr:    true,
		}, scheme.ParameterCodec)

	exec, err := remotecommand.NewSPDYExecutor(h.clients.Config, http.MethodPost, req.URL())
	if err != nil {
		res.err = fmt.Sprintf("building executor: %v", err)
		return res
	}
	var stdout, stderr bytes.Buffer
	if err := exec.StreamWithContext(execCtx, remotecommand.StreamOptions{Stdout: &stdout, Stderr: &stderr}); err != nil {
		res.err = fmt.Sprintf("exec in %s: %v (%s)", podName, err, firstLine(stderr.String()))
		return res
	}

	var parsed struct {
		Error  string            `json:"error"`
		Agents []AgentAuthHealth `json:"agents"`
	}
	if err := json.Unmarshal(stdout.Bytes(), &parsed); err != nil {
		res.err = fmt.Sprintf("parsing probe output: %v (%s)", err, firstLine(stdout.String()))
		return res
	}
	res.err = parsed.Error
	res.agents = parsed.Agents
	return res
}

// orderAgents puts this gateway's AgentWorkstation-declared agents first
// (adding missing-store entries for any the probe didn't find), followed
// by whatever else lives in the pod (e.g. the gateway's "main" agent).
func (h *CodexHandler) orderAgents(gateway string, probed []AgentAuthHealth) []AgentAuthHealth {
	byName := map[string]AgentAuthHealth{}
	for _, a := range probed {
		byName[a.Name] = a
	}

	var declared []string
	if h.cache != nil {
		for _, aw := range h.cache.List() {
			ref, _, _ := nestedString(aw.Object, "spec", "runtime", "shared", "gatewayRef")
			if ref == gateway {
				declared = append(declared, aw.GetName())
			}
		}
	}
	sort.Strings(declared)

	out := make([]AgentAuthHealth, 0, len(probed))
	seen := map[string]bool{}
	for _, name := range declared {
		if a, ok := byName[name]; ok {
			out = append(out, a)
		} else {
			out = append(out, AgentAuthHealth{Name: name, Error: "no agent store found in gateway pod"})
		}
		seen[name] = true
	}
	rest := make([]AgentAuthHealth, 0, len(probed))
	for _, a := range probed {
		if !seen[a.Name] {
			rest = append(rest, a)
		}
	}
	sort.Slice(rest, func(i, j int) bool { return rest[i].Name < rest[j].Name })
	return append(out, rest...)
}

func nestedString(obj map[string]interface{}, path ...string) (string, bool, error) {
	cur := obj
	for i, key := range path {
		v, ok := cur[key]
		if !ok {
			return "", false, nil
		}
		if i == len(path)-1 {
			s, ok := v.(string)
			return s, ok, nil
		}
		cur, ok = v.(map[string]interface{})
		if !ok {
			return "", false, nil
		}
	}
	return "", false, nil
}

// ─── desk activity (newsroom MCP) ───────────────────────────────────────

// deskURLsFromEnv parses CODEX_DESK_URLS, a comma-separated list of
// <gateway>=<url> pairs pointing at each newsroom MCP's /desk endpoint.
func deskURLsFromEnv() map[string]string {
	out := map[string]string{}
	for _, pair := range strings.Split(os.Getenv("CODEX_DESK_URLS"), ",") {
		pair = strings.TrimSpace(pair)
		if pair == "" {
			continue
		}
		k, v, ok := strings.Cut(pair, "=")
		if ok && k != "" && v != "" {
			out[strings.TrimSpace(k)] = strings.TrimSpace(v)
		}
	}
	return out
}

func (h *CodexHandler) probeDesk(ctx context.Context, deskURL string) *DeskHealth {
	h.probeMu.Lock()
	if h.deskCache == nil {
		h.deskCache = map[string]deskProbeResult{}
	}
	if cached, ok := h.deskCache[deskURL]; ok && time.Since(cached.checkedAt) < deskTTL {
		h.probeMu.Unlock()
		return cached.desk
	}
	h.probeMu.Unlock()

	desk := fetchDesk(ctx, deskURL)

	h.probeMu.Lock()
	h.deskCache[deskURL] = deskProbeResult{desk: desk, checkedAt: time.Now()}
	h.probeMu.Unlock()
	return desk
}

func fetchDesk(ctx context.Context, deskURL string) *DeskHealth {
	desk := &DeskHealth{URL: deskURL}

	reqCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, deskURL, nil)
	if err != nil {
		desk.Error = err.Error()
		return desk
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		desk.Error = fmt.Sprintf("desk unreachable: %v", err)
		return desk
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 256*1024))
	if resp.StatusCode != http.StatusOK {
		desk.Error = fmt.Sprintf("desk returned HTTP %d", resp.StatusCode)
		return desk
	}

	var parsed struct {
		Verdict string            `json:"verdict"`
		Last    map[string]string `json:"last"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		desk.Error = "desk response is not JSON"
		return desk
	}
	desk.Verdict = parsed.Verdict
	desk.Last = parsed.Last
	for _, ts := range parsed.Last {
		if t, err := time.Parse(time.RFC3339, ts); err == nil {
			if desk.LastActivity == "" || t.After(mustParse(desk.LastActivity)) {
				desk.LastActivity = t.UTC().Format(time.RFC3339)
			}
		}
	}
	return desk
}

// ─── helpers ────────────────────────────────────────────────────────────

func latestActivity(gh GatewayHealth) string {
	latest := ""
	consider := func(ts string) {
		if ts == "" {
			return
		}
		if latest == "" || mustParse(ts).After(mustParse(latest)) {
			latest = ts
		}
	}
	if gh.Desk != nil {
		consider(gh.Desk.LastActivity)
	}
	for _, a := range gh.Agents {
		consider(a.LastUsed)
	}
	return latest
}

func mustParse(ts string) time.Time {
	t, err := time.Parse(time.RFC3339, ts)
	if err != nil {
		return time.Time{}
	}
	return t
}

// jwtExpiry decodes a JWT's exp claim without verifying the signature —
// this reports expiry, it does not authenticate anything.
func jwtExpiry(token string) (time.Time, bool) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return time.Time{}, false
	}
	decoded, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(parts[1], "="))
	if err != nil {
		return time.Time{}, false
	}
	var claims struct {
		Exp int64 `json:"exp"`
	}
	if err := json.Unmarshal(decoded, &claims); err != nil || claims.Exp == 0 {
		return time.Time{}, false
	}
	return time.Unix(claims.Exp, 0), true
}

// decodeTokenError extracts a definitive rejection message from a token
// endpoint error body. Returns "" when the body is not a recognizable
// OAuth/OpenAI error (treat as inconclusive).
func decodeTokenError(body []byte) string {
	var generic struct {
		Error       json.RawMessage `json:"error"`
		Description string          `json:"error_description"`
	}
	if json.Unmarshal(body, &generic) != nil || len(generic.Error) == 0 {
		return ""
	}
	var s string
	if json.Unmarshal(generic.Error, &s) == nil && s != "" {
		if generic.Description != "" {
			s += ": " + generic.Description
		}
		return s
	}
	var obj struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	}
	if json.Unmarshal(generic.Error, &obj) == nil && (obj.Code != "" || obj.Message != "") {
		switch {
		case obj.Code != "" && obj.Message != "":
			return obj.Code + ": " + obj.Message
		case obj.Code != "":
			return obj.Code
		default:
			return obj.Message
		}
	}
	return ""
}

func truncateID(id string) string {
	if len(id) > 8 {
		return id[:8] + "..."
	}
	return id
}

func firstLine(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[:i]
	}
	if len(s) > 200 {
		s = s[:200]
	}
	return s
}
