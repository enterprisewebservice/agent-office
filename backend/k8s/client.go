package k8s

import (
	"os"
	"path/filepath"

	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

// Clients holds both typed and dynamic Kubernetes clients.
type Clients struct {
	Clientset     kubernetes.Interface
	DynamicClient dynamic.Interface
}

// InitClient creates Kubernetes clients. It tries in-cluster config first,
// then falls back to kubeconfig from KUBECONFIG env var or ~/.kube/config.
func InitClient() (*Clients, error) {
	config, err := rest.InClusterConfig()
	if err != nil {
		// Fallback to kubeconfig
		kubeconfigPath := os.Getenv("KUBECONFIG")
		if kubeconfigPath == "" {
			home, err := os.UserHomeDir()
			if err != nil {
				return nil, err
			}
			kubeconfigPath = filepath.Join(home, ".kube", "config")
		}
		config, err = clientcmd.BuildConfigFromFlags("", kubeconfigPath)
		if err != nil {
			return nil, err
		}
	}

	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		return nil, err
	}

	dynClient, err := dynamic.NewForConfig(config)
	if err != nil {
		return nil, err
	}

	return &Clients{
		Clientset:     clientset,
		DynamicClient: dynClient,
	}, nil
}

// GetNamespace returns the namespace to operate in. It checks the NAMESPACE
// env var first, then the in-cluster service account namespace file, and
// defaults to "agent-office".
func GetNamespace() string {
	if ns := os.Getenv("NAMESPACE"); ns != "" {
		return ns
	}

	data, err := os.ReadFile("/var/run/secrets/kubernetes.io/serviceaccount/namespace")
	if err == nil && len(data) > 0 {
		return string(data)
	}

	return "agent-office"
}
