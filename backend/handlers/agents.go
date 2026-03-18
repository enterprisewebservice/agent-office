package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"

	"github.com/enterprisewebservice/agent-office/backend/k8s"
	"github.com/enterprisewebservice/agent-office/backend/templates"
)

// CreateAgentRequest defines the JSON body for creating an agent.
type CreateAgentRequest struct {
	Name         string   `json:"name"`
	DisplayName  string   `json:"displayName"`
	Emoji        string   `json:"emoji"`
	Description  string   `json:"description"`
	SystemPrompt string   `json:"systemPrompt"`
	Provider     string   `json:"provider"`
	ModelName    string   `json:"modelName"`
	RouterRef    string   `json:"routerRef,omitempty"`
	APIKey       string   `json:"apiKey,omitempty"`
	Tools        []string `json:"tools"`
	Image        string   `json:"image,omitempty"`
}

// AgentHandlers holds dependencies for agent HTTP handlers.
type AgentHandlers struct {
	Clients   *k8s.Clients
	Namespace string
	Cache     *k8s.AgentCache
}

// NewAgentHandlers creates a new AgentHandlers instance.
func NewAgentHandlers(clients *k8s.Clients, namespace string, cache *k8s.AgentCache) *AgentHandlers {
	return &AgentHandlers{
		Clients:   clients,
		Namespace: namespace,
		Cache:     cache,
	}
}

// ListAgents handles GET /api/agents — lists all AgentWorkstation CRs.
func (h *AgentHandlers) ListAgents(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	list, err := k8s.ListAgentWorkstations(ctx, h.Clients, h.Namespace)
	if err != nil {
		log.Printf("error listing agents: %v", err)
		http.Error(w, fmt.Sprintf("failed to list agents: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(list.Items)
}

// GetAgent handles GET /api/agents/{name} — gets a single AgentWorkstation CR.
func (h *AgentHandlers) GetAgent(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if name == "" {
		http.Error(w, "agent name is required", http.StatusBadRequest)
		return
	}

	ctx := r.Context()

	agent, err := k8s.GetAgentWorkstation(ctx, h.Clients, h.Namespace, name)
	if err != nil {
		log.Printf("error getting agent %s: %v", name, err)
		http.Error(w, fmt.Sprintf("agent not found: %v", err), http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(agent)
}

// CreateAgent handles POST /api/agents — creates all resources for a new agent.
func (h *AgentHandlers) CreateAgent(w http.ResponseWriter, r *http.Request) {
	var req CreateAgentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("invalid request body: %v", err), http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	// Validate required fields
	if req.Name == "" {
		http.Error(w, "name is required", http.StatusBadRequest)
		return
	}
	if req.Provider == "" {
		http.Error(w, "provider is required", http.StatusBadRequest)
		return
	}

	// Convert handler request to template request
	tmplReq := templates.CreateAgentRequest{
		Name:         req.Name,
		DisplayName:  req.DisplayName,
		Emoji:        req.Emoji,
		Description:  req.Description,
		SystemPrompt: req.SystemPrompt,
		Provider:     req.Provider,
		ModelName:    req.ModelName,
		RouterRef:    req.RouterRef,
		APIKey:       req.APIKey,
		Tools:        req.Tools,
		Image:        req.Image,
	}

	ctx := context.Background()
	if err := k8s.CreateAgentResources(ctx, h.Clients, h.Namespace, tmplReq); err != nil {
		log.Printf("error creating agent %s: %v", req.Name, err)
		http.Error(w, fmt.Sprintf("failed to create agent: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{
		"name":   req.Name,
		"status": "created",
	})
}

// DeleteAgent handles DELETE /api/agents/{name} — deletes an agent and all owned resources.
func (h *AgentHandlers) DeleteAgent(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if name == "" {
		http.Error(w, "agent name is required", http.StatusBadRequest)
		return
	}

	ctx := r.Context()

	if err := k8s.DeleteAgentResources(ctx, h.Clients, h.Namespace, name); err != nil {
		log.Printf("error deleting agent %s: %v", name, err)
		http.Error(w, fmt.Sprintf("failed to delete agent: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"name":   name,
		"status": "deleted",
	})
}

// ListRouters handles GET /api/routers — lists all SmallModelRouter CRs.
func (h *AgentHandlers) ListRouters(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	routers, err := k8s.WatchSmallModelRouters(ctx, h.Clients)
	if err != nil {
		log.Printf("error listing routers: %v", err)
		http.Error(w, fmt.Sprintf("failed to list routers: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(routers)
}
