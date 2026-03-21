package handlers

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/enterprisewebservice/agent-office/backend/k8s"
)

const (
	claudeSecretName = "claude-subscription-credentials"
	claudeClientID   = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
	claudeAuthURL    = "https://claude.ai/oauth/authorize"
	claudeTokenURL   = "https://platform.claude.com/v1/oauth/token"
	claudeRedirectURI = "https://platform.claude.com/oauth/code/callback"
	claudeScope      = "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload"
)

// ClaudeHandler manages Claude subscription credentials.
type ClaudeHandler struct {
	namespace    string
	clients      *k8s.Clients
	mu           sync.Mutex
	codeVerifier string // PKCE code verifier for current auth flow
}

// NewClaudeHandler creates a new Claude subscription handler.
func NewClaudeHandler(namespace string, clients *k8s.Clients) *ClaudeHandler {
	return &ClaudeHandler{namespace: namespace, clients: clients}
}

// ClaudeCredentials represents the Claude auth.json format.
type ClaudeCredentials struct {
	Tokens *ClaudeTokens `json:"tokens,omitempty"`
}

// ClaudeTokens contains the OAuth tokens.
type ClaudeTokens struct {
	IDToken      string `json:"id_token,omitempty"`
	AccessToken  string `json:"access_token,omitempty"`
	RefreshToken string `json:"refresh_token,omitempty"`
	AccountID    string `json:"account_id,omitempty"`
}

// ClaudeStatus represents the subscription status.
type ClaudeStatus struct {
	Connected    bool   `json:"connected"`
	AccountID    string `json:"accountId,omitempty"`
	HasRefresh   bool   `json:"hasRefreshToken"`
	SecretExists bool   `json:"secretExists"`
	Expired      bool   `json:"expired,omitempty"`
}

// GetStatus returns the current Claude subscription status.
func (h *ClaudeHandler) GetStatus(w http.ResponseWriter, r *http.Request) {
	secret, err := h.clients.Clientset.CoreV1().Secrets(h.namespace).Get(
		context.Background(), claudeSecretName, metav1.GetOptions{},
	)
	if err != nil {
		sendJSON(w, http.StatusOK, ClaudeStatus{
			Connected:    false,
			SecretExists: false,
		})
		return
	}

	credData, ok := secret.Data["credentials.json"]
	if !ok {
		sendJSON(w, http.StatusOK, ClaudeStatus{
			Connected:    false,
			SecretExists: true,
		})
		return
	}

	var creds ClaudeCredentials
	if err := json.Unmarshal(credData, &creds); err != nil {
		sendJSON(w, http.StatusOK, ClaudeStatus{
			Connected:    false,
			SecretExists: true,
		})
		return
	}

	hasTokens := creds.Tokens != nil && creds.Tokens.RefreshToken != ""
	expired := false

	if hasTokens && creds.Tokens.AccessToken != "" {
		expired = isJWTExpired(creds.Tokens.AccessToken)
	}

	status := ClaudeStatus{
		Connected:    hasTokens && !expired,
		SecretExists: true,
		HasRefresh:   hasTokens,
		Expired:      expired,
	}
	if creds.Tokens != nil && creds.Tokens.AccountID != "" {
		status.AccountID = creds.Tokens.AccountID[:8] + "..."
	}

	sendJSON(w, http.StatusOK, status)
}

