/*
 * Vault helpers used by the HTTP route handler.
 *
 * Auth flow: read the projected SA token off /var/run/secrets/...,
 * exchange it for a Vault token via kubernetes auth backend, then
 * KV v2 CAS-write the auth.json. The CAS protects against races
 * between user-triggered re-auth (this code) and the scheduled
 * refresh CronJob (step 6, future).
 */
import fs from 'fs';

export const DEFAULT_VAULT_ADDR = 'http://vault.vault.svc:8200';
export const DEFAULT_VAULT_K8S_ROLE = 'codex-reauth-writer';
export const DEFAULT_VAULT_PATH = 'agent-office/codex-subscription-credentials';
const SA_TOKEN_PATH = '/var/run/secrets/kubernetes.io/serviceaccount/token';

export interface CodexAuthJson {
  auth_mode: 'chatgpt';
  OPENAI_API_KEY: null;
  tokens: {
    id_token: string;
    access_token: string;
    refresh_token: string;
    account_id: string | null;
  };
  last_refresh: string;
}

export interface WriteOptions {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  accountId?: string;
  vaultAddr?: string;
  vaultPath?: string;
  vaultK8sRole?: string;
}

export interface WriteResult {
  vaultVersion: number;
}

/** Top-level write: composes the auth.json + CAS-writes to Vault. */
export async function writeCodexAuthJson(
  opts: WriteOptions,
  log?: (msg: string) => void,
): Promise<WriteResult> {
  const vaultAddr = opts.vaultAddr ?? DEFAULT_VAULT_ADDR;
  const vaultPath = opts.vaultPath ?? DEFAULT_VAULT_PATH;
  const vaultRole = opts.vaultK8sRole ?? DEFAULT_VAULT_K8S_ROLE;

  const authJson: CodexAuthJson = {
    auth_mode: 'chatgpt',
    OPENAI_API_KEY: null,
    tokens: {
      id_token: opts.idToken,
      access_token: opts.accessToken,
      refresh_token: opts.refreshToken,
      account_id: opts.accountId ?? null,
    },
    last_refresh: new Date().toISOString(),
  };

  log?.(`Authenticating to Vault @ ${vaultAddr} as role ${vaultRole}`);
  const vaultToken = await loginToVault(vaultAddr, vaultRole);
  const currentVersion = await readVaultVersion(vaultAddr, vaultToken, vaultPath);
  log?.(`Writing auth.json to ${vaultPath} (CAS expecting version ${currentVersion})`);
  const newVersion = await writeVaultCAS(
    vaultAddr,
    vaultToken,
    vaultPath,
    authJson,
    currentVersion,
  );
  log?.(`Vault write OK — new version ${newVersion}`);
  return { vaultVersion: newVersion };
}

async function loginToVault(vaultAddr: string, role: string): Promise<string> {
  const jwt = fs.readFileSync(SA_TOKEN_PATH, 'utf8').trim();
  const resp = await fetch(`${vaultAddr}/v1/auth/kubernetes/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role, jwt }),
  });
  if (!resp.ok) {
    throw new Error(
      `Vault login failed: HTTP ${resp.status} ${await resp.text()}`,
    );
  }
  const body = (await resp.json()) as { auth: { client_token: string } };
  return body.auth.client_token;
}

async function readVaultVersion(
  vaultAddr: string,
  token: string,
  path: string,
): Promise<number> {
  const [mount, ...rest] = path.split('/');
  const subPath = rest.join('/');
  const resp = await fetch(`${vaultAddr}/v1/${mount}/metadata/${subPath}`, {
    headers: { 'X-Vault-Token': token },
  });
  if (resp.status === 404) return 0;
  if (!resp.ok) {
    throw new Error(
      `Vault metadata GET failed: HTTP ${resp.status} ${await resp.text()}`,
    );
  }
  const body = (await resp.json()) as { data: { current_version: number } };
  return body.data.current_version;
}

async function writeVaultCAS(
  vaultAddr: string,
  token: string,
  path: string,
  authJson: CodexAuthJson,
  expectedVersion: number,
): Promise<number> {
  const [mount, ...rest] = path.split('/');
  const subPath = rest.join('/');
  const resp = await fetch(`${vaultAddr}/v1/${mount}/data/${subPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Vault-Token': token,
    },
    body: JSON.stringify({
      options: { cas: expectedVersion },
      data: { 'auth.json': JSON.stringify(authJson, null, 2) },
    }),
  });
  if (resp.status === 400) {
    throw new Error(
      `Vault CAS write rejected (HTTP 400): another writer probably ` +
        `updated this path concurrently. Try again.`,
    );
  }
  if (!resp.ok) {
    throw new Error(
      `Vault KV write failed: HTTP ${resp.status} ${await resp.text()}`,
    );
  }
  const body = (await resp.json()) as { data: { version: number } };
  return body.data.version;
}
