package handlers

import (
	"encoding/json"
	"net/http"
)

// HealthHandler returns a 200 OK with a simple status response.
func HealthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}