// UpdateCredentials stores new Claude subscription credentials.
func (h *ClaudeHandler) UpdateCredentials(w http.ResponseWriter, r *http.Request) {
	var creds ClaudeCredentials
	if err := json.NewDecoder(r.Body).Decode(&creds); err != nil {
		sendJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON: " + err.Error()})
		return
	}

	if creds.Tokens == nil || creds.Tokens.RefreshToken == "" {
		sendJSON(w, http.StatusBadRequest, map[string]string{
			"error": "credentials must include tokens with a refresh_token. Run 'claude auth login' locally and paste the contents of ~/.codex/auth.json",
		})
		return
	}

	credJSON, err := json.Marshal(creds)
	if err != nil {
		sendJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	// Try to update existing secret, or create new one
	secret, err := h.clients.Clientset.CoreV1().Secrets(h.namespace).Get(
		context.Background(), claudeSecretName, metav1.GetOptions{},
	)
	if err != nil {
		// Create new secret
		secret = &corev1.Secret{
			ObjectMeta: metav1.ObjectMeta{
				Name:      claudeSecretName,
				Namespace: h.namespace,
				Labels: map[string]string{
					"app.kubernetes.io/managed-by": "agent-office",
					"agentoffice.ai/credential":    "claude-subscription",
				},
			},
			Data: map[string][]byte{
				"credentials.json": credJSON,
			},
		}
		_, err = h.clients.Clientset.CoreV1().Secrets(h.namespace).Create(
			context.Background(), secret, metav1.CreateOptions{},
		)
		if err != nil {
			sendJSON(w, http.StatusInternalServerError, map[string]string{"error": fmt.Sprintf("creating secret: %v", err)})
			return
		}
	} else {
		// Update existing secret
		secret.Data["credentials.json"] = credJSON
		_, err = h.clients.Clientset.CoreV1().Secrets(h.namespace).Update(
			context.Background(), secret, metav1.UpdateOptions{},
		)
		if err != nil {
			sendJSON(w, http.StatusInternalServerError, map[string]string{"error": fmt.Sprintf("updating secret: %v", err)})
			return
		}
	}

	log.Printf("claude subscription credentials updated (account: %s)", creds.Tokens.AccountID[:8])

	// Restart all agent pods that mount this secret so they pick up new credentials
	go h.restartAgentPods()

	sendJSON(w, http.StatusOK, map[string]interface{}{
		"ok":        true,
		"accountId": creds.Tokens.AccountID[:8] + "...",
		"message":   "Credentials saved. Agent pods will restart to pick up new credentials.",
	})
}

// restartAgentPods deletes all agent pods so they restart with new credentials.
func (h *ClaudeHandler) restartAgentPods() {
	pods, err := h.clients.Clientset.CoreV1().Pods(h.namespace).List(
		context.Background(),
		metav1.ListOptions{LabelSelector: "agentoffice.ai/agent"},
	)
	if err != nil {
		log.Printf("failed to list agent pods: %v", err)
		return
	}

	for _, pod := range pods.Items {
		err := h.clients.Clientset.CoreV1().Pods(h.namespace).Delete(
			context.Background(), pod.Name, metav1.DeleteOptions{},
		)
		if err != nil {
			log.Printf("failed to delete pod %s: %v", pod.Name, err)
		} else {
			log.Printf("restarted agent pod: %s", pod.Name)
		}
	}
}

// authHelperScript is a Node.js script deployed to agent pods that manages
// the claude auth login process with file-based IPC.
const authHelperScript = `
const { spawn } = require("child_process");
const fs = require("fs");
const mode = process.argv[2]; // "start" or "code"

if (mode === "start") {
  // Clean up old state
  try { fs.unlinkSync("/tmp/claude-auth-url"); } catch {}
  try { fs.unlinkSync("/tmp/claude-auth-code"); } catch {}
  try { fs.unlinkSync("/tmp/claude-auth-result"); } catch {}

  const proc = spawn("claude", ["auth", "login", "--claudeai"], {
    env: { ...process.env, HOME: "/home/node", BROWSER: "echo", DISPLAY: "" },
    stdio: ["pipe", "pipe", "pipe"]
  });
  let output = "";
  proc.stdout.on("data", d => output += d.toString());
  proc.stderr.on("data", d => output += d.toString());

  // Wait for URL
  const urlCheck = setInterval(() => {
    const match = output.match(/https:\/\/[^\s]+oauth\/authorize[^\s]+/);
    if (match) {
      clearInterval(urlCheck);
      fs.writeFileSync("/tmp/claude-auth-url", match[0]);
      // Poll for code
      const codeCheck = setInterval(() => {
        try {
          const code = fs.readFileSync("/tmp/claude-auth-code", "utf-8").trim();
          if (code) { clearInterval(codeCheck); proc.stdin.write(code + "\\n"); proc.stdin.end(); }
        } catch {}
      }, 500);
    }
  }, 300);

  proc.on("close", () => { fs.writeFileSync("/tmp/claude-auth-result", output); process.exit(0); });
  setTimeout(() => { proc.kill(); process.exit(1); }, 120000);

} else if (mode === "code") {
  const code = process.argv[3];
  fs.writeFileSync("/tmp/claude-auth-code", code);
  // Wait for result
  for (let i = 0; i < 30; i++) {
    const { execSync } = require("child_process");
    execSync("sleep 1");
    try { const r = fs.readFileSync("/tmp/claude-auth-result", "utf-8"); if (r) { console.log(r); break; } } catch {}
  }
}
`

// StartAuth starts the auth helper in the pod and returns the auth URL.
func (h *ClaudeHandler) StartAuth(w http.ResponseWriter, r *http.Request) {
	pods, err := h.clients.Clientset.CoreV1().Pods(h.namespace).List(
		context.Background(),
		metav1.ListOptions{LabelSelector: "agentoffice.ai/agent"},
	)
	if err != nil || len(pods.Items) == 0 {
		sendJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "no agent pods available"})
		return
	}
	podName := pods.Items[0].Name

	// Deploy and start the helper script
	scriptCmd := fmt.Sprintf("cat > /tmp/claude-auth-helper.js << 'NODESCRIPT'\n%s\nNODESCRIPT\nnode /tmp/claude-auth-helper.js start &\nsleep 5\ncat /tmp/claude-auth-url 2>/dev/null || echo ''", authHelperScript)

	output, err := h.execInPod(podName, []string{"sh", "-c", scriptCmd})
	if err != nil {
		sendJSON(w, http.StatusInternalServerError, map[string]string{"error": fmt.Sprintf("failed to start auth: %v", err)})
		return
	}

	authURL := strings.TrimSpace(output)
	if authURL == "" || !strings.Contains(authURL, "oauth/authorize") {
		sendJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not get auth URL", "output": output})
		return
	}

	h.mu.Lock()
	h.codeVerifier = podName
	h.mu.Unlock()

	log.Printf("claude auth flow started")
	sendJSON(w, http.StatusOK, map[string]string{
		"authUrl": authURL,
		"message": "Open this URL to authenticate with your Claude subscription. After signing in, copy the authorization code and paste it below.",
	})
}

