package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/enterprisewebservice/agent-office/backend/k8s"
	"github.com/enterprisewebservice/agent-office/backend/proxy"
)

// WSMessage defines the WebSocket message format for chat.
type WSMessage struct {
	Role     string            `json:"role"`
	Content  string            `json:"content"`
	Metadata map[string]string `json:"metadata,omitempty"`
}

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

// ChatHandler holds dependencies for the WebSocket chat handler.
type ChatHandler struct {
	Namespace string
	Clients   *k8s.Clients

	// Cache gateway connections per agent to maintain session state
	mu          sync.Mutex
	connections map[string]*proxy.GatewayConnection
	devices     map[string]*proxy.DeviceIdentity
}

type sessionLogEntry struct {
	Type      string `json:"type"`
	ID        string `json:"id"`
	ParentID  string `json:"parentId"`
	Timestamp string `json:"timestamp"`
	Message   *struct {
		Role       string `json:"role"`
		ToolName   string `json:"toolName"`
		ToolCallID string `json:"toolCallId"`
		Content    []struct {
			Type      string          `json:"type"`
			Text      string          `json:"text"`
			Name      string          `json:"name"`
			Arguments json.RawMessage `json:"arguments"`
		} `json:"content"`
	} `json:"message"`
}

type bridgeSessionEntry struct {
	SessionID   string `json:"sessionId"`
	AgentID     string `json:"agentId"`
	TaskLabel   string `json:"taskLabel"`
	Status      string `json:"status"`
	LastUsedAt  string `json:"lastUsedAt"`
	MessageCount int   `json:"messageCount"`
}

type bridgeSessionIndex struct {
	Version  int                  `json:"version"`
	Sessions []bridgeSessionEntry `json:"sessions"`
}

type AgentSessionState struct {
	AgentName              string   `json:"agentName"`
	CachedConnection       bool     `json:"cachedConnection"`
	OpenClawSessionCount   int      `json:"openclawSessionCount"`
	OpenClawLatestFile     string   `json:"openclawLatestFile,omitempty"`
	LastUserMessage        string   `json:"lastUserMessage,omitempty"`
	LastAssistantMessage   string   `json:"lastAssistantMessage,omitempty"`
	ClaudeBridgeSessionCount int    `json:"claudeBridgeSessionCount"`
	ClaudeActiveSessionCount int    `json:"claudeActiveSessionCount"`
	ClaudeHistoricalSessionCount int `json:"claudeHistoricalSessionCount"`
	ClaudeActiveTaskLabels []string `json:"claudeActiveTaskLabels,omitempty"`
	ClaudeRecentTaskLabels []string `json:"claudeRecentTaskLabels,omitempty"`
}

type sessionActionResponse struct {
	OK      bool              `json:"ok"`
	Message string            `json:"message"`
	State   AgentSessionState `json:"state"`
}

// NewChatHandler creates a new ChatHandler instance.
func NewChatHandler(namespace string, clients *k8s.Clients) *ChatHandler {
	return &ChatHandler{
		Namespace:   namespace,
		Clients:     clients,
		connections: make(map[string]*proxy.GatewayConnection),
		devices:     make(map[string]*proxy.DeviceIdentity),
	}
}

// getGatewayToken reads the gateway token from the agent's Secret.
func (h *ChatHandler) getGatewayToken(ctx context.Context, name string) (string, error) {
	secretName := fmt.Sprintf("agent-%s-secret", name)
	secret, err := h.Clients.Clientset.CoreV1().Secrets(h.Namespace).Get(ctx, secretName, metav1.GetOptions{})
	if err != nil {
		return "", fmt.Errorf("getting secret %s: %w", secretName, err)
	}
	token, ok := secret.Data["OPENCLAW_GATEWAY_TOKEN"]
	if !ok {
		return "", fmt.Errorf("OPENCLAW_GATEWAY_TOKEN not found in secret %s", secretName)
	}
	return string(token), nil
}

