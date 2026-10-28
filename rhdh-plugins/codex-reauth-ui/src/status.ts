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
 *
 * That live refresh SPENDS the token (Codex refresh tokens are single-use
 * with rotation), so the backend skips it whenever agents are running on
 * the same token lineage and reports liveness from the cheaper signals
 * instead. That is a healthy, deliberate state — see refreshState(), and
 * keep it visually apart from a probe that ran and failed.
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
  /** Is the refreshAlive verdict backed by a real call to OpenAI? */
  refreshProbed?: boolean;
  /** Set when the live refresh was deliberately skipped to protect agents. */
  refreshSkipReason?: string;
  /** Last time a real probe proved this token alive (kept past its TTL). */
  refreshLastAlive?: string;
  /** sha256(refresh token)[:12] — identifies the grant, never exposes it. */
  lineage?: string;
  /** Live agent profiles holding that exact token right now. */
  agentsOnLineage?: number;
  /** What a not-probed verdict rests on: expiry, profiles, activity. */
  livenessBasis?: string;
  gateways: string[];
}

export interface AgentAuthHealth {
  name: string;
  profilePresent: boolean;
  profileExpiresAt?: string;
  lastUsed?: string;
  errorCount: number;
  error?: string;
  /** Fingerprints of the refresh tokens this agent's openai profiles hold. */
  lineages?: string[];
}

export interface DeskHealth {
  url: string;
  verdict?: string;
  last?: Record<string, string>;
  lastActivity?: string;
  error?: string;
}

// The gateway's last daily test turn (backend codex_turn.go): one tiny
// `openclaw agent` turn a day, the only proof OpenAI still honours the token.
export interface TurnHealth {
  ok: boolean;
  checkedAt: string;
  seconds: number;
  agent?: string;
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
  turn?: TurnHealth;
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

/**
 * `probe: true` is the operator override (?probe=1): it bypasses both the
 * probe cache and the safety gate, so it WILL rotate the stored refresh
 * token. Only call it from a control that says so.
 */
export async function fetchAuthHealth(
  discovery: { getBaseUrl(pluginId: string): Promise<string> },
  fetchApi: { fetch(input: any, init?: any): Promise<Response> },
  opts: { probe?: boolean } = {},
): Promise<CodexAuthHealth | null> {
  const base = await discovery.getBaseUrl('proxy');
  const resp = await fetchApi.fetch(
    `${base}/agent-office/codex-auth/status${opts.probe ? '?probe=1' : ''}`,
  );
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

/**
 * The four states a credential's refresh token can be in, in the order the
 * card must keep them apart:
 *
 *   alive       — a real refresh against OpenAI succeeded.
 *   dead        — OpenAI definitively rejected it. Red; needs re-auth.
 *   not-probed  — the backend declined to spend the token because agents
 *                 are running on it. Informational: nothing is wrong.
 *   unverified  — a probe ran and could not reach a verdict, or hasn't
 *                 run yet. Worth attention, unlike not-probed.
 *
 * Keyed on refreshSkipReason rather than refreshProbed so a pre-gate
 * backend (which sends neither) still lands on 'unverified' as before.
 */
export type RefreshState = 'alive' | 'dead' | 'not-probed' | 'unverified';

export function refreshState(c: CredentialHealth): RefreshState {
  if (c.refreshAlive === true) return 'alive';
  if (c.refreshAlive === false) return 'dead';
  if (c.refreshSkipReason) return 'not-probed';
  return 'unverified';
}

export function credentialProblem(c: CredentialHealth): string | null {
  if (!c.secretExists) return `secret ${c.secret} not found`;
  if (c.refreshAlive === false)
    return `refresh token rejected${c.refreshError ? ` — ${c.refreshError}` : ''}`;
  if (c.accessTokenExpired && c.refreshAlive !== true)
    return refreshState(c) === 'not-probed'
      ? `access token expired ${relativeTime(c.accessTokenExpiresAt)} and the refresh probe was held back`
      : `access token expired ${relativeTime(c.accessTokenExpiresAt)} and refresh is unverified`;
  return null;
}

/**
 * A not-probed credential is healthy: declining to spend a token that
 * agents are using protects them, and it cannot mask an expired access
 * token — expiry is exactly the condition that makes the backend probe.
 */
export function credentialHealthy(c: CredentialHealth): boolean {
  return (
    c.refreshAlive === true ||
    (c.refreshAlive === null && c.secretExists && !c.accessTokenExpired)
  );
}

/**
 * Agents whose stored refresh token is not the one in their gateway's
 * credential secret. Drift is normal for a couple of minutes after a
 * rotation (codex-auth-sync re-seeds on a 30s tick) and a real finding if
 * it persists — it is what a hand-run lineage diff used to catch.
 */
export function lineageDrift(
  gateway: GatewayHealth,
  credentials: CredentialHealth[] = [],
): string[] {
  const expected = credentials.find(c => c.secret === gateway.secret)?.lineage;
  if (!expected) return [];
  return gateway.agents
    .filter(a => a.lineages?.length && !a.lineages.includes(expected))
    .map(a => a.name);
}
