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

// StartAuth runs `claude auth login` in an agent pod, captures the auth URL,
// and stores the CLI process for later code submission.
func (h *ClaudeHandler) StartAuth(w http.ResponseWriter, r *http.Request) {
	// Find an agent pod to run claude auth login in
	pods, err := h.clients.Clientset.CoreV1().Pods(h.namespace).List(
		context.Background(),
		metav1.ListOptions{LabelSelector: "agentoffice.ai/agent"},
	)
	if err != nil || len(pods.Items) == 0 {
		sendJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "no agent pods available to run auth"})
		return
	}

	podName := pods.Items[0].Name

	// Execute claude auth login in the pod and capture the auth URL
	// We use kubectl exec to start the process and capture the URL from stdout
	output, err := h.execInPod(podName, []string{
		"sh", "-c",
		"HOME=/home/node BROWSER=echo DISPLAY= timeout 5 claude auth login --claudeai 2>&1 || true",
	})
	if err != nil {
		sendJSON(w, http.StatusInternalServerError, map[string]string{"error": fmt.Sprintf("failed to start auth: %v", err)})
		return
	}

	// Extract the auth URL from the output
	authURL := ""
	for _, line := range strings.Split(output, "\n") {
		if strings.Contains(line, "claude.ai/oauth/authorize") || strings.Contains(line, "platform.claude.com/oauth") {
			// Find the URL in the line
			for _, word := range strings.Fields(line) {
				if strings.HasPrefix(word, "https://") {
					authURL = word
					break
				}
			}
		}
	}

	if authURL == "" {
		sendJSON(w, http.StatusInternalServerError, map[string]string{
			"error": "could not extract auth URL from claude CLI output",
			"output": output,
		})
		return
	}

	// Store the pod name for the code exchange step
	h.mu.Lock()
	h.codeVerifier = podName // Reuse field to store pod name
	h.mu.Unlock()

	log.Printf("claude auth flow started, URL generated")

	sendJSON(w, http.StatusOK, map[string]string{
		"authUrl": authURL,
		"message": "Open this URL to authenticate with your Claude subscription. After signing in, copy the authorization code and paste it below.",
	})
}

// ExchangeCode feeds the authorization code to `claude auth login` running in the pod,
// then reads the resulting credentials and stores them in the shared secret.
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
		sendJSON(w, http.StatusBadRequest, map[string]string{"error": "no auth flow in progress — click 'Connect' first"})
		return
	}

	// Run claude auth login with the code piped to stdin
	// The CLI reads the code from stdin when browser isn't available
	output, err := h.execInPod(podName, []string{
		"sh", "-c",
		fmt.Sprintf(`echo '%s' | HOME=/home/node BROWSER=echo DISPLAY= claude auth login --claudeai 2>&1; echo "EXIT:$?"`, strings.ReplaceAll(req.Code, "'", "\\'")),
	})

	log.Printf("claude auth exchange output: %s", output)

	if err != nil {
		sendJSON(w, http.StatusInternalServerError, map[string]string{"error": fmt.Sprintf("auth exchange failed: %v", err)})
		return
	}

	// Check if auth succeeded by reading the credentials file
	credOutput, err := h.execInPod(podName, []string{
		"sh", "-c",
		"cat /home/node/.claude/.credentials.json 2>/dev/null || cat /home/node/.codex/auth.json 2>/dev/null || echo '{}'",
	})
	if err != nil {
		sendJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to read credentials after auth"})
		return
	}

	// Validate the credentials have fresh tokens
	var creds ClaudeCredentials
	if err := json.Unmarshal([]byte(credOutput), &creds); err != nil || creds.Tokens == nil || creds.Tokens.RefreshToken == "" {
		sendJSON(w, http.StatusBadGateway, map[string]string{
			"error":  "authentication did not produce valid credentials",
			"output": output,
		})
		return
	}

	// Check if the access token is fresh (not expired)
	if creds.Tokens.AccessToken != "" && isJWTExpired(creds.Tokens.AccessToken) {
		sendJSON(w, http.StatusBadGateway, map[string]string{
			"error":  "authentication produced expired tokens — please try again",
			"output": output,
		})
		return
	}

	// Store in K8s shared secret
	credJSON, _ := json.Marshal(creds)

	secret, err := h.clients.Clientset.CoreV1().Secrets(h.namespace).Get(
		context.Background(), claudeSecretName, metav1.GetOptions{},
	)
	if err != nil {
		secret = &corev1.Secret{
			ObjectMeta: metav1.ObjectMeta{
				Name:      claudeSecretName,
				Namespace: h.namespace,
				Labels: map[string]string{
					"app.kubernetes.io/managed-by": "agent-office",
					"agentoffice.ai/credential":    "claude-subscription",
				},
			},
			Data: map[string][]byte{"credentials.json": credJSON},
		}
		_, err = h.clients.Clientset.CoreV1().Secrets(h.namespace).Create(
			context.Background(), secret, metav1.CreateOptions{},
		)
	} else {
		secret.Data["credentials.json"] = credJSON
		_, err = h.clients.Clientset.CoreV1().Secrets(h.namespace).Update(
			context.Background(), secret, metav1.UpdateOptions{},
		)
	}

	if err != nil {
		sendJSON(w, http.StatusInternalServerError, map[string]string{"error": fmt.Sprintf("failed to store credentials: %v", err)})
		return
	}

	h.mu.Lock()
	h.codeVerifier = ""
	h.mu.Unlock()

	accountID := "unknown"
	if creds.Tokens.AccountID != "" && len(creds.Tokens.AccountID) > 8 {
		accountID = creds.Tokens.AccountID[:8] + "..."
	}

	log.Printf("claude subscription connected (account: %s)", accountID)
	go h.restartAgentPods()

	sendJSON(w, http.StatusOK, map[string]interface{}{
		"ok":        true,
		"accountId": accountID,
		"message":   "Claude subscription connected! Agent pods are restarting with new credentials.",
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