// getOrCreateConnection returns a cached gateway connection or creates a new one.
func (h *ChatHandler) getOrCreateConnection(ctx context.Context, name string) (*proxy.GatewayConnection, error) {
	h.mu.Lock()
	if gc, ok := h.connections[name]; ok {
		h.mu.Unlock()
		return gc, nil
	}

	device := h.devices[name]
	if device == nil {
		var err error
		device, err = proxy.NewDeviceIdentity()
		if err != nil {
			h.mu.Unlock()
			return nil, fmt.Errorf("creating device identity: %w", err)
		}
		h.devices[name] = device
	}
	h.mu.Unlock()

	gatewayURL := fmt.Sprintf("http://agent-%s.%s.svc:18789", name, h.Namespace)
	gatewayToken, err := h.getGatewayToken(ctx, name)
	if err != nil {
		// If we can't get the token, try without auth
		log.Printf("warning: could not get gateway token for %s: %v, connecting without auth", name, err)
		gatewayToken = ""
	}

	if err := h.ensureBackendDevicePaired(ctx, name, device); err != nil {
		return nil, fmt.Errorf("ensuring backend device pairing: %w", err)
	}

	gc, err := proxy.ConnectToGateway(ctx, gatewayURL, gatewayToken, name, device)
	if err != nil {
		return nil, err
	}

	h.mu.Lock()
	defer h.mu.Unlock()
	h.connections[name] = gc
	return gc, nil
}

func (h *ChatHandler) sendMessageWithReconnect(ctx context.Context, name, content string) (string, map[string]string, error) {
	gc, err := h.getOrCreateConnection(ctx, name)
	if err != nil {
		return "", nil, err
	}

	response, metadata, err := gc.SendMessage(content)
	if err == nil {
		return response, metadata, nil
	}

	log.Printf("gateway send failed for agent %s, reconnecting once: %v", name, err)
	h.removeConnection(name)

	gc, reconnectErr := h.getOrCreateConnection(ctx, name)
	if reconnectErr != nil {
		return "", nil, fmt.Errorf("%v (reconnect failed: %w)", err, reconnectErr)
	}

	response, metadata, retryErr := gc.SendMessage(content)
	if retryErr != nil {
		h.removeConnection(name)
		return "", nil, retryErr
	}

	return response, metadata, nil
}

// removeConnection removes a cached gateway connection.
func (h *ChatHandler) removeConnection(name string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if gc, ok := h.connections[name]; ok {
		gc.Close()
		delete(h.connections, name)
	}
}

func (h *ChatHandler) ensureBackendDevicePaired(ctx context.Context, name string, device *proxy.DeviceIdentity) error {
	podName, err := h.findAgentPod(ctx, name)
	if err != nil {
		return err
	}

	script := `
const fs = require("fs");
const path = "/home/node/.openclaw/devices/paired.json";
const deviceId = process.argv[1];
const publicKey = process.argv[2];
const now = Date.now();
let state = {};
try {
  state = JSON.parse(fs.readFileSync(path, "utf8"));
} catch {}
if (!state || typeof state !== "object" || Array.isArray(state)) {
  state = {};
}
const existing = state[deviceId] || {};
state[deviceId] = {
  deviceId,
  publicKey,
  displayName: "Agent Office Backend",
  clientId: "gateway-client",
  clientMode: "backend",
  role: "operator",
  roles: ["operator"],
  scopes: ["operator.write"],
  approvedScopes: ["operator.write"],
  tokens: existing.tokens || {},
  createdAtMs: existing.createdAtMs || now,
  approvedAtMs: now
};
fs.mkdirSync(require("path").dirname(path), { recursive: true });
fs.writeFileSync(path, JSON.stringify(state, null, 2) + "\n");
`

	_, err = h.execInAgentPod(ctx, podName, []string{
		"node",
		"-e",
		script,
		device.DeviceID,
		device.PublicKey,
	})
	if err != nil {
		return fmt.Errorf("upserting paired device in %s: %w", podName, err)
	}
	return nil
}

func (h *ChatHandler) findAgentPod(ctx context.Context, name string) (string, error) {
	pods, err := h.Clients.Clientset.CoreV1().Pods(h.Namespace).List(ctx, metav1.ListOptions{
		LabelSelector: fmt.Sprintf("agentoffice.ai/agent=%s", name),
	})
	if err != nil {
		return "", fmt.Errorf("listing pods for %s: %w", name, err)
	}

	for _, pod := range pods.Items {
		if pod.Status.Phase == "Running" {
			return pod.Name, nil
		}
	}
	if len(pods.Items) == 0 {
		return "", fmt.Errorf("no pods found for agent %s", name)
	}
	return "", fmt.Errorf("no running pod found for agent %s", name)
}

func (h *ChatHandler) execInAgentPod(ctx context.Context, podName string, command []string) (string, error) {
	args := []string{
		"exec", podName,
		"-n", h.Namespace,
		"-c", "openclaw",
		"--",
	}
	args = append(args, command...)

	cmd := exec.CommandContext(ctx, "kubectl", args...)
	cmd.Env = append(os.Environ(), "KUBECONFIG=")
	output, err := cmd.CombinedOutput()
	return string(output), err
}

