package k8s

import (
	"context"
	"fmt"
	"log"
	"sync"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/watch"
)

var smallModelRouterGVR = schema.GroupVersionResource{
	Group:    "ai.redhat.com",
	Version:  "v1alpha1",
	Resource: "smallmodelrouters",
}

// RouterInfo holds information about a discovered SmallModelRouter.
type RouterInfo struct {
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Endpoint  string `json:"endpoint"`
	Phase     string `json:"phase"`
}

// AgentCache holds cached AgentWorkstation CRs.
type AgentCache struct {
	mu     sync.RWMutex
	agents map[string]*unstructured.Unstructured
}

// NewAgentCache creates a new AgentCache.
func NewAgentCache() *AgentCache {
	return &AgentCache{
		agents: make(map[string]*unstructured.Unstructured),
	}
}

// Set adds or updates an agent in the cache.
func (c *AgentCache) Set(name string, agent *unstructured.Unstructured) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.agents[name] = agent
}

// Delete removes an agent from the cache.
func (c *AgentCache) Delete(name string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.agents, name)
}

// Get returns a cached agent by name.
func (c *AgentCache) Get(name string) (*unstructured.Unstructured, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	agent, ok := c.agents[name]
	return agent, ok
}

// List returns all cached agents.
func (c *AgentCache) List() []*unstructured.Unstructured {
	c.mu.RLock()
	defer c.mu.RUnlock()
	result := make([]*unstructured.Unstructured, 0, len(c.agents))
	for _, agent := range c.agents {
		result = append(result, agent)
	}
	return result
}

// WatchAgentWorkstations watches for AgentWorkstation CR changes and keeps the cache updated.
// This function blocks and should be run in a goroutine.
func WatchAgentWorkstations(ctx context.Context, clients *Clients, namespace string, cache *AgentCache) {
	for {
		// Initial list to populate cache
		list, err := clients.DynamicClient.Resource(agentWorkstationGVR).Namespace(namespace).List(ctx, metav1.ListOptions{})
		if err != nil {
			log.Printf("error listing agentworkstations: %v", err)
			select {
			case <-ctx.Done():
				return
			default:
				continue
			}
		}

		for i := range list.Items {
			item := &list.Items[i]
			cache.Set(item.GetName(), item)
		}

		resourceVersion := list.GetResourceVersion()

		// Start watching from the last resource version
		watcher, err := clients.DynamicClient.Resource(agentWorkstationGVR).Namespace(namespace).Watch(ctx, metav1.ListOptions{
			ResourceVersion: resourceVersion,
		})
		if err != nil {
			log.Printf("error watching agentworkstations: %v", err)
			select {
			case <-ctx.Done():
				return
			default:
				continue
			}
		}

		func() {
			defer watcher.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case event, ok := <-watcher.ResultChan():
					if !ok {
						log.Println("agentworkstation watch channel closed, restarting")
						return
					}

					obj, ok := event.Object.(*unstructured.Unstructured)
					if !ok {
						continue
					}

					switch event.Type {
					case watch.Added, watch.Modified:
						cache.Set(obj.GetName(), obj)
					case watch.Deleted:
						cache.Delete(obj.GetName())
					}
				}
			}
		}()

		// If context is done, exit
		select {
		case <-ctx.Done():
			return
		default:
			log.Println("restarting agentworkstation watch")
		}
	}
}

// WatchSmallModelRouters lists SmallModelRouter CRs across all namespaces and returns
// information about each discovered router.
func WatchSmallModelRouters(ctx context.Context, clients *Clients) ([]RouterInfo, error) {
	list, err := clients.DynamicClient.Resource(smallModelRouterGVR).Namespace("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("listing smallmodelrouters: %w", err)
	}

	routers := make([]RouterInfo, 0, len(list.Items))
	for _, item := range list.Items {
		info := RouterInfo{
			Name:      item.GetName(),
			Namespace: item.GetNamespace(),
		}

		// Extract status fields
		status, ok := item.Object["status"].(map[string]interface{})
		if ok {
			if phase, ok := status["phase"].(string); ok {
				info.Phase = phase
			}
			if endpoint, ok := status["endpoint"].(string); ok {
				info.Endpoint = endpoint
			}
		}

		// Build endpoint if not in status
		if info.Endpoint == "" {
			info.Endpoint = fmt.Sprintf("http://smr-router-%s.%s.svc.cluster.local", item.GetName(), item.GetNamespace())
		}

		routers = append(routers, info)
	}

	return routers, nil
}
