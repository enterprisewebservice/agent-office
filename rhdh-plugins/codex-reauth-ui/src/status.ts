/*
 * Shared client for the agent-office backend's /codex-auth/status
 * endpoint (proxied as /api/proxy/agent-office/codex-auth/status).
 *
 * The backend live-verifies auth instead of shape-checking auth.json:
 *   - decodes the stored access token's JWT expiry,
 *   - proves the refresh token alive with a real (throttled) refresh
 *     against auth.openai.com — persisted only on success,
 *   - reports per-gateway agent auth profiles and newsroom desk
 *     activity.
 */

export interface CredentialHealth {
  secret: string;
  secretExists: boolean;
  authMode?: string;
  accountId?: string;
  hasRefreshToken: boolean;
  accessTokenExpiresAt?: string;
  accessTokenExpired: boolean;
  lastRefresh?: string;
  /** true = proven alive, false = definitively rejected, null = unproven */
  refreshAlive: boolean | null;
  refreshError?: string;
  refreshCheckedAt?: string;
  gateways: string[];
}

export interface AgentAuthHealth {
  name: string;
  profilePresent: boolean;
  profileExpiresAt?: string;
  lastUsed?: string;
  errorCount: number;
  error?: string;
}

export interface DeskHealth {
  url: string;
  verdict?: string;
  last?: Record<string, string>;
  lastActivity?: string;
  error?: string;
}

export interface GatewayHealth {
  name: string;
  secret?: string;
  agents: AgentAuthHealth[];
  agentsWithProfile: number;
  probeError?: string;
  desk?: DeskHealth;
  lastActivity?: string;
}

export interface CodexAuthHealth {
  ok: boolean;
  reason?: string;
  lastRefresh?: string;
  checkedAt?: string;
  // Absent when talking to a pre-live-probe backend — fall back to the
  // legacy ok/reason rendering in that case.
  credentials?: CredentialHealth[];
  gateways?: GatewayHealth[];
}

export async function fetchAuthHealth(
  discovery: { getBaseUrl(pluginId: string): Promise<string> },
  fetchApi: { fetch(input: any, init?: any): Promise<Response> },
): Promise<CodexAuthHealth | null> {
  const base = await discovery.getBaseUrl('proxy');
  const resp = await fetchApi.fetch(`${base}/agent-office/codex-auth/status`);
  if (!resp.ok) return null;
  return (await resp.json()) as CodexAuthHealth;
}

/** "in 9d 22h" / "3h ago" / "just now" — coarse on purpose. */
export function relativeTime(iso: string | undefined): string {
  if (!iso) return 'unknown';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  let deltaMs = t - Date.now();
  const future = deltaMs >= 0;
  deltaMs = Math.abs(deltaMs);
  const mins = Math.floor(deltaMs / 60000);
  if (mins < 1) return 'just now';
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  let span: string;
  if (days > 0) span = `${days}d ${hours}h`;
  else if (hours > 0) span = `${hours}h ${mins % 60}m`;
  else span = `${mins}m`;
  return future ? `in ${span}` : `${span} ago`;
}

export function credentialProblem(c: CredentialHealth): string | null {
  if (!c.secretExists) return `secret ${c.secret} not found`;
  if (c.refreshAlive === false)
    return `refresh token rejected${c.refreshError ? ` — ${c.refreshError}` : ''}`;
  if (c.accessTokenExpired && c.refreshAlive !== true)
    return `access token expired ${relativeTime(c.accessTokenExpiresAt)} and refresh is unverified`;
  return null;
}

export function credentialHealthy(c: CredentialHealth): boolean {
  return (
    c.refreshAlive === true ||
    (c.refreshAlive === null && c.secretExists && !c.accessTokenExpired)
  );
}