func extractEntryText(entry sessionLogEntry) string {
	if entry.Message == nil {
		return ""
	}

	var parts []string
	for _, content := range entry.Message.Content {
		if content.Type == "text" && content.Text != "" {
			parts = append(parts, content.Text)
		}
	}
	return strings.Join(parts, "")
}

func parseEntryTime(raw string) time.Time {
	if raw == "" {
		return time.Time{}
	}
	t, err := time.Parse(time.RFC3339Nano, raw)
	if err != nil {
		return time.Time{}
	}
	return t
}

func normalizePrompt(prompt string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(prompt)), " ")
}

func promptsMatch(a, b string) bool {
	na := normalizePrompt(a)
	nb := normalizePrompt(b)
	if na == "" || nb == "" {
		return false
	}
	return na == nb || strings.Contains(na, nb) || strings.Contains(nb, na)
}

func truncateForDisplay(text string) string {
	trimmed := strings.Join(strings.Fields(strings.TrimSpace(text)), " ")
	if len(trimmed) <= 140 {
		return trimmed
	}
	return trimmed[:137] + "..."
}

func uniqueStrings(values []string) []string {
	seen := map[string]struct{}{}
	var out []string
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}

func (h *ChatHandler) readLatestSessionEntries(ctx context.Context, agentName string) ([]sessionLogEntry, string, error) {
	podName, err := h.findAgentPod(ctx, agentName)
	if err != nil {
		return nil, "", err
	}

	latestFile, err := h.execInAgentPod(ctx, podName, []string{
		"sh", "-lc",
		"ls -1t /home/node/.openclaw/agents/main/sessions/*.jsonl 2>/dev/null | head -n 1",
	})
	if err != nil {
		return nil, "", err
	}
	latestFile = strings.TrimSpace(latestFile)
	if latestFile == "" {
		return nil, "", nil
	}

	output, err := h.execInAgentPod(ctx, podName, []string{"cat", latestFile})
	if err != nil {
		return nil, latestFile, err
	}

	var entries []sessionLogEntry
	decoder := json.NewDecoder(bytes.NewBufferString(output))
	for decoder.More() {
		var entry sessionLogEntry
		if err := decoder.Decode(&entry); err != nil {
			continue
		}
		entries = append(entries, entry)
	}

	return entries, latestFile, nil
}

func (h *ChatHandler) readBridgeSessionIndex(ctx context.Context, agentName string) (bridgeSessionIndex, error) {
	podName, err := h.findAgentPod(ctx, agentName)
	if err != nil {
		return bridgeSessionIndex{}, err
	}

	output, err := h.execInAgentPod(ctx, podName, []string{
		"sh", "-lc",
		"cat /home/node/.claude/bridge-sessions.json 2>/dev/null || echo '{\"version\":1,\"sessions\":[]}'",
	})
	if err != nil {
		return bridgeSessionIndex{}, err
	}

	var index bridgeSessionIndex
	if err := json.Unmarshal([]byte(output), &index); err != nil {
		return bridgeSessionIndex{}, err
	}
	return index, nil
}

func (h *ChatHandler) getSessionState(ctx context.Context, agentName string) (AgentSessionState, error) {
	state := AgentSessionState{AgentName: agentName}

	h.mu.Lock()
	_, state.CachedConnection = h.connections[agentName]
	h.mu.Unlock()

	podName, err := h.findAgentPod(ctx, agentName)
	if err != nil {
		return state, err
	}

	countOutput, err := h.execInAgentPod(ctx, podName, []string{
		"sh", "-lc",
		"find /home/node/.openclaw/agents/main/sessions -maxdepth 1 -name '*.jsonl' 2>/dev/null | wc -l | tr -d ' '",
	})
	if err == nil {
		if count, parseErr := strconv.Atoi(strings.TrimSpace(countOutput)); parseErr == nil {
			state.OpenClawSessionCount = count
		}
	}

	entries, latestFile, err := h.readLatestSessionEntries(ctx, agentName)
	if err == nil {
		state.OpenClawLatestFile = strings.TrimSpace(latestFile)
		for i := len(entries) - 1; i >= 0; i-- {
			entry := entries[i]
			if entry.Message == nil {
				continue
			}
			switch entry.Message.Role {
			case "user":
				if state.LastUserMessage == "" {
					state.LastUserMessage = truncateForDisplay(extractEntryText(entry))
				}
			case "assistant":
				if state.LastAssistantMessage == "" {
					state.LastAssistantMessage = truncateForDisplay(extractEntryText(entry))
				}
			}
			if state.LastUserMessage != "" && state.LastAssistantMessage != "" {
				break
			}
		}
	}

	index, err := h.readBridgeSessionIndex(ctx, agentName)
	if err == nil {
		var activeLabels []string
		var recentLabels []string
		for _, session := range index.Sessions {
			if !strings.Contains(session.AgentID, agentName) {
				continue
			}
			state.ClaudeBridgeSessionCount++
			if session.Status == "active" {
				state.ClaudeActiveSessionCount++
			} else {
				state.ClaudeHistoricalSessionCount++
			}
			if session.Status == "active" {
				activeLabels = append(activeLabels, session.TaskLabel)
			}
			recentLabels = append(recentLabels, session.TaskLabel)
		}
		state.ClaudeActiveTaskLabels = uniqueStrings(activeLabels)
		state.ClaudeRecentTaskLabels = uniqueStrings(recentLabels)
	}

	return state, nil
}

