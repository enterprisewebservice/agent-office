package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/tools/remotecommand"
)

// Daily per-gateway turn probe (2026-10-28).
//
// The census reads agent stores; it cannot tell whether OpenAI still honours
// the token in them. runtab-help, handsonmode-help, research-gateway and
// supply-chain-ops-gateway all held a dead refresh token for weeks, and
// nothing said so until a customer's help chat failed. So once a day every
// Codex gateway answers one tiny turn, run inside its own pod with
// `openclaw agent` (no channel delivery). The result goes on the Dev Hub card
// (GatewayHealth.Turn) and on the metrics port as
// agentoffice_codex_gateway_turn_ok{gateway}, which the CodexGatewayTurnFailing
// alert watches. The daily turn also keeps an idle gateway's sign-in in use,
// so it is refreshed before it can go stale unnoticed.

// TurnHealth is the last daily test turn of one Codex gateway.
type TurnHealth struct {
	OK        bool    `json:"ok"`
	CheckedAt string  `json:"checkedAt"`
	Seconds   float64 `json:"seconds"`
	Agent     string  `json:"agent,omitempty"`
	Error     string  `json:"error,omitempty"`
}

const turnProbeMessage = "Daily health check from the agent platform. Reply with the single word OK."

// turnProbeSh runs in the gateway's openclaw container: the first agent the
// operator registered (main when none), one turn, no delivery. $1 is the
// message.
const turnProbeSh = `id=$(node -e 'try{const c=JSON.parse(require("fs").readFileSync("/home/node/.openclaw/openclaw.json","utf8"));const l=((c.agents||{}).list)||[];process.stdout.write((l[0]&&l[0].id)||"main")}catch(e){process.stdout.write("main")}'); printf 'agent=%s\n' "$id"; openclaw agent --agent "$id" --session-id platform-healthcheck-daily --message "$1" --json 2>&1`

var turnStore = struct {
	sync.Mutex
	m map[string]TurnHealth
}{m: map[string]TurnHealth{}}

func recordTurn(gateway string, t TurnHealth) {
	turnStore.Lock()
	defer turnStore.Unlock()
	turnStore.m[gateway] = t
}

func lastTurn(gateway string) *TurnHealth {
	turnStore.Lock()
	defer turnStore.Unlock()
	if t, ok := turnStore.m[gateway]; ok {
		return &t
	}
	return nil
}

var ansiRE = regexp.MustCompile("\x1b\\[[0-9;]*m")

// parseTurnOutput reads what turnProbeSh printed: "agent=<id>", then the
// CLI's --json result (a line starting with "{"), possibly after runtime
// warnings. A turn is OK only with status "ok" and a non-empty reply; on a
// failure the CLI prints an error line instead (e.g. "GatewayClientRequestError:
// FailoverError: OAuth token refresh failed ..."), which becomes the error.
func parseTurnOutput(out string) (agent string, ok bool, errText string) {
	out = ansiRE.ReplaceAllString(out, "")
	lines := strings.Split(out, "\n")
	if len(lines) > 0 && strings.HasPrefix(lines[0], "agent=") {
		agent = strings.TrimSpace(strings.TrimPrefix(lines[0], "agent="))
		lines = lines[1:]
	}
	for i, l := range lines {
		if !strings.HasPrefix(l, "{") {
			continue
		}
		var res struct {
			Status string `json:"status"`
			Result struct {
				Payloads []struct {
					Text string `json:"text"`
				} `json:"payloads"`
			} `json:"result"`
		}
		if err := json.NewDecoder(strings.NewReader(strings.Join(lines[i:], "\n"))).Decode(&res); err != nil {
			break
		}
		if res.Status == "ok" {
			for _, p := range res.Result.Payloads {
				if strings.TrimSpace(p.Text) != "" {
					return agent, true, ""
				}
			}
		}
		return agent, false, fmt.Sprintf("turn status %q without a reply", res.Status)
	}
	return agent, false, firstMeaningfulLine(lines)
}

// firstMeaningfulLine is the first line that is not blank or a bracketed
// runtime notice ("[state-migrations] ..."), whitespace-collapsed and capped.
func firstMeaningfulLine(lines []string) string {
	for _, l := range lines {
		l = strings.TrimSpace(l)
		if l == "" || strings.HasPrefix(l, "[") || strings.HasPrefix(l, "-") {
			continue
		}
		l = strings.Join(strings.Fields(l), " ")
		if len(l) > 300 {
			l = l[:300] + "…"
		}
		return l
	}
	return "no output from openclaw agent"
}

