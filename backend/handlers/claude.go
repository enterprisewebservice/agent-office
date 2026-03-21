package handlers

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
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

// StartAuth initiates the OAuth flow and returns the authorization URL.
func (h *ClaudeHandler) StartAuth(w http.ResponseWriter, r *http.Request) {
	// Generate PKCE code verifier (43-128 chars, URL-safe)
	verifierBytes := make([]byte, 32)
	if _, err := rand.Read(verifierBytes); err != nil {
		sendJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to generate verifier"})
		return
	}
	codeVerifier := base64.RawURLEncoding.EncodeToString(verifierBytes)

	// Generate code challenge (S256)
	hash := sha256.Sum256([]byte(codeVerifier))
	codeChallenge := base64.RawURLEncoding.EncodeToString(hash[:])

	// Generate state parameter
	stateBytes := make([]byte, 32)
	rand.Read(stateBytes)
	state := base64.RawURLEncoding.EncodeToString(stateBytes)

	// Store verifier for the callback
	h.mu.Lock()
	h.codeVerifier = codeVerifier
	h.mu.Unlock()

	// Build authorization URL
	params := url.Values{
		"code":                  {"true"},
		"client_id":             {claudeClientID},
		"response_type":         {"code"},
		"redirect_uri":          {claudeRedirectURI},
		"scope":                 {claudeScope},
		"code_challenge":        {codeChallenge},
		"code_challenge_method": {"S256"},
		"state":                 {state},
	}

	authURL := claudeAuthURL + "?" + params.Encode()

	log.Printf("claude auth flow started")

	sendJSON(w, http.StatusOK, map[string]string{
		"authUrl": authURL,
		"message": "Open this URL to authenticate with your Claude subscription. After authenticating, you'll receive a code — paste it back here.",
	})
}

// ExchangeCode exchanges an authorization code for tokens and stores them.
func (h *ClaudeHandler) ExchangeCode(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Code == "" {
		sendJSON(w, http.StatusBadRequest, map[string]string{"error": "code is required"})
		return
	}

	h.mu.Lock()
	codeVerifier := h.codeVerifier
	h.mu.Unlock()

	if codeVerifier == "" {
		sendJSON(w, http.StatusBadRequest, map[string]string{"error": "no auth flow in progress — click 'Connect' first"})
		return
	}

	// Exchange code for tokens
	tokenReq := url.Values{
		"grant_type":    {"authorization_code"},
		"client_id":     {claudeClientID},
		"code":          {req.Code},
		"redirect_uri":  {claudeRedirectURI},
		"code_verifier": {codeVerifier},
	}

	resp, err := http.PostForm(claudeTokenURL, tokenReq)
	if err != nil {
		sendJSON(w, http.StatusInternalServerError, map[string]string{"error": fmt.Sprintf("token exchange failed: %v", err)})
		return
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != 200 {
		sendJSON(w, http.StatusBadGateway, map[string]string{
			"error": fmt.Sprintf("token exchange returned %d: %s", resp.StatusCode, string(body)),
		})
		return
	}

	// Parse token response
	var tokenResp struct {
		IDToken      string `json:"id_token"`
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		AccountID    string `json:"account_id"`
	}
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		sendJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to parse token response"})
		return
	}

	if tokenResp.RefreshToken == "" {
		sendJSON(w, http.StatusBadGateway, map[string]string{"error": "no refresh token received — authentication may have failed"})
		return
	}

	// Build credentials in Claude Code format
	creds := map[string]interface{}{
		"OPENAI_API_KEY": nil,
		"tokens": map[string]string{
			"id_token":      tokenResp.IDToken,
			"access_token":  tokenResp.AccessToken,
			"refresh_token": tokenResp.RefreshToken,
			"account_id":    tokenResp.AccountID,
		},
	}

	credJSON, _ := json.Marshal(creds)

	// Store in K8s secret
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

	// Clear the verifier
	h.mu.Lock()
	h.codeVerifier = ""
	h.mu.Unlock()

	log.Printf("claude subscription connected (account: %s)", tokenResp.AccountID[:8])

	// Restart agent pods
	go h.restartAgentPods()

	sendJSON(w, http.StatusOK, map[string]interface{}{
		"ok":        true,
		"accountId": tokenResp.AccountID[:8] + "...",
		"message":   "Claude subscription connected! Agent pods are restarting with new credentials.",
	})
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
