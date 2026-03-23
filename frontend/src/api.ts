import type { Agent, AgentSessionState, CreateAgentRequest, SessionActionResponse, SmallModelRouter } from './types';

const API_BASE = '';

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`API error ${response.status}: ${body || response.statusText}`);
  }
  return response.json() as Promise<T>;
}

export async function fetchAgents(): Promise<Agent[]> {
  const response = await fetch(`${API_BASE}/api/agents`);
  return handleResponse<Agent[]>(response);
}

export async function fetchAgent(name: string): Promise<Agent> {
  const response = await fetch(`${API_BASE}/api/agents/${encodeURIComponent(name)}`);
  return handleResponse<Agent>(response);
}

export async function createAgent(req: CreateAgentRequest): Promise<Agent> {
  const response = await fetch(`${API_BASE}/api/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  return handleResponse<Agent>(response);
}

export async function deleteAgent(name: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/agents/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`API error ${response.status}: ${body || response.statusText}`);
  }
}

export async function fetchRouters(): Promise<SmallModelRouter[]> {
  const response = await fetch(`${API_BASE}/api/routers`);
  return handleResponse<SmallModelRouter[]>(response);
}

export interface ClaudeStatus {
  connected: boolean;
  accountId?: string;
  hasRefreshToken: boolean;
  secretExists: boolean;
  expired?: boolean;
}

export async function fetchClaudeStatus(): Promise<ClaudeStatus> {
  const response = await fetch(`${API_BASE}/api/claude/status`);
  return handleResponse<ClaudeStatus>(response);
}

export async function updateClaudeCredentials(credentials: object): Promise<{ ok: boolean; message: string }> {
  const response = await fetch(`${API_BASE}/api/claude/credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  });
  return handleResponse<{ ok: boolean; message: string }>(response);
}

export async function startClaudeAuth(): Promise<{ authUrl: string; message: string }> {
  const response = await fetch(`${API_BASE}/api/claude/auth/start`, { method: 'POST' });
  return handleResponse<{ authUrl: string; message: string }>(response);
}

export async function exchangeClaudeCode(code: string): Promise<{ ok: boolean; message: string; accountId?: string }> {
  const response = await fetch(`${API_BASE}/api/claude/auth/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  return handleResponse<{ ok: boolean; message: string; accountId?: string }>(response);
}

export async function checkHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/healthz`);
    return response.ok;
  } catch {
    return false;
  }
}

export function createChatWebSocket(agentName: string): WebSocket {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  return new WebSocket(`${protocol}//${host}/api/agents/${encodeURIComponent(agentName)}/chat`);
}

export async function fetchAgentSessionState(agentName: string): Promise<AgentSessionState> {
  const response = await fetch(`${API_BASE}/api/agents/${encodeURIComponent(agentName)}/session`);
  return handleResponse<AgentSessionState>(response);
}

export async function startFreshAgentSession(agentName: string): Promise<SessionActionResponse> {
  const response = await fetch(`${API_BASE}/api/agents/${encodeURIComponent(agentName)}/session/fresh`, {
    method: 'POST',
  });
  return handleResponse<SessionActionResponse>(response);
}

export async function resetAgentSessions(agentName: string): Promise<SessionActionResponse> {
  const response = await fetch(`${API_BASE}/api/agents/${encodeURIComponent(agentName)}/session/reset`, {
    method: 'POST',
  });
  return handleResponse<SessionActionResponse>(response);
}

export async function synthesizeSpeech(
  text: string,
  voice = 'marin',
  instructions = 'Speak naturally, warmly, and conversationally. Avoid robotic pacing.'
): Promise<Blob> {
  const response = await fetch(`${API_BASE}/api/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice, instructions }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`TTS error ${response.status}: ${body || response.statusText}`);
  }

  return response.blob();
}
