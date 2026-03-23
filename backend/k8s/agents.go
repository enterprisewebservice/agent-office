package k8s

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/util/intstr"

	"github.com/enterprisewebservice/agent-office/backend/templates"
)

const (
	// DefaultOpenClawImage is the browser-enabled OpenClaw image from our fork.
	DefaultOpenClawImage = "quay-quay-quay-test.apps.salamander.aimlworkbench.com/deanpeterson/openclaw-browser:0.1.0"
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

var routeGVR = schema.GroupVersionResource{
	Group:    "route.openshift.io",
	Version:  "v1",
	Resource: "routes",
}

// agentLabels returns the standard labels for an agent's resources.
func agentLabels(name string) map[string]string {
	return map[string]string{
		"app.kubernetes.io/managed-by": "agent-office",
		"agentoffice.ai/agent":         name,
	}
}

// generateGatewayToken creates a random token for OpenClaw gateway auth.
func generateGatewayToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.URLEncoding.EncodeToString(b), nil
}

// CreateAgentResources creates all Kubernetes resources for an agent:
// ConfigMap (with workspace files), Secret, PVC, Deployment (with init container), Service, and AgentWorkstation CR.
func CreateAgentResources(ctx context.Context, clients *Clients, namespace string, req templates.CreateAgentRequest) error {
	labels := agentLabels(req.Name)

	// Generate a gateway token for this agent
	gatewayToken, err := generateGatewayToken()
	if err != nil {
		return fmt.Errorf("generating gateway token: %w", err)
	}

	// Render all workspace templates
	openclawJSON, err := templates.RenderOpenClawConfig(req, namespace, gatewayToken)
	if err != nil {
		return fmt.Errorf("rendering openclaw config: %w", err)
	}

	agentsMd, err := templates.RenderAgentsMd(req)
	if err != nil {
		return fmt.Errorf("rendering agents.md: %w", err)
	}

	identityMd, err := templates.RenderIdentityMd(req)
	if err != nil {
		return fmt.Errorf("rendering identity.md: %w", err)
	}

	soulMd, err := templates.RenderSoulMd(req)
	if err != nil {
		return fmt.Errorf("rendering soul.md: %w", err)
	}

	userMd, err := templates.RenderUserMd()
	if err != nil {
		return fmt.Errorf("rendering user.md: %w", err)
	}

	toolsMd, err := templates.RenderToolsMd(req)
	if err != nil {
		return fmt.Errorf("rendering tools.md: %w", err)
	}

	// 1. ConfigMap — OpenClaw config + workspace files
	configMap := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:      fmt.Sprintf("agent-%s-config", req.Name),
			Namespace: namespace,
			Labels:    labels,
		},
		Data: map[string]string{
			"openclaw.json": openclawJSON,
			"AGENTS.md":     agentsMd,
			"IDENTITY.md":   identityMd,
			"SOUL.md":       soulMd,
			"USER.md":       userMd,
			"TOOLS.md":      toolsMd,
		},
	}
	_, err = clients.Clientset.CoreV1().ConfigMaps(namespace).Create(ctx, configMap, metav1.CreateOptions{})
	if err != nil {
		return fmt.Errorf("creating configmap: %w", err)
	}

	// 2. Secret — API keys + gateway token
	secretData := map[string][]byte{
		"OPENCLAW_GATEWAY_TOKEN": []byte(gatewayToken),
	}
	switch req.Provider {
	case "smr":
		secretData["SMR_API_KEY"] = []byte(req.APIKey)
	case "openai":
		secretData["OPENAI_API_KEY"] = []byte(req.APIKey)
	case "anthropic":
		secretData["ANTHROPIC_API_KEY"] = []byte(req.APIKey)
	}

	secret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      fmt.Sprintf("agent-%s-secret", req.Name),
			Namespace: namespace,
			Labels:    labels,
		},
		Data: secretData,
	}
	_, err = clients.Clientset.CoreV1().Secrets(namespace).Create(ctx, secret, metav1.CreateOptions{})
	if err != nil {
		return fmt.Errorf("creating secret: %w", err)
	}

	// 3. PVC — persistent workspace for agent state, memory, and browser cache
	pvc := &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{
			Name:      fmt.Sprintf("agent-%s-workspace", req.Name),
			Namespace: namespace,
			Labels:    labels,
		},
		Spec: corev1.PersistentVolumeClaimSpec{
			AccessModes: []corev1.PersistentVolumeAccessMode{corev1.ReadWriteOnce},
			Resources: corev1.VolumeResourceRequirements{
				Requests: corev1.ResourceList{
					corev1.ResourceStorage: resource.MustParse("2Gi"),
				},
			},
		},
	}
	_, err = clients.Clientset.CoreV1().PersistentVolumeClaims(namespace).Create(ctx, pvc, metav1.CreateOptions{})
	if err != nil {
		return fmt.Errorf("creating pvc: %w", err)
	}

	// 4. Deployment — OpenClaw Gateway with init container
	image := req.Image
	if image == "" {
		image = DefaultOpenClawImage
	}

	replicas := int32(1)
	fsGroup := int64(1000)

	deployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      fmt.Sprintf("agent-%s", req.Name),
			Namespace: namespace,
			Labels:    labels,
		},
		Spec: appsv1.DeploymentSpec{
			Replicas: &replicas,
			Selector: &metav1.LabelSelector{
				MatchLabels: labels,
			},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{
					Labels: labels,
				},
				Spec: corev1.PodSpec{
					SecurityContext: &corev1.PodSecurityContext{
						FSGroup: &fsGroup,
					},
					// Init container copies ConfigMap files to PVC workspace.
					// fsGroup=1000 on the pod ensures PVC files get the right group.
					// Workspace files are only copied if they don't already exist,
					// preserving any agent memory/state from previous runs.
					InitContainers: []corev1.Container{
						{
							Name:  "init-config",
							Image: "registry.access.redhat.com/ubi9/ubi-minimal:latest",
							Command: []string{"/bin/sh", "-c", `
								cp /config/openclaw.json /workspace/openclaw.json
								mkdir -p /workspace/workspace
								for f in AGENTS.md IDENTITY.md SOUL.md USER.md TOOLS.md; do
									if [ ! -f "/workspace/workspace/$f" ]; then
										cp "/config/$f" "/workspace/workspace/$f"
									fi
								done
							`},
							VolumeMounts: []corev1.VolumeMount{
								{
									Name:      "config",
									MountPath: "/config",
									ReadOnly:  true,
								},
								{
									Name:      "workspace",
									MountPath: "/workspace",
								},
							},
						},
					},
					Containers: []corev1.Container{
						{
							Name:  "openclaw",
							Image: image,
							Ports: []corev1.ContainerPort{
								{
									Name:          "gateway",
									ContainerPort: 18789,
									Protocol:      corev1.ProtocolTCP,
								},
							},
							EnvFrom: []corev1.EnvFromSource{
								{
									SecretRef: &corev1.SecretEnvSource{
										LocalObjectReference: corev1.LocalObjectReference{
											Name: fmt.Sprintf("agent-%s-secret", req.Name),
										},
									},
								},
							},
							VolumeMounts: []corev1.VolumeMount{
								{
									Name:      "workspace",
									MountPath: "/home/node/.openclaw",
								},
							},
							// Shared memory for Chromium
							// Chromium needs more than the default 64MB /dev/shm
						},
					},
					Volumes: []corev1.Volume{
						{
							Name: "config",
							VolumeSource: corev1.VolumeSource{
								ConfigMap: &corev1.ConfigMapVolumeSource{
									LocalObjectReference: corev1.LocalObjectReference{
										Name: fmt.Sprintf("agent-%s-config", req.Name),
									},
								},
							},
						},
						{
							Name: "workspace",
							VolumeSource: corev1.VolumeSource{
								PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{
									ClaimName: fmt.Sprintf("agent-%s-workspace", req.Name),
								},
							},
						},
						{
							Name: "dshm",
							VolumeSource: corev1.VolumeSource{
								EmptyDir: &corev1.EmptyDirVolumeSource{
									Medium:    corev1.StorageMediumMemory,
									SizeLimit: resourcePtr("1Gi"),
								},
							},
						},
					},
				},
			},
		},
	}

	// Add /dev/shm volume mount for Chromium
	deployment.Spec.Template.Spec.Containers[0].VolumeMounts = append(
		deployment.Spec.Template.Spec.Containers[0].VolumeMounts,
		corev1.VolumeMount{
			Name:      "dshm",
			MountPath: "/dev/shm",
		},
	)

	_, err = clients.Clientset.AppsV1().Deployments(namespace).Create(ctx, deployment, metav1.CreateOptions{})
	if err != nil {
		return fmt.Errorf("creating deployment: %w", err)
	}

	// 5. Service
	svc := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      fmt.Sprintf("agent-%s", req.Name),
			Namespace: namespace,
			Labels:    labels,
		},
		Spec: corev1.ServiceSpec{
			Selector: labels,
			Ports: []corev1.ServicePort{
				{
					Name:       "gateway",
					Port:       18789,
					TargetPort: intstr.FromInt32(18789),
					Protocol:   corev1.ProtocolTCP,
				},
			},
		},
	}
	_, err = clients.Clientset.CoreV1().Services(namespace).Create(ctx, svc, metav1.CreateOptions{})
	if err != nil {
		return fmt.Errorf("creating service: %w", err)
	}

	// 6. AgentWorkstation CR
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
				"displayName":  req.DisplayName,
				"emoji":        req.Emoji,
				"description":  req.Description,
				"systemPrompt": req.SystemPrompt,
				"provider":     req.Provider,
				"modelName":    req.ModelName,
				"routerRef":    req.RouterRef,
				"tools":        toInterfaceSlice(req.Tools),
				"image":        image,
			},
			"status": map[string]interface{}{
				"phase":    "Provisioning",
				"endpoint": fmt.Sprintf("http://agent-%s.%s.svc:18789", req.Name, namespace),
			},
		},
	}

	_, err = clients.DynamicClient.Resource(agentWorkstationGVR).Namespace(namespace).Create(ctx, agentCR, metav1.CreateOptions{})
	if err != nil {
		return fmt.Errorf("creating agentworkstation CR: %w", err)
	}

	return nil
}

