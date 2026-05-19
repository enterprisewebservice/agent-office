/*
 * codex:reauth scaffolder action.
 *
 * UX contract (what the template log shows):
 *
 *   [codex:reauth] Starting OAuth device-code flow with ChatGPT...
 *   [codex:reauth] ============================================
 *   [codex:reauth] Visit:    https://auth.openai.com/device
 *   [codex:reauth] Enter:    ABCD-WXYZ
 *   [codex:reauth] ============================================
 *   [codex:reauth] Waiting for authorization (10:00 max)...
 *   [codex:reauth] ✓ Authorized
 *   [codex:reauth] Writing new auth.json to Vault path
 *                  agent-office/codex-subscription-credentials
 *                  (CAS protected: previous version = 1)
 *   [codex:reauth] ✓ Vault write OK (new version = 2)
 *   [codex:reauth] Done — ESO will sync the K8s Secret within ~60s.
 *
 * Implementation notes:
 *
 *  - Codex uses OpenAI's OAuth device-flow on the chatgpt-auth tenant.
 *    Endpoints: https://auth.openai.com/oauth/device/code (start)
 *               https://auth.openai.com/oauth/token        (poll)
 *    Client ID is the published chatgpt-cli client. No client secret.
 *
 *  - Vault write uses KV v2's `cas` parameter so concurrent refreshes
 *    (e.g., user kicks off this template just as the CronJob runs)
 *    don't overwrite each other — the loser gets a clean 400 and
 *    aborts. The action reads current version first, then writes
 *    with cas=<that version>.
 *
 *  - Vault auth: the Backstage backend's pod SA token is used to
 *    auth via Vault's kubernetes auth backend (same path ESO uses).
 *    The backend SA needs Vault policy `codex-reauth-writer` granting
 *    `update` on agent-office/data/codex-subscription-credentials.
 *    The cluster-side k8s-auth role for that policy is installed
 *    alongside the operator (see cluster/vault-secret-store/).
 */
import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import fs from 'fs';

interface CodexReauthInput {
  vaultAddr?: string;
  vaultPath?: string;
  vaultK8sRole?: string;
  timeoutMinutes?: number;
}

interface CodexReauthOutput {
  vaultVersion: number;
  accountId: string;
  userCode: string;
}

// Codex (chatgpt-cli) public OAuth client. Same value that ships in
// the openai-codex CLI binary. Not a secret — it's a public client.
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const CODEX_DEVICE_CODE_URL = 'https://auth.openai.com/oauth/device/code';
const CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const CODEX_SCOPE = 'openid profile email offline_access';

// Vault endpoints. The Backstage pod can reach in-cluster via Service.
const DEFAULT_VAULT_ADDR = 'http://vault.vault.svc:8200';
const DEFAULT_VAULT_K8S_ROLE = 'codex-reauth-writer';
const DEFAULT_VAULT_PATH = 'agent-office/codex-subscription-credentials';

// Where the Backstage pod's projected SA token lives.
const SA_TOKEN_PATH = '/var/run/secrets/kubernetes.io/serviceaccount/token';

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
}

interface TokenResponse {
  id_token?: string;
  access_token: string;
  refresh_token: string;
  token_type?: string;
  expires_in?: number;
  // Codex-specific custom claims:
  // account_id is inside the id_token. We parse it out so we can write
  // an auth.json shape that matches what `codex login` writes.
}

