package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/enterprisewebservice/agent-office/backend/bootstrap"
	"github.com/enterprisewebservice/agent-office/backend/handlers"
	"github.com/enterprisewebservice/agent-office/backend/k8s"
	"github.com/enterprisewebservice/agent-office/backend/scaffolder"
)

func main() {
	log.Println("starting agent-office backend")

	// Initialize Kubernetes clients
	clients, err := k8s.InitClient()
	if err != nil {
		log.Fatalf("failed to initialize k8s client: %v", err)
	}
	log.Println("kubernetes client initialized")

	namespace := k8s.GetNamespace()
	log.Printf("operating in namespace: %s", namespace)

	// Create agent cache and start watcher goroutine
	cache := k8s.NewAgentCache()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go k8s.WatchAgentWorkstations(ctx, clients, namespace, cache)
	log.Println("started agentworkstation watcher")

	// Initialize scaffolder client and bootstrap default agent
	sc := scaffolder.NewClient()
	go bootstrap.EnsureOnboardingAgent(sc, namespace)

	// Initialize handlers
	agentHandlers := handlers.NewAgentHandlers(clients, namespace, cache)
	chatHandler := handlers.NewChatHandler(namespace, clients)

	// Set up routes using Go 1.22 path patterns
	mux := http.NewServeMux()

	// Health check
	mux.HandleFunc("GET /healthz", handlers.HealthHandler)

	// Agent CRUD
	mux.HandleFunc("GET /api/agents", agentHandlers.ListAgents)
	mux.HandleFunc("GET /api/agents/{name}", agentHandlers.GetAgent)
	mux.HandleFunc("POST /api/agents", agentHandlers.CreateAgent)
	mux.HandleFunc("DELETE /api/agents/{name}", agentHandlers.DeleteAgent)

	// WebSocket chat
	mux.HandleFunc("GET /api/agents/{name}/chat", chatHandler.HandleChat)

	// Routers
	mux.HandleFunc("GET /api/routers", agentHandlers.ListRouters)

	// Serve static frontend files with SPA fallback
	staticDir := "/app/static/"
	if dir := os.Getenv("STATIC_DIR"); dir != "" {
		staticDir = dir
	}
	mux.Handle("/", spaHandler(staticDir))

	// Wrap with CORS middleware
	handler := corsMiddleware(mux)

	server := &http.Server{
		Addr:         ":8080",
		Handler:      handler,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 120 * time.Second, // Long timeout for chat/websocket
		IdleTimeout:  60 * time.Second,
	}

	// Graceful shutdown
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		log.Println("received shutdown signal")
		cancel()

		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer shutdownCancel()

		if err := server.Shutdown(shutdownCtx); err != nil {
			log.Printf("server shutdown error: %v", err)
		}
	}()

	log.Printf("server listening on :8080")
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("server error: %v", err)
	}

	log.Println("server stopped")
}

// spaHandler serves static files and falls back to index.html for SPA routing.
func spaHandler(staticDir string) http.Handler {
	fs := http.Dir(staticDir)
	fileServer := http.FileServer(fs)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Try to serve the file directly
		f, err := fs.Open(r.URL.Path)
		if err != nil {
			// File not found — serve index.html for SPA client-side routing
			http.ServeFile(w, r, staticDir+"index.html")
			return
		}
		f.Close()
		fileServer.ServeHTTP(w, r)
	})
}

// corsMiddleware adds CORS headers for development use.
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}