// DeleteAgentResources deletes all resources associated with an agent using label selectors.
func DeleteAgentResources(ctx context.Context, clients *Clients, namespace, name string) error {
	labelSelector := fmt.Sprintf("agentoffice.ai/agent=%s", name)
	deleteOpts := metav1.DeleteOptions{}
	listOpts := metav1.ListOptions{LabelSelector: labelSelector}

	// Delete AgentWorkstation CR
	err := clients.DynamicClient.Resource(agentWorkstationGVR).Namespace(namespace).Delete(ctx, name, deleteOpts)
	if err != nil {
		// Log but continue deleting other resources
		fmt.Printf("warning: deleting agentworkstation CR %s: %v\n", name, err)
	}

	// Delete Deployment
	err = clients.Clientset.AppsV1().Deployments(namespace).DeleteCollection(ctx, deleteOpts, listOpts)
	if err != nil {
		fmt.Printf("warning: deleting deployments for %s: %v\n", name, err)
	}

	// Delete Service
	svcs, err := clients.Clientset.CoreV1().Services(namespace).List(ctx, listOpts)
	if err == nil {
		for _, svc := range svcs.Items {
			_ = clients.Clientset.CoreV1().Services(namespace).Delete(ctx, svc.Name, deleteOpts)
		}
	}

	// Delete PVC
	pvcs, err := clients.Clientset.CoreV1().PersistentVolumeClaims(namespace).List(ctx, listOpts)
	if err == nil {
		for _, pvc := range pvcs.Items {
			_ = clients.Clientset.CoreV1().PersistentVolumeClaims(namespace).Delete(ctx, pvc.Name, deleteOpts)
		}
	}

	// Delete Secret
	secrets, err := clients.Clientset.CoreV1().Secrets(namespace).List(ctx, listOpts)
	if err == nil {
		for _, secret := range secrets.Items {
			_ = clients.Clientset.CoreV1().Secrets(namespace).Delete(ctx, secret.Name, deleteOpts)
		}
	}

	// Delete ConfigMap
	cms, err := clients.Clientset.CoreV1().ConfigMaps(namespace).List(ctx, listOpts)
	if err == nil {
		for _, cm := range cms.Items {
			_ = clients.Clientset.CoreV1().ConfigMaps(namespace).Delete(ctx, cm.Name, deleteOpts)
		}
	}

	// Delete Route
	routes, err := clients.DynamicClient.Resource(routeGVR).Namespace(namespace).List(ctx, listOpts)
	if err == nil {
		for _, route := range routes.Items {
			_ = clients.DynamicClient.Resource(routeGVR).Namespace(namespace).Delete(ctx, route.GetName(), deleteOpts)
		}
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

// UpdateAgentWorkstationStatus updates the status fields of an AgentWorkstation CR.
func UpdateAgentWorkstationStatus(ctx context.Context, clients *Clients, namespace, name, phase, endpoint string) error {
	agent, err := clients.DynamicClient.Resource(agentWorkstationGVR).Namespace(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf("getting agentworkstation %s: %w", name, err)
	}

	status, ok := agent.Object["status"].(map[string]interface{})
	if !ok {
		status = map[string]interface{}{}
	}
	status["phase"] = phase
	status["endpoint"] = endpoint
	agent.Object["status"] = status

	_, err = clients.DynamicClient.Resource(agentWorkstationGVR).Namespace(namespace).UpdateStatus(ctx, agent, metav1.UpdateOptions{})
	if err != nil {
		return fmt.Errorf("updating agentworkstation status %s: %w", name, err)
	}

	return nil
}

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

// resourcePtr parses a quantity string and returns a pointer to it.
func resourcePtr(s string) *resource.Quantity {
	q := resource.MustParse(s)
	return &q
}
