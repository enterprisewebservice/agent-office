package scaffolder

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

// Client talks to the RHDH Scaffolder API.
type Client struct {
	BaseURL string
	Token   string
	HTTP    *http.Client
}

// NewClient creates a scaffolder client from environment variables.
// RHDH_URL: Developer Hub base URL
// RHDH_TOKEN: Static token for API authentication
func NewClient() *Client {
	baseURL := os.Getenv("RHDH_URL")
	if baseURL == "" {
		baseURL = "http://v1-developer-hub.rhdh-test.svc.cluster.local:7007"
	}
	token := os.Getenv("RHDH_TOKEN")

	return &Client{
		BaseURL: baseURL,
		Token:   token,
		HTTP: &http.Client{
			Timeout: 60 * time.Second,
		},
	}
}

// TaskRequest is the body sent to POST /api/scaffolder/v2/tasks.
type TaskRequest struct {
	TemplateRef string                 `json:"templateRef"`
	Values      map[string]interface{} `json:"values"`
}

// TaskResponse is the response from creating a scaffolder task.
type TaskResponse struct {
	ID string `json:"id"`
}

// TaskStatus is the response from GET /api/scaffolder/v2/tasks/:id.
type TaskStatus struct {
	ID     string `json:"id"`
	Status string `json:"status"` // "processing", "completed", "failed"
}

// CreateAgent calls the RHDH Scaffolder to provision an OpenClaw agent
// via the openclaw-agent Software Template.
func (c *Client) CreateAgent(values map[string]interface{}) (string, error) {
	req := TaskRequest{
		TemplateRef: "template:default/openclaw-agent",
		Values:      values,
	}

	body, err := json.Marshal(req)
	if err != nil {
		return "", fmt.Errorf("marshalling scaffolder request: %w", err)
	}

	httpReq, err := http.NewRequest(http.MethodPost, c.BaseURL+"/api/scaffolder/v2/tasks", bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("creating scaffolder request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	if c.Token != "" {
		httpReq.Header.Set("Authorization", "Bearer "+c.Token)
	}

	resp, err := c.HTTP.Do(httpReq)
	if err != nil {
		return "", fmt.Errorf("calling scaffolder API: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return "", fmt.Errorf("scaffolder returned status %d: %s", resp.StatusCode, string(respBody))
	}

	var taskResp TaskResponse
	if err := json.Unmarshal(respBody, &taskResp); err != nil {
		return "", fmt.Errorf("parsing scaffolder response: %w", err)
	}

	return taskResp.ID, nil
}

// GetTaskStatus checks the status of a scaffolder task.
func (c *Client) GetTaskStatus(taskID string) (*TaskStatus, error) {
	httpReq, err := http.NewRequest(http.MethodGet, fmt.Sprintf("%s/api/scaffolder/v2/tasks/%s", c.BaseURL, taskID), nil)
	if err != nil {
		return nil, fmt.Errorf("creating status request: %w", err)
	}
	if c.Token != "" {
		httpReq.Header.Set("Authorization", "Bearer "+c.Token)
	}

	resp, err := c.HTTP.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("checking task status: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	var status TaskStatus
	if err := json.Unmarshal(respBody, &status); err != nil {
		return nil, fmt.Errorf("parsing task status: %w", err)
	}

	return &status, nil
}