interface CodexAuthJson {
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

export const createCodexReauthAction = () =>
  createTemplateAction<CodexReauthInput, CodexReauthOutput>({
    id: 'codex:reauth',
    description:
      'Run OAuth device-code flow against OpenAI Codex, then write the new auth.json to Vault.',
    schema: {
      input: {
        type: 'object',
        properties: {
          vaultAddr: {
            type: 'string',
            description: `Vault server URL. Defaults to ${DEFAULT_VAULT_ADDR}.`,
          },
          vaultPath: {
            type: 'string',
            description:
              `KV v2 path (without /data/) under which to write auth.json. ` +
              `Defaults to ${DEFAULT_VAULT_PATH}.`,
          },
          vaultK8sRole: {
            type: 'string',
            description: `Vault kubernetes auth role to assume. Defaults to ${DEFAULT_VAULT_K8S_ROLE}.`,
          },
          timeoutMinutes: {
            type: 'integer',
            minimum: 2,
            maximum: 30,
            description:
              'Maximum wall-clock time to wait for the user to complete OAuth. Default 10 min.',
          },
        },
      },
      output: {
        type: 'object',
        properties: {
          vaultVersion: {
            type: 'number',
            description:
              'KV v2 version number that the new auth.json was written as.',
          },
          accountId: {
            type: 'string',
            description:
              'ChatGPT account_id captured from the id_token (best-effort).',
          },
          userCode: {
            type: 'string',
            description:
              'Device-flow user code shown to the operator (for audit logs).',
          },
        },
      },
    },
    async handler(ctx) {
      const log = (msg: string) =>
        ctx.logger.info(`[codex:reauth] ${msg}`);

      const vaultAddr = ctx.input.vaultAddr ?? DEFAULT_VAULT_ADDR;
      const vaultPath = ctx.input.vaultPath ?? DEFAULT_VAULT_PATH;
      const vaultRole = ctx.input.vaultK8sRole ?? DEFAULT_VAULT_K8S_ROLE;
      const timeoutMinutes = ctx.input.timeoutMinutes ?? 10;

      // ───────────────────────────────────────────────────────
      // 1. Kick off the OAuth device-code flow
      // ───────────────────────────────────────────────────────
      log('Starting OAuth device-code flow with ChatGPT...');
      const deviceCode = await startDeviceCodeFlow();

      const url =
        deviceCode.verification_uri_complete ??
        `${deviceCode.verification_uri}?user_code=${deviceCode.user_code}`;

      log('============================================');
      log(`Visit:    ${url}`);
      log(`Enter:    ${deviceCode.user_code}`);
      log('============================================');
      log(
        `Waiting for authorization (${timeoutMinutes}:00 max, ` +
          `polling every ${deviceCode.interval}s)...`,
      );

      // ───────────────────────────────────────────────────────
      // 2. Poll for token
      // ───────────────────────────────────────────────────────
      const tokens = await pollForToken(
        deviceCode.device_code,
        deviceCode.interval,
        timeoutMinutes * 60,
      );
      log('✓ Authorized');

      // ───────────────────────────────────────────────────────
      // 3. Compose auth.json in the shape `codex login` writes
      // ───────────────────────────────────────────────────────
      const accountId = extractAccountId(tokens.id_token);
      const authJson: CodexAuthJson = {
        auth_mode: 'chatgpt',
        OPENAI_API_KEY: null,
        tokens: {
          id_token: tokens.id_token ?? '',
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          account_id: accountId,
        },
        last_refresh: new Date().toISOString(),
      };

      // ───────────────────────────────────────────────────────
      // 4. Write to Vault with CAS
      // ───────────────────────────────────────────────────────
      const vaultToken = await loginToVault(vaultAddr, vaultRole, log);
      const currentVersion = await readVaultVersion(
        vaultAddr,
        vaultToken,
        vaultPath,
      );
      log(
        `Writing new auth.json to Vault path ${vaultPath} ` +
          `(CAS protected: previous version = ${currentVersion})`,
      );
      const newVersion = await writeVaultCAS(
        vaultAddr,
        vaultToken,
        vaultPath,
        authJson,
        currentVersion,
      );
      log(`✓ Vault write OK (new version = ${newVersion})`);
      log('Done — ESO will sync the K8s Secret within ~60s.');

      ctx.output('vaultVersion', newVersion);
      ctx.output('accountId', accountId ?? '');
      ctx.output('userCode', deviceCode.user_code);
    },
  });

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

async function startDeviceCodeFlow(): Promise<DeviceCodeResponse> {
  const body = new URLSearchParams({
    client_id: CODEX_CLIENT_ID,
    scope: CODEX_SCOPE,
  });
  const resp = await fetch(CODEX_DEVICE_CODE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!resp.ok) {
    throw new Error(
      `device-code request failed: HTTP ${resp.status} ${await resp.text()}`,
    );
  }
  return (await resp.json()) as DeviceCodeResponse;
}

async function pollForToken(
  deviceCode: string,
  intervalSec: number,
  timeoutSec: number,
): Promise<TokenResponse> {
  const start = Date.now();
  // The OAuth device-flow spec says clients should keep polling at
  // `interval` seconds, bumping to `interval + 5` on `slow_down`.
  let currentInterval = intervalSec;
  while (Date.now() - start < timeoutSec * 1000) {
    await new Promise(r => setTimeout(r, currentInterval * 1000));

    const body = new URLSearchParams({
      client_id: CODEX_CLIENT_ID,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
    const resp = await fetch(CODEX_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (resp.ok) {
      return (await resp.json()) as TokenResponse;
    }
    // RFC 8628 error envelope for device flow.
    const err = (await resp.json().catch(() => ({}))) as { error?: string };
    switch (err.error) {
      case 'authorization_pending':
        continue;
      case 'slow_down':
        currentInterval = intervalSec + 5;
        continue;
      case 'expired_token':
        throw new Error('OAuth device code expired before authorization');
      case 'access_denied':
        throw new Error('OAuth flow denied by user');
      default:
        throw new Error(
          `Unexpected token response: HTTP ${resp.status} err=${err.error ?? '?'}`,
        );
    }
  }
  throw new Error(
    `Timed out waiting for authorization (${timeoutSec}s elapsed)`,
  );
}

function extractAccountId(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const parts = idToken.split('.');
    if (parts.length < 2) return null;
    const json = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8'),
    );
    // The chatgpt id_token nests account context under a custom claim.
    const auth = json['https://api.openai.com/auth'] as
      | { chatgpt_account_id?: string }
      | undefined;
    return auth?.chatgpt_account_id ?? null;
  } catch {
    return null;
  }
}

async function loginToVault(
  vaultAddr: string,
  role: string,
  log: (msg: string) => void,
): Promise<string> {
  const jwt = fs.readFileSync(SA_TOKEN_PATH, 'utf8').trim();
  log(`Vault login: role=${role}, addr=${vaultAddr}`);
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
  const body = (await resp.json()) as {
    auth: { client_token: string };
  };
  return body.auth.client_token;
}

async function readVaultVersion(
  vaultAddr: string,
  token: string,
  path: string,
): Promise<number> {
  // KV v2: GET /v1/<mount>/metadata/<path> returns current_version.
  // The path the user gives us is `<mount>/<sub-path>` so we split.
  const [mount, ...rest] = path.split('/');
  const subPath = rest.join('/');
  const resp = await fetch(
    `${vaultAddr}/v1/${mount}/metadata/${subPath}`,
    {
      method: 'GET',
      headers: { 'X-Vault-Token': token },
    },
  );
  if (resp.status === 404) return 0; // path doesn't exist yet — first write
  if (!resp.ok) {
    throw new Error(
      `Vault metadata GET failed: HTTP ${resp.status} ${await resp.text()}`,
    );
  }
  const body = (await resp.json()) as {
    data: { current_version: number };
  };
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
  const resp = await fetch(
    `${vaultAddr}/v1/${mount}/data/${subPath}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Vault-Token': token,
      },
      body: JSON.stringify({
        options: { cas: expectedVersion },
        data: { 'auth.json': JSON.stringify(authJson, null, 2) },
      }),
    },
  );
  if (resp.status === 400) {
    // Most likely cause: version mismatch (another writer beat us).
    throw new Error(
      `Vault CAS write rejected (HTTP 400): another writer probably ` +
        `updated this path concurrently. Re-run the template to merge.`,
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