// ExchangeCode writes the code to the helper and waits for credentials.
func (h *ClaudeHandler) ExchangeCode(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Code == "" {
		sendJSON(w, http.StatusBadRequest, map[string]string{"error": "code is required"})
		return
	}

	h.mu.Lock()
	podName := h.codeVerifier
	h.mu.Unlock()

	if podName == "" {
		sendJSON(w, http.StatusBadRequest, map[string]string{"error": "no auth flow in progress — click Connect first"})
		return
	}

	code := strings.TrimSpace(req.Code)

	// Write code and wait for result
	output, _ := h.execInPod(podName, []string{
		"sh", "-c",
		fmt.Sprintf("node /tmp/claude-auth-helper.js code '%s'", strings.ReplaceAll(code, "'", "'\\''")),
	})

	log.Printf("claude auth exchange output: %s", output)

	// Read credentials
	credOutput, err := h.execInPod(podName, []string{
		"sh", "-c",
		"cat /home/node/.claude/.credentials.json 2>/dev/null || cat /home/node/.codex/auth.json 2>/dev/null || echo '{}'",
	})
	if err != nil {
		sendJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to read credentials"})
		return
	}

	var creds ClaudeCredentials
	if err := json.Unmarshal([]byte(credOutput), &creds); err != nil || creds.Tokens == nil || creds.Tokens.RefreshToken == "" {
		sendJSON(w, http.StatusBadGateway, map[string]string{"error": "authentication did not produce valid credentials — try again", "output": output})
		return
	}

	if creds.Tokens.AccessToken != "" && isJWTExpired(creds.Tokens.AccessToken) {
		sendJSON(w, http.StatusBadGateway, map[string]string{"error": "tokens still expired — authentication may have failed", "output": output})
		return
	}

	// Store in shared secret
	credJSON, _ := json.Marshal(creds)
	secret, err := h.clients.Clientset.CoreV1().Secrets(h.namespace).Get(
		context.Background(), claudeSecretName, metav1.GetOptions{},
	)
	if err != nil {
		secret = &corev1.Secret{
			ObjectMeta: metav1.ObjectMeta{
				Name: claudeSecretName, Namespace: h.namespace,
				Labels: map[string]string{"app.kubernetes.io/managed-by": "agent-office", "agentoffice.ai/credential": "claude-subscription"},
			},
			Data: map[string][]byte{"credentials.json": credJSON},
		}
		_, err = h.clients.Clientset.CoreV1().Secrets(h.namespace).Create(context.Background(), secret, metav1.CreateOptions{})
	} else {
		secret.Data["credentials.json"] = credJSON
		_, err = h.clients.Clientset.CoreV1().Secrets(h.namespace).Update(context.Background(), secret, metav1.UpdateOptions{})
	}
	if err != nil {
		sendJSON(w, http.StatusInternalServerError, map[string]string{"error": fmt.Sprintf("failed to store credentials: %v", err)})
		return
	}

	h.mu.Lock()
	h.codeVerifier = ""
	h.mu.Unlock()

	accountID := "unknown"
	if creds.Tokens != nil && creds.Tokens.AccountID != "" && len(creds.Tokens.AccountID) > 8 {
		accountID = creds.Tokens.AccountID[:8] + "..."
	}
	log.Printf("claude subscription connected (account: %s)", accountID)
	go h.restartAgentPods()

	sendJSON(w, http.StatusOK, map[string]interface{}{
		"ok": true, "accountId": accountID,
		"message": "Claude subscription connected! Agent pods are restarting with new credentials.",
	})
}

// execInPod runs a command in an agent pod using kubectl exec.
func (h *ClaudeHandler) execInPod(podName string, command []string) (string, error) {
	args := []string{
		"exec", podName,
		"-n", h.namespace,
		"-c", "openclaw",
		"--",
	}
	args = append(args, command...)

	cmd := exec.CommandContext(context.Background(), "kubectl", args...)
	cmd.Env = append(os.Environ(), "KUBECONFIG=") // Use in-cluster config
	output, err := cmd.CombinedOutput()
	return string(output), err
}

// isJWTExpired decodes a JWT and checks if it's expired.
func isJWTExpired(token string) bool {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return true // Can't parse — treat as expired
	}

	// Decode payload (part 1), add padding if needed
	payload := parts[1]
	switch len(payload) % 4 {
	case 2:
		payload += "=="
	case 3:
		payload += "="
	}

	decoded, err := base64.URLEncoding.DecodeString(payload)
	if err != nil {
		return true
	}

	var claims struct {
		Exp int64 `json:"exp"`
	}
	if err := json.Unmarshal(decoded, &claims); err != nil {
		return true
	}

	if claims.Exp == 0 {
		return true
	}

	return time.Now().Unix() > claims.Exp
}

func sendJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}
