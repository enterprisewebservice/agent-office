package k8s

import (
	"context"
	"fmt"
	"time"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"

	"github.com/enterprisewebservice/agent-office/backend/templates"
)

var agentWorkstationGVR = schema.GroupVersionResource{
	Group:    "agentoffice.ai",
	Version:  "v1alpha1",
	Resource: "agentworkstations",
}

var argoApplicationGVR = schema.GroupVersionResource{
	Group:    "argoproj.io",
	Version:  "v1alpha1",
	Resource: "applications",
}

var argoAppProjectGVR = schema.GroupVersionResource{
	Group:    "argoproj.io",
	Version:  "v1alpha1",
	Resource: "appprojects",
}

// agentLabels returns the standard labels stamped onto the user-supplied
// API-key Secret. The operator stamps the same labels on its owned
// resources (ConfigMap, Deployment, etc.) so the office UI's selectors
// keep working unchanged.
func agentLabels(name string) map[string]string {
	return map[string]string{
		"app.kubernetes.io/managed-by": "agent-office",
		"agentoffice.ai/agent":         name,
	}
}

// CreateAgentResources is the slice-4 demoted creator. It creates only
// the AgentWorkstation CR; the credentials Secret is created upstream
// by handlers/agents.go via UpsertAgentRuntimeSecret. agent-office-
// operator's AgentWorkstationReconciler observes the CR and
// reconciles ConfigMap / gateway-token Secret / PVC / Deployment /
// Service / Route.
func CreateAgentResources(ctx context.Context, clients *Clients, namespace string, req templates.CreateAgentRequest) error {
	labels := agentLabels(req.Name)
	credSecretName := fmt.Sprintf("agent-%s-credentials", req.Name)

	// AgentWorkstation CR — desired state in. Operator does the rest.
	model := map[string]interface{}{
		"provider": req.Provider,
	}
	if req.ModelName != "" {
		model["modelName"] = req.ModelName
	}
	if req.RouterRef != "" {
		model["modelRouterRef"] = req.RouterRef
	}
	image := req.Image
	if image == "" {
		image = "quay-quay-quay-test.apps.salamander.aimlworkbench.com/deanpeterson/openclaw-browser:0.1.0"
	}
	agentCR := &unstructured.Unstructured{
		Object: map[string]interface{}{
			"apiVersion": "agentoffice.ai/v1alpha1",
			"kind":       "AgentWorkstation",
			"metadata": map[string]interface{}{
				"name":      req.Name,
				"namespace": namespace,
				"labels":    convertLabels(labels),
			},
			"spec": map[string]interface{}{
				"displayName":     req.DisplayName,
				"emoji":           req.Emoji,
				"description":     req.Description,
				"systemPrompt":    req.SystemPrompt,
				"model":           model,
				"apiKeySecretRef": credSecretName,
				"tools": map[string]interface{}{
					"allow": toInterfaceSlice(req.Tools),
				},
				"image": image,
			},
		},
	}
	if _, err := clients.DynamicClient.Resource(agentWorkstationGVR).Namespace(namespace).Create(ctx, agentCR, metav1.CreateOptions{}); err != nil {
		return fmt.Errorf("creating agentworkstation CR: %w", err)
	}

	return nil
}

// DeleteAgentResources removes the AgentWorkstation CR. ownerReferences
// on the operator's owned children (ConfigMap, gateway Secret, PVC,
// Deployment, Service, Route) cascade the delete. The user-supplied
// API-key Secret is also removed here since the operator doesn't own it.
func DeleteAgentResources(ctx context.Context, clients *Clients, namespace, name string) error {
	deleteOpts := metav1.DeleteOptions{}

	// Delete AgentWorkstation CR — cascades to operator-owned children.
	if err := clients.DynamicClient.Resource(agentWorkstationGVR).Namespace(namespace).Delete(ctx, name, deleteOpts); err != nil && !apierrors.IsNotFound(err) {
		return fmt.Errorf("deleting agentworkstation %s: %w", name, err)
	}

	// Delete the user-supplied credential Secret. agent-office-server
	// owns this one because it carries user-entered API key material.
	credSecretName := fmt.Sprintf("agent-%s-credentials", name)
	if err := clients.Clientset.CoreV1().Secrets(namespace).Delete(ctx, credSecretName, deleteOpts); err != nil && !apierrors.IsNotFound(err) {
		// best-effort
		fmt.Printf("warning: deleting credential secret %s: %v\n", credSecretName, err)
	}

	return nil
}

// DeleteAgentGitOpsResources deletes the per-agent Argo Application and AppProject.
// The Application finalizer prunes GitOps-managed resources in the target namespace.
func DeleteAgentGitOpsResources(ctx context.Context, clients *Clients, name string) error {
	appName := fmt.Sprintf("%s-agent", name)
	deleteOpts := metav1.DeleteOptions{}
	argoNamespace := "openshift-gitops"

	err := clients.DynamicClient.Resource(argoApplicationGVR).Namespace(argoNamespace).Delete(ctx, appName, deleteOpts)
	if err != nil && !apierrors.IsNotFound(err) {
		return fmt.Errorf("deleting argo application %s: %w", appName, err)
	}

	deadline := time.Now().Add(45 * time.Second)
	for time.Now().Before(deadline) {
		_, getErr := clients.DynamicClient.Resource(argoApplicationGVR).Namespace(argoNamespace).Get(ctx, appName, metav1.GetOptions{})
		if apierrors.IsNotFound(getErr) {
			break
		}
		if getErr != nil {
			return fmt.Errorf("waiting for argo application %s deletion: %w", appName, getErr)
		}
		time.Sleep(1 * time.Second)
	}

	err = clients.DynamicClient.Resource(argoAppProjectGVR).Namespace(argoNamespace).Delete(ctx, appName, deleteOpts)
	if err != nil && !apierrors.IsNotFound(err) {
		return fmt.Errorf("deleting argo appproject %s: %w", appName, err)
	}

	return nil
}

// ListAgentWorkstations returns all AgentWorkstation CRs in the given namespace.
func ListAgentWorkstations(ctx context.Context, clients *Clients, namespace string) (*unstructured.UnstructuredList, error) {
	return clients.DynamicClient.Resource(agentWorkstationGVR).Namespace(namespace).List(ctx, metav1.ListOptions{})
}

// GetAgentWorkstation returns a single AgentWorkstation CR by name.
func GetAgentWorkstation(ctx context.Context, clients *Clients, namespace, name string) (*unstructured.Unstructured, error) {
	return clients.DynamicClient.Resource(agentWorkstationGVR).Namespace(namespace).Get(ctx, name, metav1.GetOptions{})
}

// AgentWorkstation status (phase + gatewayEndpoint) and the per-agent
// runtime resources (ConfigMap / token Secret / PVC / Deployment /
// Service / Route) are owned by agent-office-operator since slice 4.
// This file only creates the user-supplied credential Secret + the
// AgentWorkstation CR.

// convertLabels converts map[string]string to map[string]interface{} for unstructured objects.
func convertLabels(labels map[string]string) map[string]interface{} {
	result := make(map[string]interface{}, len(labels))
	for k, v := range labels {
		result[k] = v
	}
	return result
}

// toInterfaceSlice converts a string slice to an interface slice for unstructured objects.
func toInterfaceSlice(ss []string) []interface{} {
	result := make([]interface{}, len(ss))
	for i, s := range ss {
		result[i] = s
	}
	return result
}
