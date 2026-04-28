export interface Agent {
  name: string;
  displayName: string;
  emoji: string;
  description: string;
  systemPrompt: string;
  provider: 'smr' | 'anthropic' | 'openai' | 'openai-codex' | 'custom';
  modelName: string;
  routerRef?: string;
  tools: string[];
  image: string;
  status?: {
    phase: string;
    gatewayEndpoint: string;
    lastActivity: string;
  };
}

export interface SmallModelRouter {
  name: string;
  namespace: string;
  endpoint: string;
  phase: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: {
    model?: string;
    routedTo?: string;
    cost?: string;
    tools?: string;
  };
  timestamp: string;
}

export interface AgentSessionState {
  agentName: string;
  cachedConnection: boolean;
  openclawSessionCount: number;
  openclawLatestFile?: string;
  lastUserMessage?: string;
  lastAssistantMessage?: string;
  claudeBridgeSessionCount: number;
  claudeActiveSessionCount: number;
  claudeHistoricalSessionCount: number;
  claudeActiveTaskLabels?: string[];
  claudeRecentTaskLabels?: string[];
}

export interface SessionActionResponse {
  ok: boolean;
  message: string;
  state: AgentSessionState;
}

/**
 * GovernanceAgent is the response shape for `GET /api/governance/agents`.
 * Used by the Map view to surface what's actually running, and the canonical
 * edit path (Open in Dev Spaces → edit YAML → commit; ArgoCD reconciles).
 */
export interface GovernanceAgent {
  name: string;
  displayName: string;
  emoji: string;
  description: string;
  provider: string;
  modelName: string;
  tools: string[];
  phase: string;
  podName?: string;
  /** Image declared on the Deployment (e.g. `quay.io/.../openclaw:latest`). */
  image?: string;
  /** Pulled image digest from the running pod (e.g. `quay.io/...@sha256:abcd`). */
  imageId?: string;
  /** Per-agent GitOps repo on GitHub. */
  gitopsRepoUrl?: string;
  /** Backstage catalog-info link of type=devspaces — opens a workspace pointed at the gitops repo. */
  devSpacesUrl?: string;
  /** Public RHDH UI page for the catalog component, when RHDH_PUBLIC_URL is configured. */
  backstageUrl?: string;
  /** catalog-info `spec.owner` (e.g. `user:default/deanpeterson`). */
  ownerRef?: string;
}

export interface CreateAgentRequest {
  name: string;
  displayName: string;
  emoji: string;
  description: string;
  systemPrompt: string;
  provider: string;
  modelName: string;
  routerRef?: string;
  apiKey?: string;
  tools: string[];
  image?: string;
}
