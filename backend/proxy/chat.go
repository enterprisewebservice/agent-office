package proxy

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// OpenClaw Gateway WebSocket protocol v3 frame types.

// RequestFrame sends an RPC request to the OpenClaw gateway.
type RequestFrame struct {
	Type   string      `json:"type"`
	ID     string      `json:"id"`
	Method string      `json:"method"`
	Params interface{} `json:"params,omitempty"`
}

// ResponseFrame is the RPC response from the gateway.
type ResponseFrame struct {
	Type   string          `json:"type"`
	ID     string          `json:"id"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  *RPCError       `json:"error,omitempty"`
}

// EventFrame is a server-pushed event from the gateway.
type EventFrame struct {
	Type  string          `json:"type"`
	Event string          `json:"event"`
	Data  json.RawMessage `json:"data,omitempty"`
}

// RPCError describes an error in an RPC response.
type RPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// ChatSendArgs are the arguments for the chat.send RPC method.
type ChatSendArgs struct {
	SessionKey     string `json:"sessionKey"`
	Message        string `json:"message"`
	IdempotencyKey string `json:"idempotencyKey"`
}

// ChatEvent is the data payload in chat event frames.
type ChatEvent struct {
	State        string       `json:"state"`        // "delta", "final", "error", "aborted"
	Content      string       `json:"content"`      // text content (legacy)
	Message      *ChatMessage `json:"message"`      // v3: structured message
	RunID        string       `json:"runId,omitempty"`
	Error        string       `json:"error,omitempty"`
	ErrorMessage string       `json:"errorMessage,omitempty"`
}

// ChatMessage is the v3 message format inside chat events.
type ChatMessage struct {
	Role    string        `json:"role"`
	Content []ContentPart `json:"content"`
}

// ContentPart is a typed content block.
type ContentPart struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

// GetText extracts text from a ChatEvent, handling both legacy and v3 formats.
func (ce *ChatEvent) GetText() string {
	if ce.Content != "" {
		return ce.Content
	}
	if ce.Message != nil {
		var parts []string
		for _, p := range ce.Message.Content {
			if p.Type == "text" && p.Text != "" {
				parts = append(parts, p.Text)
			}
		}
		return strings.Join(parts, "")
	}
	return ""
}

// GetError extracts error message from a ChatEvent.
func (ce *ChatEvent) GetError() string {
	if ce.ErrorMessage != "" {
		return ce.ErrorMessage
	}
	return ce.Error
}

// GatewayConnection manages a WebSocket connection to an OpenClaw gateway.
type GatewayConnection struct {
	conn         *websocket.Conn
	mu           sync.Mutex
	gatewayURL   string
	gatewayToken string
	sessionKey   string
}

// ConnectToGateway establishes a WebSocket connection to an OpenClaw gateway
// and completes the authentication handshake.
func ConnectToGateway(ctx context.Context, gatewayURL, gatewayToken, agentName string) (*GatewayConnection, error) {
	// Convert http:// to ws://
	wsURL := strings.Replace(gatewayURL, "http://", "ws://", 1)
	wsURL = strings.Replace(wsURL, "https://", "wss://", 1)
	wsURL = strings.TrimRight(wsURL, "/")

	dialer := websocket.Dialer{
		HandshakeTimeout: 10 * time.Second,
	}

	conn, _, err := dialer.DialContext(ctx, wsURL, nil)
	if err != nil {
		return nil, fmt.Errorf("connecting to gateway %s: %w", wsURL, err)
	}

	gc := &GatewayConnection{
		conn:         conn,
		gatewayURL:   wsURL,
		gatewayToken: gatewayToken,
		sessionKey:   fmt.Sprintf("agent-office:%s", agentName),
	}

	// Complete the auth handshake: read challenge, send auth response
	if err := gc.authenticate(ctx); err != nil {
		conn.Close()
		return nil, fmt.Errorf("gateway auth failed: %w", err)
	}

	return gc, nil
}

// authenticate handles the OpenClaw gateway protocol v3 handshake.
// 1. Read connect.challenge event
// 2. Send connect request with auth, protocol version, and client identity
// 3. Read connect response (hello-ok or error)
func (gc *GatewayConnection) authenticate(ctx context.Context) error {
	// Read the connect.challenge frame
	_, msg, err := gc.conn.ReadMessage()
	if err != nil {
		return fmt.Errorf("reading challenge: %w", err)
	}

	// Parse it — we expect an event frame with event "connect.challenge"
	var frame map[string]interface{}
	if err := json.Unmarshal(msg, &frame); err != nil {
		log.Printf("gateway did not send valid challenge frame, proceeding without auth")
		return nil
	}

	// Send protocol v3 connect request
	connectReq := RequestFrame{
		Type:   "req",
		ID:     uuid.New().String(),
		Method: "connect",
		Params: map[string]interface{}{
			"minProtocol": 3,
			"maxProtocol": 3,
			"client": map[string]string{
				"id":       "cli",
				"platform": "node",
				"mode":     "cli",
				"version":  "0.1.0",
			},
			"auth": map[string]string{
				"token":    gc.gatewayToken,
				"password": gc.gatewayToken,
			},
			"scopes": []string{"operator.write"},
		},
	}

	gc.mu.Lock()
	err = gc.conn.WriteJSON(connectReq)
	gc.mu.Unlock()
	if err != nil {
		return fmt.Errorf("sending connect: %w", err)
	}

	// Read connect response
	_, msg, err = gc.conn.ReadMessage()
	if err != nil {
		return fmt.Errorf("reading auth response: %w", err)
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(msg, &resp); err != nil {
		return fmt.Errorf("parsing auth response: %w", err)
	}

	if errField, ok := resp["error"]; ok && errField != nil {
		return fmt.Errorf("auth rejected: %v", errField)
	}

	return nil
}

// SendMessage sends a chat message and collects the streaming response.
// It returns the full response content, metadata (including tools used), and any error.
func (gc *GatewayConnection) SendMessage(message string) (string, map[string]string, error) {
	reqID := uuid.New().String()

	req := RequestFrame{
		Type:   "req",
		ID:     reqID,
		Method: "chat.send",
		Params: ChatSendArgs{
			SessionKey:     gc.sessionKey,
			Message:        message,
			IdempotencyKey: uuid.New().String(),
		},
	}

	gc.mu.Lock()
	err := gc.conn.WriteJSON(req)
	gc.mu.Unlock()
	if err != nil {
		return "", nil, fmt.Errorf("sending chat.send: %w", err)
	}

	// Collect streaming response
	var fullContent strings.Builder
	metadata := make(map[string]string)
	var toolsUsed []string

	// Set a read deadline
	gc.conn.SetReadDeadline(time.Now().Add(120 * time.Second))
	defer gc.conn.SetReadDeadline(time.Time{})

	for {
		_, msg, err := gc.conn.ReadMessage()
		if err != nil {
			if fullContent.Len() > 0 {
				// We got some content before the error — return what we have
				return fullContent.String(), metadata, nil
			}
			return "", nil, fmt.Errorf("reading response: %w", err)
		}

		// Try to parse as a generic frame
		var frame map[string]interface{}
		if err := json.Unmarshal(msg, &frame); err != nil {
			continue
		}

		frameType, _ := frame["type"].(string)
		event, _ := frame["event"].(string)
		log.Printf("gateway frame: type=%s event=%s data=%s", frameType, event, string(msg[:min(len(msg), 300)]))

		switch frameType {
		case "res":
			// RPC response to our chat.send — check for errors
			if ok, _ := frame["ok"].(bool); !ok {
				errObj, _ := frame["error"].(map[string]interface{})
				errMsg, _ := errObj["message"].(string)
				if errMsg != "" {
					log.Printf("chat.send error: %s", errMsg)
					return "", nil, fmt.Errorf("gateway error: %s", errMsg)
				}
			}
			continue

		case "event":
			event, _ := frame["event"].(string)

			// Chat events contain the streamed response
			if event == "chat" || event == "chat.message" {
				// OpenClaw v3 uses "payload" not "data"
				payloadData := frame["payload"]
				if payloadData == nil {
					payloadData = frame["data"]
				}
				if payloadData == nil {
					continue
				}

				dataBytes, err := json.Marshal(payloadData)
				if err != nil {
					continue
				}

				var chatEvent ChatEvent
				if err := json.Unmarshal(dataBytes, &chatEvent); err != nil {
					continue
				}

				// v3 uses "errorMessage" instead of nested "error"
				if chatEvent.Error == "" {
					if em, ok := payloadData.(map[string]interface{})["errorMessage"]; ok {
						chatEvent.Error = fmt.Sprintf("%v", em)
					}
				}

				switch chatEvent.State {
				case "delta":
					text := chatEvent.GetText()
					if text != "" {
						fullContent.WriteString(text)
					}
				case "final":
					if len(toolsUsed) > 0 {
						metadata["tools"] = strings.Join(toolsUsed, ", ")
					}
					text := chatEvent.GetText()
					if text != "" {
						return text, metadata, nil
					}
					if fullContent.Len() > 0 {
						return fullContent.String(), metadata, nil
					}
					return "", metadata, fmt.Errorf("agent returned an empty response")
				case "error":
					if fullContent.Len() > 0 {
						return fullContent.String(), metadata, nil
					}
					return "", nil, fmt.Errorf("agent error: %s", chatEvent.GetError())
				case "aborted":
					return fullContent.String(), metadata, nil
				}
				continue
			}

			// Agent lifecycle events — log tool calls for visibility
			if event == "agent" {
				if payload, ok := frame["payload"].(map[string]interface{}); ok {
					if stream, _ := payload["stream"].(string); stream == "tool" {
						if data, ok := payload["data"].(map[string]interface{}); ok {
							toolName, _ := data["name"].(string)
							phase, _ := data["phase"].(string)
							if toolName != "" {
								log.Printf("agent tool %s: %s", phase, toolName)
								if phase == "start" {
									toolsUsed = append(toolsUsed, toolName)
								}
							}
						}
					}
				}
				continue
			}
		}
	}
}

// Close closes the gateway WebSocket connection.
func (gc *GatewayConnection) Close() error {
	return gc.conn.Close()
}