func (h *ChatHandler) resetAgentSessions(ctx context.Context, agentName string, clearBridge bool) error {
	podName, err := h.findAgentPod(ctx, agentName)
	if err != nil {
		return err
	}

	h.removeConnection(agentName)

	script := `
const fs = require("fs");
const path = require("path");
const agentName = process.argv[1];
const clearBridge = process.argv[2] === "true";

const sessionDir = "/home/node/.openclaw/agents/main/sessions";
const backupDir = "/home/node/.openclaw/agents/main/sessions.backup";
fs.mkdirSync(backupDir, { recursive: true });
for (const entry of fs.readdirSync(sessionDir, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
  fs.renameSync(path.join(sessionDir, entry.name), path.join(backupDir, entry.name));
}

if (clearBridge) {
  const bridgePath = "/home/node/.claude/bridge-sessions.json";
  let data = { version: 1, sessions: [] };
  try { data = JSON.parse(fs.readFileSync(bridgePath, "utf8")); } catch {}
  const removed = [];
  data.sessions = (data.sessions || []).filter((session) => {
    const id = session?.agentId || "";
    if (!id.includes(agentName)) return true;
    removed.push(session.sessionId);
    return false;
  });
  fs.writeFileSync(bridgePath, JSON.stringify(data, null, 2) + "\n");
  for (const sessionId of removed) {
    const transcriptPath = "/home/node/.claude/projects/-home-node--openclaw-workspace/" + sessionId + ".jsonl";
    try { fs.unlinkSync(transcriptPath); } catch {}
  }
}
`

	_, err = h.execInAgentPod(ctx, podName, []string{
		"node",
		"-e",
		script,
		agentName,
		strconv.FormatBool(clearBridge),
	})
	return err
}

func collectToolNames(entries []sessionLogEntry, userEntry sessionLogEntry) []string {
	seen := map[string]struct{}{}
	var tools []string
	startCollecting := false

	for _, entry := range entries {
		if entry.ID == userEntry.ID {
			startCollecting = true
			continue
		}
		if !startCollecting || entry.Message == nil {
			continue
		}

		if entry.Message.Role == "assistant" {
			for _, content := range entry.Message.Content {
				if content.Type != "toolCall" || content.Name == "" {
					continue
				}
				if _, ok := seen[content.Name]; ok {
					continue
				}
				seen[content.Name] = struct{}{}
				tools = append(tools, content.Name)
			}
		}

		if entry.Message.Role == "toolResult" && entry.Message.ToolName != "" {
			if _, ok := seen[entry.Message.ToolName]; ok {
				continue
			}
			seen[entry.Message.ToolName] = struct{}{}
			tools = append(tools, entry.Message.ToolName)
		}
	}

	return tools
}

func (h *ChatHandler) getVerifiedTools(ctx context.Context, agentName, prompt string, startedAt time.Time) ([]string, error) {
	podName, err := h.findAgentPod(ctx, agentName)
	if err != nil {
		return nil, err
	}

	output, err := h.execInAgentPod(ctx, podName, []string{
		"sh", "-lc",
		"ls -1t /home/node/.openclaw/agents/main/sessions/*.jsonl 2>/dev/null | head -n 3 | xargs -r cat",
	})
	if err != nil {
		return nil, fmt.Errorf("reading session logs in pod %s: %w", podName, err)
	}

	normalizedPrompt := normalizePrompt(prompt)
	if normalizedPrompt == "" {
		return nil, nil
	}

	var entries []sessionLogEntry
	decoder := json.NewDecoder(bytes.NewBufferString(output))
	for decoder.More() {
		var entry sessionLogEntry
		if err := decoder.Decode(&entry); err != nil {
			continue
		}
		entries = append(entries, entry)
	}

	sort.Slice(entries, func(i, j int) bool {
		return parseEntryTime(entries[i].Timestamp).Before(parseEntryTime(entries[j].Timestamp))
	})

	threshold := startedAt.Add(-10 * time.Second)
	for i := len(entries) - 1; i >= 0; i-- {
		entry := entries[i]
		if entry.Type != "message" || entry.Message == nil || entry.Message.Role != "user" {
			continue
		}
		if t := parseEntryTime(entry.Timestamp); !t.IsZero() && t.Before(threshold) {
			break
		}
		if !promptsMatch(extractEntryText(entry), normalizedPrompt) {
			continue
		}
		return collectToolNames(entries[i:], entry), nil
	}

	return nil, nil
}