// probeGatewayTurn runs one test turn inside a running pod of the gateway.
func (h *CodexHandler) probeGatewayTurn(ctx context.Context, gateway string) TurnHealth {
	t0 := time.Now()
	th := TurnHealth{CheckedAt: t0.UTC().Format(time.RFC3339)}
	done := func() TurnHealth {
		th.Seconds = float64(time.Since(t0).Milliseconds()) / 1000
		return th
	}

	pods, err := h.clients.Clientset.CoreV1().Pods(h.namespace).List(ctx, metav1.ListOptions{
		LabelSelector: gatewayNameLabel + "=" + gateway,
	})
	if err != nil {
		th.Error = fmt.Sprintf("listing gateway pods: %v", err)
		return done()
	}
	var podName string
	for _, p := range pods.Items {
		if p.Status.Phase == corev1.PodRunning && p.DeletionTimestamp == nil {
			podName = p.Name
			break
		}
	}
	if podName == "" {
		th.Error = "no running gateway pod"
		return done()
	}

	execCtx, cancel := context.WithTimeout(ctx, 150*time.Second)
	defer cancel()
	req := h.clients.Clientset.CoreV1().RESTClient().Post().
		Resource("pods").Name(podName).Namespace(h.namespace).SubResource("exec").
		VersionedParams(&corev1.PodExecOptions{
			Container: openclawContainer,
			Command:   []string{"sh", "-c", turnProbeSh, "turn-probe", turnProbeMessage},
			Stdout:    true,
			Stderr:    true,
		}, scheme.ParameterCodec)
	exec, err := remotecommand.NewSPDYExecutor(h.clients.Config, http.MethodPost, req.URL())
	if err != nil {
		th.Error = fmt.Sprintf("building executor: %v", err)
		return done()
	}
	var stdout, stderr bytes.Buffer
	if err := exec.StreamWithContext(execCtx, remotecommand.StreamOptions{Stdout: &stdout, Stderr: &stderr}); err != nil {
		th.Error = fmt.Sprintf("exec in %s: %v (%s)", podName, err, firstMeaningfulLine(strings.Split(stderr.String(), "\n")))
		return done()
	}
	agent, ok, errText := parseTurnOutput(stdout.String())
	th.Agent, th.OK, th.Error = agent, ok, errText
	return done()
}

// runTurnProbes gives every Codex gateway its test turn, one after another.
func (h *CodexHandler) runTurnProbes(ctx context.Context) {
	gateways, err := h.discoverGateways(ctx)
	if err != nil {
		log.Printf("codex turn probe: gateway discovery failed: %v", err)
		return
	}
	for _, gw := range gateways {
		if gw.secret == "" {
			continue // not a Codex gateway
		}
		th := h.probeGatewayTurn(ctx, gw.name)
		recordTurn(gw.name, th)
		if th.OK {
			log.Printf("codex turn probe %s: ok via %s in %.1fs", gw.name, th.Agent, th.Seconds)
		} else {
			log.Printf("codex turn probe %s: FAILED via %s in %.1fs: %s", gw.name, th.Agent, th.Seconds, th.Error)
		}
	}
}

// StartTurnProbes runs the test turns after `first`, then every `every`.
func (h *CodexHandler) StartTurnProbes(ctx context.Context, first, every time.Duration) {
	go func() {
		t := time.NewTimer(first)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
			}
			h.runTurnProbes(ctx)
			t.Reset(every)
		}
	}()
}

// Metrics serves the test-turn results in the Prometheus text format. It is
// mounted on the backend's metrics port only, never behind the public Route.
func (h *CodexHandler) Metrics(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4")
	_, _ = w.Write([]byte(renderTurnMetrics()))
}

func renderTurnMetrics() string {
	turnStore.Lock()
	names := make([]string, 0, len(turnStore.m))
	for n := range turnStore.m {
		names = append(names, n)
	}
	sort.Strings(names)
	snapshot := make([]TurnHealth, len(names))
	for i, n := range names {
		snapshot[i] = turnStore.m[n]
	}
	turnStore.Unlock()

	var b strings.Builder
	b.WriteString("# HELP agentoffice_codex_gateway_turn_ok 1 when the gateway's last daily test turn got an answer, 0 when it failed.\n")
	b.WriteString("# TYPE agentoffice_codex_gateway_turn_ok gauge\n")
	for i, n := range names {
		v := 0
		if snapshot[i].OK {
			v = 1
		}
		fmt.Fprintf(&b, "agentoffice_codex_gateway_turn_ok{gateway=%q} %d\n", n, v)
	}
	b.WriteString("# HELP agentoffice_codex_gateway_turn_checked_timestamp_seconds When the gateway's last daily test turn ran.\n")
	b.WriteString("# TYPE agentoffice_codex_gateway_turn_checked_timestamp_seconds gauge\n")
	for i, n := range names {
		at, err := time.Parse(time.RFC3339, snapshot[i].CheckedAt)
		if err != nil {
			continue
		}
		fmt.Fprintf(&b, "agentoffice_codex_gateway_turn_checked_timestamp_seconds{gateway=%q} %d\n", n, at.Unix())
	}
	return b.String()
}
