package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/enterprisewebservice/agent-office/backend/k8s"
)

const claudeSecretName = "claude-subscription-credentials"

// ClaudeHandler manages Claude subscription credentials.
type ClaudeHandler struct {
	namespace string
	clients   *k8s.Clients
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

	status := ClaudeStatus{
		Connected:    creds.Tokens != nil && creds.Tokens.RefreshToken != "",
		SecretExists: true,
		HasRefresh:   creds.Tokens != nil && creds.Tokens.RefreshToken != "",
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

func sendJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}
