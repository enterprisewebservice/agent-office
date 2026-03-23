package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/enterprisewebservice/agent-office/backend/k8s"
)

const (
	defaultTTSModel = "gpt-4o-mini-tts"
	defaultTTSVoice = "marin"
)

type TTSHandler struct {
	namespace string
	clients   *k8s.Clients
	http      *http.Client
}

type ttsRequest struct {
	Text         string `json:"text"`
	Voice        string `json:"voice,omitempty"`
	Instructions string `json:"instructions,omitempty"`
}

type ttsAPIRequest struct {
	Model         string `json:"model"`
	Voice         string `json:"voice"`
	Input         string `json:"input"`
	Instructions  string `json:"instructions,omitempty"`
	ResponseFormat string `json:"response_format"`
}

func NewTTSHandler(namespace string, clients *k8s.Clients) *TTSHandler {
	return &TTSHandler{
		namespace: namespace,
		clients:   clients,
		http: &http.Client{
			Timeout: 60 * time.Second,
		},
	}
}

func (h *TTSHandler) resolveOpenAIKey(ctx context.Context) (string, error) {
	if key := strings.TrimSpace(os.Getenv("OPENAI_API_KEY")); key != "" {
		return key, nil
	}

	secretNames := []string{
		"agent-onboarding-agent-secret",
		"agent-office-openai",
	}

	for _, secretName := range secretNames {
		secret, err := h.clients.Clientset.CoreV1().Secrets(h.namespace).Get(ctx, secretName, metav1.GetOptions{})
		if err != nil {
			continue
		}
		if keyBytes, ok := secret.Data["OPENAI_API_KEY"]; ok && len(keyBytes) > 0 {
			return strings.TrimSpace(string(keyBytes)), nil
		}
	}

	return "", fmt.Errorf("OPENAI_API_KEY not configured for TTS")
}

func (h *TTSHandler) Synthesize(w http.ResponseWriter, r *http.Request) {
	var req ttsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("invalid request body: %v", err), http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	text := strings.TrimSpace(req.Text)
	if text == "" {
		http.Error(w, "text is required", http.StatusBadRequest)
		return
	}

	apiKey, err := h.resolveOpenAIKey(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusServiceUnavailable)
		return
	}

	voice := strings.TrimSpace(req.Voice)
	if voice == "" {
		voice = defaultTTSVoice
	}

	payload := ttsAPIRequest{
		Model:          defaultTTSModel,
		Voice:          voice,
		Input:          text,
		Instructions:   strings.TrimSpace(req.Instructions),
		ResponseFormat: "mp3",
	}

	body, err := json.Marshal(payload)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to encode TTS request: %v", err), http.StatusInternalServerError)
		return
	}

	httpReq, err := http.NewRequestWithContext(r.Context(), http.MethodPost, "https://api.openai.com/v1/audio/speech", bytes.NewReader(body))
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to create TTS request: %v", err), http.StatusInternalServerError)
		return
	}
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := h.http.Do(httpReq)
	if err != nil {
		http.Error(w, fmt.Sprintf("OpenAI TTS request failed: %v", err), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		errBody, _ := io.ReadAll(resp.Body)
		http.Error(w, fmt.Sprintf("OpenAI TTS error %d: %s", resp.StatusCode, strings.TrimSpace(string(errBody))), http.StatusBadGateway)
		return
	}

	audio, err := io.ReadAll(resp.Body)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to read TTS audio: %v", err), http.StatusBadGateway)
		return
	}

	w.Header().Set("Content-Type", "audio/mpeg")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(audio)
}
