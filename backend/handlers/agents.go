package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"

	appsv1 "k8s.io/api/apps/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/enterprisewebservice/agent-office/backend/k8s"
	"github.com/enterprisewebservice/agent-office/backend/scaffolder"
)

const protectedAgentName = "onboarding-agent"

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
	Clients    *k8s.Clients
	Namespace  string
	Cache      *k8s.AgentCache
	Scaffolder *scaffolder.Client
}

// NewAgentHandlers creates a new AgentHandlers instance.
func NewAgentHandlers(clients *k8s.Clients, namespace string, cache *k8s.AgentCache) *AgentHandlers {
	return &AgentHandlers{
		Clients:    clients,
		Namespace:  namespace,
		Cache:      cache,
		Scaffolder: scaffolder.NewClient(),
	}
}

// agentFromCR converts an unstructured AgentWorkstation CR to the Agent JSON
// shape the frontend expects (flat fields, not nested under spec/status).
func agentFromCR(obj map[string]interface{}) map[string]interface{} {
	metadata, _ := obj["metadata"].(map[string]interface{})
	spec, _ := obj["spec"].(map[string]interface{})
	status, _ := obj["status"].(map[string]interface{})

	if spec == nil {
		spec = map[string]interface{}{}
	}
	if status == nil {
		status = map[string]interface{}{}
	}
	if metadata == nil {
		metadata = map[string]interface{}{}
	}

	// Extract model info from nested spec.model or flat spec fields
	provider, _ := spec["provider"].(string)
	modelName, _ := spec["modelName"].(string)
	routerRef, _ := spec["routerRef"].(string)

	// Handle nested model object (from CRD spec)
	if model, ok := spec["model"].(map[string]interface{}); ok {
		if p, ok := model["provider"].(string); ok && provider == "" {
			provider = p
		}
		if m, ok := model["modelName"].(string); ok && modelName == "" {
			modelName = m
		}
		if r, ok := model["modelRouterRef"].(string); ok && routerRef == "" {
			routerRef = r
		}
	}

	// Extract tools from spec.tools.allow or flat spec.tools
	var tools []interface{}
	if toolsObj, ok := spec["tools"].(map[string]interface{}); ok {
		if allow, ok := toolsObj["allow"].([]interface{}); ok {
			tools = allow
		}
	} else if toolsArr, ok := spec["tools"].([]interface{}); ok {
		tools = toolsArr
	}

	result := map[string]interface{}{
		"name":         metadata["name"],
		"displayName":  spec["displayName"],
		"emoji":        spec["emoji"],
		"description":  spec["description"],
		"systemPrompt": spec["systemPrompt"],
		"provider":     provider,
		"modelName":    modelName,
		"routerRef":    routerRef,
		"tools":        tools,
		"image":        spec["image"],
		"status": map[string]interface{}{
			"phase":           status["phase"],
			"gatewayEndpoint": status["endpoint"],
		},
	}

	return result
}

func inferAgentPhase(clients *k8s.Clients, namespace, name string, current interface{}) interface{} {
	if phase, ok := current.(string); ok && phase != "" {
		return phase
	}

	deploymentName := fmt.Sprintf("agent-%s", name)
	deployment, err := clients.Clientset.AppsV1().Deployments(namespace).Get(
		context.Background(),
		deploymentName,
		metav1.GetOptions{},
	)
	if err != nil {
		return current
	}

	return deploymentPhase(deployment)
}

