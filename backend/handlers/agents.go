package handlers

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sort"
	"strings"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
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
	deploymentName := fmt.Sprintf("agent-%s", name)
	deployment, err := clients.Clientset.AppsV1().Deployments(namespace).Get(
		context.Background(),
		deploymentName,
		metav1.GetOptions{},
	)
	if err != nil {
		if phase, ok := current.(string); ok && phase != "" {
			return phase
		}
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

// GovernanceAgent is the response shape for GET /api/governance/agents.
// It enriches the basic Agent shape with information an operator needs to
// keep an eye on agent versions and to find the canonical edit path
// (Open in Dev Spaces → edit YAML → commit; ArgoCD reconciles).
type GovernanceAgent struct {
	Name          string        `json:"name"`
	DisplayName   string        `json:"displayName"`
	Emoji         string        `json:"emoji"`
	Description   string        `json:"description"`
	Provider      string        `json:"provider"`
	ModelName     string        `json:"modelName"`
	Tools         []interface{} `json:"tools"`
	Phase         string        `json:"phase"`
	PodName       string        `json:"podName,omitempty"`
	Image         string        `json:"image,omitempty"`         // declared image (deployment spec)
	ImageID       string        `json:"imageId,omitempty"`       // running image with @sha256 digest
	GitOpsRepoURL string        `json:"gitopsRepoUrl,omitempty"` // per-agent gitops repo on GitHub
	DevSpacesURL  string        `json:"devSpacesUrl,omitempty"`  // from catalog-info link type=devspaces
	BackstageURL  string        `json:"backstageUrl,omitempty"`  // RHDH UI catalog page (when public URL is configured)
	OwnerRef      string        `json:"ownerRef,omitempty"`      // catalog-info spec.owner (e.g. user:default/deanpeterson)
	MemoryFiles  []MemoryFile  `json:"memoryFiles,omitempty"`   // .md files in this agent's ConfigMap + cross-agent sharing
}

// MemoryFile is one .md key from an agent's per-agent ConfigMap (typically
// `agent-<name>-config`), with content-hash-based detection of which other
// agents in the namespace have an identical (filename, content) pair. This
// powers the Map view's "this SOUL.md is shared with onboarding-agent,
// devhub-scaffolder" badges — the discovery surface for what eventually
// becomes a real `MemoryModule` CRD.
type MemoryFile struct {
	Name       string   `json:"name"`             // e.g. "AGENTS.md"
	Sha256     string   `json:"sha256"`           // hex; first 12 chars are usually enough to identify
	SharedWith []string `json:"sharedWith"`       // OTHER agent names with the same (name, content) pair
	SizeBytes  int      `json:"sizeBytes,omitempty"`
}

// GetGovernanceAgents handles GET /api/governance/agents — returns the
// enriched list used by the Map view.
func (h *AgentHandlers) GetGovernanceAgents(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	list, err := k8s.ListAgentWorkstations(ctx, h.Clients, h.Namespace)
	if err != nil {
		log.Printf("error listing agents for governance: %v", err)
		http.Error(w, fmt.Sprintf("failed to list agents: %v", err), http.StatusInternalServerError)
		return
	}

	// Compute memory-file hash sharing for the whole namespace once. Soft-fail
	// — if the ConfigMap list errors, we render cards without the badges.
	memoryByAgent, err := computeMemoryFiles(h.Clients, h.Namespace)
	if err != nil {
		log.Printf("governance: memory-file scan failed: %v", err)
		memoryByAgent = nil
	}

	out := make([]GovernanceAgent, 0, len(list.Items))
	for _, item := range list.Items {
		flat := agentFromCR(item.Object)
		name, _ := flat["name"].(string)
		if name == "" {
			continue
		}

		ga := GovernanceAgent{Name: name}
		ga.DisplayName, _ = flat["displayName"].(string)
		ga.Emoji, _ = flat["emoji"].(string)
		ga.Description, _ = flat["description"].(string)
		ga.Provider, _ = flat["provider"].(string)
		ga.ModelName, _ = flat["modelName"].(string)
		if t, ok := flat["tools"].([]interface{}); ok {
			ga.Tools = t
		} else {
			ga.Tools = []interface{}{}
		}

		// Phase reuses the existing inferAgentPhase logic.
		var current interface{}
		if status, ok := flat["status"].(map[string]interface{}); ok {
			current = status["phase"]
		}
		if phase, ok := inferAgentPhase(h.Clients, h.Namespace, name, current).(string); ok {
			ga.Phase = phase
		}

		// Pod / image — declared image from the deployment spec, running digest from the pod.
		ga.Image = deploymentContainerImage(h.Clients, h.Namespace, name)
		ga.PodName, ga.ImageID = runningPodImageInfo(h.Clients, h.Namespace, name)

		// URLs come from convention by default (works even when RHDH is
		// unhealthy). The scaffolder template writes the same shape into
		// catalog-info.yaml so the convention matches the canonical source.
		ga.GitOpsRepoURL = gitOpsRepoURLFor(name)
		ga.DevSpacesURL = devSpacesURLFor(ga.GitOpsRepoURL)
		ga.BackstageURL = backstageCatalogURLFor(name)

		// Memory file badges (cross-agent hash sharing). Empty slice if the
		// agent has no ConfigMap or the upstream scan failed.
		if memoryByAgent != nil {
			ga.MemoryFiles = memoryByAgent[name]
		}

		// Prefer real Backstage catalog data when available — picks up custom
		// links and ownership the scaffolder didn't generate. Soft-fails on
		// per-agent errors so a single bad catalog entry doesn't break the
		// whole map (e.g. agent created before catalog registration completes).
		if h.Scaffolder != nil {
			if entity, err := h.Scaffolder.GetAgentComponent(name); err != nil {
				log.Printf("governance: catalog lookup failed for %s: %v", name, err)
			} else if entity != nil {
				if link := entity.FindLinkByType("devspaces"); link != "" {
					ga.DevSpacesURL = link
				}
				ga.OwnerRef = entity.Spec.Owner
			}
		}

		out = append(out, ga)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(out)
}

// deploymentContainerImage returns the openclaw container image declared on
// the agent's Deployment, or empty if none.
func deploymentContainerImage(clients *k8s.Clients, namespace, name string) string {
	deployment, err := clients.Clientset.AppsV1().Deployments(namespace).Get(
		context.Background(),
		fmt.Sprintf("agent-%s", name),
		metav1.GetOptions{},
	)
	if err != nil || deployment == nil {
		return ""
	}
	for _, c := range deployment.Spec.Template.Spec.Containers {
		if c.Name == "openclaw" {
			return c.Image
		}
	}
	if len(deployment.Spec.Template.Spec.Containers) > 0 {
		return deployment.Spec.Template.Spec.Containers[0].Image
	}
	return ""
}

// runningPodImageInfo returns the running pod name and its actual pulled
// image digest (ImageID, format `quay.io/...@sha256:...`). Falls back to the
// first pod when none are Running.
func runningPodImageInfo(clients *k8s.Clients, namespace, name string) (podName, imageID string) {
	pods, err := clients.Clientset.CoreV1().Pods(namespace).List(context.Background(), metav1.ListOptions{
		LabelSelector: fmt.Sprintf("app.kubernetes.io/name=%s", name),
	})
	if err != nil || len(pods.Items) == 0 {
		return "", ""
	}
	pickContainer := func(p corev1.Pod) string {
		for _, cs := range p.Status.ContainerStatuses {
			if cs.Name == "openclaw" {
				return cs.ImageID
			}
		}
		if len(p.Status.ContainerStatuses) > 0 {
			return p.Status.ContainerStatuses[0].ImageID
		}
		return ""
	}
	for _, p := range pods.Items {
		if p.Status.Phase == corev1.PodRunning {
			return p.Name, pickContainer(p)
		}
	}
	first := pods.Items[0]
	return first.Name, pickContainer(first)
}

// backstageCatalogURLFor builds the public RHDH UI URL for a component, when
// RHDH_PUBLIC_URL is set. Returns "" otherwise — in that case the Map view
// suppresses the Backstage link.
func backstageCatalogURLFor(name string) string {
	base := os.Getenv("RHDH_PUBLIC_URL")
	if base == "" {
		return ""
	}
	return fmt.Sprintf("%s/catalog/default/component/%s", strings.TrimRight(base, "/"), name)
}

// computeMemoryFiles lists every per-agent ConfigMap in the namespace, hashes
// each .md key, and builds an agent-name → MemoryFile[] map where each
// MemoryFile knows which OTHER agents in the namespace have an identical
// (filename, content) pair. Two agents "share" a file when both have the same
// filename AND the file content is byte-identical (sha256 match).
//
// This powers the Map view's "shared with: <agents>" badges and is the
// discovery layer that surfaces "these N agents have the same SOUL.md, that
// should probably be a real MemoryModule resource."
func computeMemoryFiles(clients *k8s.Clients, namespace string) (map[string][]MemoryFile, error) {
	cms, err := clients.Clientset.CoreV1().ConfigMaps(namespace).List(context.Background(), metav1.ListOptions{
		LabelSelector: "app.kubernetes.io/managed-by=agent-office",
	})
	if err != nil {
		return nil, err
	}

	type fileEntry struct {
		hash string
		size int
	}
	// agent → filename → fileEntry
	perAgent := make(map[string]map[string]fileEntry)
	// filename + ":" + hash → []agent (reverse lookup for sharedWith)
	reverse := make(map[string][]string)

	for _, cm := range cms.Items {
		// Per-agent ConfigMaps are named `agent-<name>-config` per the
		// scaffolder template. Skip anything that doesn't match.
		name := cm.Name
		if !strings.HasPrefix(name, "agent-") || !strings.HasSuffix(name, "-config") {
			continue
		}
		agent := strings.TrimSuffix(strings.TrimPrefix(name, "agent-"), "-config")
		perAgent[agent] = make(map[string]fileEntry)
		for fname, content := range cm.Data {
			if !strings.HasSuffix(strings.ToLower(fname), ".md") {
				continue
			}
			sum := sha256.Sum256([]byte(content))
			h := hex.EncodeToString(sum[:])
			perAgent[agent][fname] = fileEntry{hash: h, size: len(content)}
			key := fname + ":" + h
			reverse[key] = append(reverse[key], agent)
		}
	}

	out := make(map[string][]MemoryFile, len(perAgent))
	for agent, files := range perAgent {
		// Stable order for the response so the UI doesn't reshuffle on every poll.
		filenames := make([]string, 0, len(files))
		for fn := range files {
			filenames = append(filenames, fn)
		}
		sort.Strings(filenames)

		entries := make([]MemoryFile, 0, len(filenames))
		for _, fn := range filenames {
			entry := files[fn]
			siblings := reverse[fn+":"+entry.hash]
			shared := make([]string, 0, len(siblings))
			for _, s := range siblings {
				if s != agent {
					shared = append(shared, s)
				}
			}
			sort.Strings(shared)
			entries = append(entries, MemoryFile{
				Name:       fn,
				Sha256:     entry.hash,
				SharedWith: shared,
				SizeBytes:  entry.size,
			})
		}
		out[agent] = entries
	}
	return out, nil
}

// gitOpsRepoURLFor returns the GitHub URL of an agent's per-agent gitops
// repo. Convention matches the openclaw-agent scaffolder template
// (`<owner>/<name>-agent-gitops`). Configurable via GITHUB_OWNER env var.
func gitOpsRepoURLFor(name string) string {
	owner := os.Getenv("GITHUB_OWNER")
	if owner == "" {
		owner = "enterprisewebservice"
	}
	return fmt.Sprintf("https://github.com/%s/%s-agent-gitops", owner, name)
}

// devSpacesURLFor builds the "open this repo in Dev Spaces" deep link.
// Returns "" when DEVSPACES_URL is unset — the Map view then renders the
// "Open in Dev Spaces" button as disabled with an explanatory tooltip.
func devSpacesURLFor(repoURL string) string {
	base := os.Getenv("DEVSPACES_URL")
	if base == "" || repoURL == "" {
		return ""
	}
	return fmt.Sprintf("%s/#%s", strings.TrimRight(base, "/"), repoURL)
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
