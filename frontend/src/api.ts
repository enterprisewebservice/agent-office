import type { Agent, CreateAgentRequest, SmallModelRouter } from './types';

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
