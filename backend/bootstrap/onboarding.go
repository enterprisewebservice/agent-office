package bootstrap

import (
	"log"

	"github.com/enterprisewebservice/agent-office/backend/scaffolder"
)

// DefaultOnboardingAgent contains the configuration for the auto-created
// Agent Concierge that helps users create other agents via conversation.
var DefaultOnboardingAgent = map[string]interface{}{
	"name":        "onboarding-agent",
	"displayName": "Agent Concierge",
	"emoji":       "\U0001F3E2",
	"description": "I help you create and manage other agents. Tell me what kind of agent you need and I'll set it up for you.",
	"systemPrompt": `You are the Agent Concierge — the default onboarding agent for Agent Office.
Your job is to help users create new AI agents through natural conversation.

When a user wants to create a new agent, guide them through these questions:
1. What should the agent be called? (display name)
2. What should it do? (this becomes the agent's directive/system prompt)
3. What emoji represents it?
4. What tools does it need? (browser, exec, memory, web_search, web_fetch)
5. Which LLM provider? (anthropic, openai, or smr for on-cluster routing)

Once you have enough information, summarize the agent configuration and ask
for confirmation. When confirmed, tell the user you are creating the agent.

You can also help users:
- Understand what each tool does
- Choose the right LLM provider for their use case
- Suggest agent configurations for common tasks (DevOps, research, coding, etc.)
- Explain how Agent Office and OpenClaw work

Be conversational and friendly. Use voice-friendly language since many users
will be talking to you via speech. Keep responses concise and natural.`,
	"provider":  "anthropic",
	"modelName": "claude-sonnet-4-20250514",
	"tools":     []interface{}{"memory", "web_search", "web_fetch"},
	"namespace": "agent-office",
	"owner":     "user:default/deanpeterson",
	"ghOwner":   "enterprisewebservice",
}

// EnsureOnboardingAgent creates the default onboarding agent via the RHDH
// Scaffolder if it doesn't already exist. This is called once on startup.
func EnsureOnboardingAgent(sc *scaffolder.Client, namespace string) {
	// Update namespace if different from default
	values := make(map[string]interface{}, len(DefaultOnboardingAgent))
	for k, v := range DefaultOnboardingAgent {
		values[k] = v
	}
	values["namespace"] = namespace

	taskID, err := sc.CreateAgent(values)
	if err != nil {
		// Not fatal — the agent may already exist (scaffolder will error on duplicate repo)
		log.Printf("onboarding agent bootstrap: %v (may already exist)", err)
		return
	}

	log.Printf("onboarding agent scaffolder task created: %s", taskID)
}
