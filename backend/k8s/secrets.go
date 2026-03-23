package k8s

import (
	"context"
	"fmt"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// UpsertAgentRuntimeSecret ensures the per-agent runtime secret exists in-cluster.
// Secrets stay out of the GitOps repo and are only stored in Kubernetes.
func UpsertAgentRuntimeSecret(ctx context.Context, clients *Clients, namespace, name, provider, apiKey string) error {
	secretName := fmt.Sprintf("agent-%s-secret", name)

	secret, err := clients.Clientset.CoreV1().Secrets(namespace).Get(ctx, secretName, metav1.GetOptions{})
	if err != nil && !apierrors.IsNotFound(err) {
		return fmt.Errorf("getting runtime secret: %w", err)
	}

	if apierrors.IsNotFound(err) {
		gatewayToken, tokenErr := generateGatewayToken()
		if tokenErr != nil {
			return fmt.Errorf("generating gateway token: %w", tokenErr)
		}
		secret = &corev1.Secret{
			ObjectMeta: metav1.ObjectMeta{
				Name:      secretName,
				Namespace: namespace,
				Labels:    agentLabels(name),
			},
			Type: corev1.SecretTypeOpaque,
			Data: map[string][]byte{
				"OPENCLAW_GATEWAY_TOKEN": []byte(gatewayToken),
			},
		}
	}

	if secret.Data == nil {
		secret.Data = map[string][]byte{}
	}
	if _, ok := secret.Data["OPENCLAW_GATEWAY_TOKEN"]; !ok || len(secret.Data["OPENCLAW_GATEWAY_TOKEN"]) == 0 {
		gatewayToken, tokenErr := generateGatewayToken()
		if tokenErr != nil {
			return fmt.Errorf("generating gateway token: %w", tokenErr)
		}
		secret.Data["OPENCLAW_GATEWAY_TOKEN"] = []byte(gatewayToken)
	}

	delete(secret.Data, "OPENAI_API_KEY")
	delete(secret.Data, "ANTHROPIC_API_KEY")
	delete(secret.Data, "SMR_API_KEY")

	switch provider {
	case "openai":
		if apiKey != "" {
			secret.Data["OPENAI_API_KEY"] = []byte(apiKey)
		}
	case "anthropic":
		if apiKey != "" {
			secret.Data["ANTHROPIC_API_KEY"] = []byte(apiKey)
		}
	case "smr":
		if apiKey != "" {
			secret.Data["SMR_API_KEY"] = []byte(apiKey)
		}
	}

	if secret.CreationTimestamp.IsZero() {
		_, err = clients.Clientset.CoreV1().Secrets(namespace).Create(ctx, secret, metav1.CreateOptions{})
		if err != nil {
			return fmt.Errorf("creating runtime secret: %w", err)
		}
		return nil
	}

	_, err = clients.Clientset.CoreV1().Secrets(namespace).Update(ctx, secret, metav1.UpdateOptions{})
	if err != nil {
		return fmt.Errorf("updating runtime secret: %w", err)
	}
	return nil
}