func (h *ChatHandler) HandleSessionState(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if name == "" {
		http.Error(w, "agent name is required", http.StatusBadRequest)
		return
	}

	state, err := h.getSessionState(r.Context(), name)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to read session state: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(state)
}

func (h *ChatHandler) HandleFreshSession(w http.ResponseWriter, r *http.Request) {
	h.handleSessionReset(w, r, false)
}

func (h *ChatHandler) HandleResetSessions(w http.ResponseWriter, r *http.Request) {
	h.handleSessionReset(w, r, true)
}

func (h *ChatHandler) handleSessionReset(w http.ResponseWriter, r *http.Request, clearBridge bool) {
	name := r.PathValue("name")
	if name == "" {
		http.Error(w, "agent name is required", http.StatusBadRequest)
		return
	}

	if err := h.resetAgentSessions(r.Context(), name, clearBridge); err != nil {
		http.Error(w, fmt.Sprintf("failed to reset sessions: %v", err), http.StatusInternalServerError)
		return
	}

	state, err := h.getSessionState(r.Context(), name)
	if err != nil {
		http.Error(w, fmt.Sprintf("reset succeeded but state lookup failed: %v", err), http.StatusInternalServerError)
		return
	}

	message := "Started a fresh OpenClaw chat session."
	if clearBridge {
		message = "Reset OpenClaw chat and Claude bridge sessions."
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(sessionActionResponse{
		OK:      true,
		Message: message,
		State:   state,
	})
}

// HandleChat upgrades the connection to WebSocket and proxies messages
// to the agent's OpenClaw gateway via its WebSocket protocol.
func (h *ChatHandler) HandleChat(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if name == "" {
		http.Error(w, "agent name is required", http.StatusBadRequest)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("websocket upgrade failed for agent %s: %v", name, err)
		return
	}
	defer conn.Close()

	log.Printf("websocket connected for agent %s", name)

	for {
		// Read message from client
		_, msgBytes, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				log.Printf("websocket read error for agent %s: %v", name, err)
			}
			break
		}

		// Parse incoming message
		var inMsg WSMessage
		if err := json.Unmarshal(msgBytes, &inMsg); err != nil {
			log.Printf("invalid message format from client: %v", err)
			errMsg := WSMessage{
				Role:    "assistant",
				Content: "Error: invalid message format",
			}
			conn.WriteJSON(errMsg)
			continue
		}

		startedAt := time.Now().UTC()

		// Send message to the agent, retrying once if the cached gateway
		// connection died during a pod restart or gateway reconnect.
		response, metadata, err := h.sendMessageWithReconnect(r.Context(), name, inMsg.Content)
		if err != nil {
			log.Printf("gateway connection error for agent %s: %v", name, err)
			errMsg := WSMessage{
				Role:    "assistant",
				Content: fmt.Sprintf("Error connecting to agent: %v", err),
			}
			conn.WriteJSON(errMsg)
			continue
		}

		if metadata == nil {
			metadata = make(map[string]string)
		}
		if strings.TrimSpace(metadata["tools"]) == "" {
			verifiedTools, verifyErr := h.getVerifiedTools(r.Context(), name, inMsg.Content, startedAt)
			if verifyErr != nil {
				log.Printf("verified tool lookup failed for agent %s: %v", name, verifyErr)
			} else if len(verifiedTools) > 0 {
				metadata["tools"] = strings.Join(verifiedTools, ", ")
				metadata["tools_source"] = "session_log"
				log.Printf("verified tools from session log for agent %s: %s", name, metadata["tools"])
			}
		}

		// Build response message
		outMsg := WSMessage{
			Role:    "assistant",
			Content: response,
		}
		if len(metadata) > 0 {
			outMsg.Metadata = metadata
		}

		if err := conn.WriteJSON(outMsg); err != nil {
			log.Printf("websocket write error for agent %s: %v", name, err)
			break
		}
	}

	// Don't close the gateway connection on disconnect —
	// it preserves session state for when the user reconnects
}
