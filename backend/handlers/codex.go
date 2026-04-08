package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/enterprisewebservice/agent-office/backend/k8s"
)

const codexSecretName = "codex-subscription-credentials"

type CodexHandler struct {
	namespace string
	clients   *k8s.Clients
	mu        sync.Mutex
}

func NewCodexHandler(namespace string, clients *k8s.Clients) *CodexHandler {
	return &CodexHandler{namespace: namespace, clients: clients}
}

type CodexCredentials struct {
	AuthMode string       `json:"auth_mode"`
	Tokens   *CodexTokens `json:"tokens,omitempty"`
}

type CodexTokens struct {
	AccessToken  string `json:"access_token,omitempty"`
	RefreshToken string `json:"refresh_token,omitempty"`
	AccountID    string `json:"account_id,omitempty"`
}

type CodexStatus struct {
	Connected    bool   `json:"connected"`
	AccountID    string `json:"accountId,omitempty"`
	HasRefresh   bool   `json:"hasRefreshToken"`
	SecretExists bool   `json:"secretExists"`
	AuthMode     string `json:"authMode,omitempty"`
}

func (h *CodexHandler) GetStatus(w http.ResponseWriter, r *http.Request) {
	secret, err := h.clients.Clientset.CoreV1().Secrets(h.namespace).Get(
		context.Background(), codexSecretName, metav1.GetOptions{},
	)
	if err != nil {
		sendJSON(w, http.StatusOK, CodexStatus{
			Connected:    false,
			SecretExists: false,
		})
		return
	}

	authData, ok := secret.Data["auth.json"]
	if !ok {
		sendJSON(w, http.StatusOK, CodexStatus{
			Connected:    false,
			SecretExists: true,
		})
		return
	}

	var creds CodexCredentials
	if err := json.Unmarshal(authData, &creds); err != nil {
		sendJSON(w, http.StatusOK, CodexStatus{
			Connected:    false,
			SecretExists: true,
		})
		return
	}

	hasTokens := creds.Tokens != nil && creds.Tokens.RefreshToken != ""
	connected := creds.AuthMode == "chatgpt" && hasTokens
	status := CodexStatus{
		Connected:    connected,
		SecretExists: true,
		HasRefresh:   hasTokens,
		AuthMode:     creds.AuthMode,
	}
	if creds.Tokens != nil && creds.Tokens.AccountID != "" {
		status.AccountID = creds.Tokens.AccountID[:8] + "..."
	}

	sendJSON(w, http.StatusOK, status)
}

func (h *CodexHandler) UpdateCredentials(w http.ResponseWriter, r *http.Request) {
	var creds CodexCredentials
	if err := json.NewDecoder(r.Body).Decode(&creds); err != nil {
		sendJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON: " + err.Error()})
		return
	}

	if creds.AuthMode != "chatgpt" || creds.Tokens == nil || creds.Tokens.AccessToken == "" || creds.Tokens.RefreshToken == "" {
		sendJSON(w, http.StatusBadRequest, map[string]string{
			"error": "credentials must be a Codex/ChatGPT auth.json with auth_mode=chatgpt and access/refresh tokens from ~/.codex/auth.json",
		})
		return
	}

	authJSON, err := json.Marshal(creds)
	if err != nil {
		sendJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	secret, err := h.clients.Clientset.CoreV1().Secrets(h.namespace).Get(
		context.Background(), codexSecretName, metav1.GetOptions{},
	)
	if err != nil {
		secret = &corev1.Secret{
			ObjectMeta: metav1.ObjectMeta{
				Name:      codexSecretName,
				Namespace: h.namespace,
				Labels: map[string]string{
					"app.kubernetes.io/managed-by": "agent-office",
					"agentoffice.ai/credential":    "codex-subscription",
				},
			},
			Data: map[string][]byte{
				"auth.json": authJSON,
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
		secret.Data["auth.json"] = authJSON
		_, err = h.clients.Clientset.CoreV1().Secrets(h.namespace).Update(
			context.Background(), secret, metav1.UpdateOptions{},
		)
		if err != nil {
			sendJSON(w, http.StatusInternalServerError, map[string]string{"error": fmt.Sprintf("updating secret: %v", err)})
			return
		}
	}

	if creds.Tokens.AccountID != "" {
		log.Printf("codex subscription credentials updated (account: %s)", creds.Tokens.AccountID[:8])
	}

	go h.restartAgentPods()

	accountID := ""
	if creds.Tokens.AccountID != "" {
		accountID = creds.Tokens.AccountID[:8] + "..."
	}
	sendJSON(w, http.StatusOK, map[string]interface{}{
		"ok":        true,
		"accountId": accountID,
		"message":   "Codex subscription saved. Agent pods will restart to pick up the updated auth.json.",
	})
}

func (h *CodexHandler) restartAgentPods() {
	pods, err := h.clients.Clientset.CoreV1().Pods(h.namespace).List(
		context.Background(),
		metav1.ListOptions{LabelSelector: "agentoffice.ai/agent"},
	)
	if err != nil {
		log.Printf("failed to list agent pods for Codex restart: %v", err)
		return
	}

	for _, pod := range pods.Items {
		err := h.clients.Clientset.CoreV1().Pods(h.namespace).Delete(
			context.Background(), pod.Name, metav1.DeleteOptions{},
		)
		if err != nil {
			log.Printf("failed to delete pod %s: %v", pod.Name, err)
		} else {
			log.Printf("restarted agent pod after Codex auth update: %s", pod.Name)
		}
	}
}
