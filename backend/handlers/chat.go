package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"

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
}

// NewChatHandler creates a new ChatHandler instance.
func NewChatHandler(namespace string, clients *k8s.Clients) *ChatHandler {
	return &ChatHandler{
		Namespace:   namespace,
		Clients:     clients,
		connections: make(map[string]*proxy.GatewayConnection),
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
	defer h.mu.Unlock()

	if gc, ok := h.connections[name]; ok {
		return gc, nil
	}

	gatewayURL := fmt.Sprintf("http://agent-%s.%s.svc:18789", name, h.Namespace)
	gatewayToken, err := h.getGatewayToken(ctx, name)
	if err != nil {
		// If we can't get the token, try without auth
		log.Printf("warning: could not get gateway token for %s: %v, connecting without auth", name, err)
		gatewayToken = ""
	}

	gc, err := proxy.ConnectToGateway(ctx, gatewayURL, gatewayToken, name)
	if err != nil {
		return nil, err
	}

	h.connections[name] = gc
	return gc, nil
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

		// Get or create gateway connection
		gc, err := h.getOrCreateConnection(r.Context(), name)
		if err != nil {
			log.Printf("gateway connection error for agent %s: %v", name, err)
			errMsg := WSMessage{
				Role:    "assistant",
				Content: fmt.Sprintf("Error connecting to agent: %v", err),
			}
			conn.WriteJSON(errMsg)
			continue
		}

		// Send message to OpenClaw gateway
		response, metadata, err := gc.SendMessage(inMsg.Content)
		if err != nil {
			log.Printf("chat error for agent %s: %v", name, err)
			// Connection may be stale — remove it so next message reconnects
			h.removeConnection(name)
			errMsg := WSMessage{
				Role:    "assistant",
				Content: fmt.Sprintf("Error communicating with agent: %v", err),
			}
			conn.WriteJSON(errMsg)
			continue
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
