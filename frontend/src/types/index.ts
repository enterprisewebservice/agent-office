export interface Agent {
  name: string;
  displayName: string;
  emoji: string;
  description: string;
  systemPrompt: string;
  provider: 'smr' | 'anthropic' | 'openai' | 'custom';
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
