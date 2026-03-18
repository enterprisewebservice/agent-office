package templates

import (
	"bytes"
	"embed"
	"fmt"
	"text/template"
)

//go:embed openclaw.json.tmpl agents.md.tmpl identity.md.tmpl soul.md.tmpl user.md.tmpl tools.md.tmpl
var templateFS embed.FS

// ModelEntry represents a model in the openclaw.json config.
type ModelEntry struct {
	ID   string
	Name string
}

// OpenClawConfigData holds the data for rendering openclaw.json.
type OpenClawConfigData struct {
	ProviderName string
	BaseURL      string
	APIKeyRef    string
	Models       []ModelEntry
	DefaultModel string
	GatewayToken string
}

// AgentsMdData holds the data for rendering AGENTS.md.
type AgentsMdData struct {
	Name         string
	DisplayName  string
	SystemPrompt string
}

// IdentityMdData holds the data for rendering IDENTITY.md.
type IdentityMdData struct {
	DisplayName string
	Emoji       string
}

// SoulMdData holds the data for rendering SOUL.md.
type SoulMdData struct {
	DisplayName  string
	SystemPrompt string
}

// ToolsMdData holds the data for rendering TOOLS.md.
type ToolsMdData struct {
	Tools []string
}

// CreateAgentRequest mirrors the handler request struct to avoid circular imports.
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

// RenderOpenClawConfig renders the openclaw.json template using the given request data.
func RenderOpenClawConfig(req CreateAgentRequest, namespace, gatewayToken string) (string, error) {
	tmpl, err := template.ParseFS(templateFS, "openclaw.json.tmpl")
	if err != nil {
		return "", fmt.Errorf("parsing openclaw.json template: %w", err)
	}

	data := OpenClawConfigData{
		GatewayToken: gatewayToken,
	}

	switch req.Provider {
	case "smr":
		routerRef := req.RouterRef
		if routerRef == "" {
			routerRef = "default"
		}
		data.ProviderName = "smr"
		data.BaseURL = fmt.Sprintf("http://smr-router-%s.%s.svc.cluster.local", routerRef, namespace)
		data.APIKeyRef = "${SMR_API_KEY}"
		data.Models = []ModelEntry{{ID: "auto", Name: "auto"}}
		data.DefaultModel = "auto"

	case "openai":
		data.ProviderName = "openai"
		data.BaseURL = "https://api.openai.com/v1"
		data.APIKeyRef = "${OPENAI_API_KEY}"
		modelName := req.ModelName
		if modelName == "" {
			modelName = "gpt-4o"
		}
		data.Models = []ModelEntry{{ID: modelName, Name: modelName}}
		data.DefaultModel = modelName

	case "anthropic":
		data.ProviderName = "anthropic"
		data.BaseURL = "https://api.anthropic.com/v1"
		data.APIKeyRef = "${ANTHROPIC_API_KEY}"
		modelName := req.ModelName
		if modelName == "" {
			modelName = "claude-sonnet-4-20250514"
		}
		data.Models = []ModelEntry{{ID: modelName, Name: modelName}}
		data.DefaultModel = modelName

	default:
		return "", fmt.Errorf("unknown provider: %s", req.Provider)
	}

	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		return "", fmt.Errorf("executing openclaw.json template: %w", err)
	}

	return buf.String(), nil
}

// RenderAgentsMd renders the AGENTS.md template using the given request data.
func RenderAgentsMd(req CreateAgentRequest) (string, error) {
	return renderTemplate("agents.md.tmpl", AgentsMdData{
		Name:         req.Name,
		DisplayName:  req.DisplayName,
		SystemPrompt: req.SystemPrompt,
	})
}

// RenderIdentityMd renders the IDENTITY.md workspace file.
func RenderIdentityMd(req CreateAgentRequest) (string, error) {
	return renderTemplate("identity.md.tmpl", IdentityMdData{
		DisplayName: req.DisplayName,
		Emoji:       req.Emoji,
	})
}

// RenderSoulMd renders the SOUL.md workspace file (the agent's directive).
func RenderSoulMd(req CreateAgentRequest) (string, error) {
	return renderTemplate("soul.md.tmpl", SoulMdData{
		DisplayName:  req.DisplayName,
		SystemPrompt: req.SystemPrompt,
	})
}

// RenderUserMd renders the USER.md workspace file.
func RenderUserMd() (string, error) {
	return renderTemplate("user.md.tmpl", nil)
}

// RenderToolsMd renders the TOOLS.md workspace file.
func RenderToolsMd(req CreateAgentRequest) (string, error) {
	return renderTemplate("tools.md.tmpl", ToolsMdData{
		Tools: req.Tools,
	})
}

// renderTemplate is a helper that parses and executes a named template.
func renderTemplate(name string, data interface{}) (string, error) {
	tmpl, err := template.ParseFS(templateFS, name)
	if err != nil {
		return "", fmt.Errorf("parsing %s template: %w", name, err)
	}
	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		return "", fmt.Errorf("executing %s template: %w", name, err)
	}
	return buf.String(), nil
}