func deploymentPhase(deployment *appsv1.Deployment) string {
	if deployment == nil {
		return ""
	}
	if deployment.Status.AvailableReplicas > 0 {
		return "Running"
	}
	if deployment.Status.UnavailableReplicas > 0 || deployment.Status.Replicas > 0 {
		return "Provisioning"
	}
	return "Waiting"
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

	agents := make([]map[string]interface{}, 0, len(list.Items))
	for _, item := range list.Items {
		agent := agentFromCR(item.Object)
		if status, ok := agent["status"].(map[string]interface{}); ok {
			name, _ := agent["name"].(string)
			status["phase"] = inferAgentPhase(h.Clients, h.Namespace, name, status["phase"])
		}
		agents = append(agents, agent)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(agents)
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
	result := agentFromCR(agent.Object)
	if status, ok := result["status"].(map[string]interface{}); ok {
		status["phase"] = inferAgentPhase(h.Clients, h.Namespace, name, status["phase"])
	}
	json.NewEncoder(w).Encode(result)
}

// CreateAgent handles POST /api/agents — calls the RHDH Scaffolder to provision
// an OpenClaw agent via the openclaw-agent Software Template.
func (h *AgentHandlers) CreateAgent(w http.ResponseWriter, r *http.Request) {
	var req CreateAgentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("invalid request body: %v", err), http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	if req.Name == "" {
		http.Error(w, "name is required", http.StatusBadRequest)
		return
	}
	if req.Provider == "" {
		http.Error(w, "provider is required", http.StatusBadRequest)
		return
	}
	if (req.Provider == "openai" || req.Provider == "anthropic" || req.Provider == "smr") && req.APIKey == "" {
		http.Error(w, "apiKey is required for the selected provider", http.StatusBadRequest)
		return
	}

	if err := k8s.UpsertAgentRuntimeSecret(r.Context(), h.Clients, h.Namespace, req.Name, req.Provider, req.APIKey); err != nil {
		log.Printf("error preparing runtime secret for agent %s: %v", req.Name, err)
		http.Error(w, fmt.Sprintf("failed to prepare agent secret: %v", err), http.StatusInternalServerError)
		return
	}

	// Convert tools to interface slice for JSON
	tools := make([]interface{}, len(req.Tools))
	for i, t := range req.Tools {
		tools[i] = t
	}

	// Build scaffolder values matching the template parameters
	values := map[string]interface{}{
		"name":         req.Name,
		"displayName":  req.DisplayName,
		"emoji":        req.Emoji,
		"description":  req.Description,
		"systemPrompt": req.SystemPrompt,
		"provider":     req.Provider,
		"modelName":    req.ModelName,
		"routerRef":    req.RouterRef,
		"tools":        tools,
		"namespace":    h.Namespace,
		"owner":        "user:default/deanpeterson",
		"ghOwner":      "enterprisewebservice",
	}

	taskID, err := h.Scaffolder.CreateAgent(values)
	if err != nil {
		log.Printf("error creating agent %s via scaffolder: %v", req.Name, err)
		http.Error(w, fmt.Sprintf("failed to create agent: %v", err), http.StatusInternalServerError)
		return
	}

	log.Printf("scaffolder task %s created for agent %s", taskID, req.Name)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{
		"name":   req.Name,
		"status": "scaffolding",
		"taskId": taskID,
	})
}

// DeleteAgent handles DELETE /api/agents/{name} — deletes an agent and all owned resources.
func (h *AgentHandlers) DeleteAgent(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if name == "" {
		http.Error(w, "agent name is required", http.StatusBadRequest)
		return
	}
	if name == protectedAgentName {
		http.Error(w, "the Agent Concierge cannot be fired", http.StatusForbidden)
		return
	}

	ctx := r.Context()

	if err := k8s.DeleteAgentGitOpsResources(ctx, h.Clients, name); err != nil {
		log.Printf("error deleting gitops resources for agent %s: %v", name, err)
		http.Error(w, fmt.Sprintf("failed to delete agent gitops resources: %v", err), http.StatusInternalServerError)
		return
	}

	if err := k8s.DeleteAgentResources(ctx, h.Clients, h.Namespace, name); err != nil {
		log.Printf("error deleting agent %s: %v", name, err)
		http.Error(w, fmt.Sprintf("failed to delete agent: %v", err), http.StatusInternalServerError)
		return
	}

	if err := h.Scaffolder.DeleteAgentCatalogRegistration(name); err != nil {
		log.Printf("warning: failed to delete catalog registration for agent %s: %v", name, err)
		http.Error(w, fmt.Sprintf("agent workload deleted, but catalog cleanup failed: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"name":   name,
		"status": "fired",
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
