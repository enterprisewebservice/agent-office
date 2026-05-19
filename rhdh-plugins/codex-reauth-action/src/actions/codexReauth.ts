/*
 * codex:reauth scaffolder action — Vault writer only.
 *
 * The OAuth device-code flow itself happens IN THE BROWSER (the
 * codex-reauth-ui frontend plugin), because OpenAI's auth.openai.com
 * sits behind Cloudflare and blocks server-side calls from cluster
 * data-center IPs. This action receives the tokens the browser
 * already obtained and persists them to Vault using KV v2 CAS so
 * concurrent rotations (a user-triggered re-auth + the auto-refresh
 * CronJob, for example) don't overwrite each other.
 *
 * Input contract (matches Codex CLI's auth.json shape):
 *   tokens:
 *     id_token        (the full chatgpt id JWT)
 *     access_token    (Bearer token for API calls)
 *     refresh_token   (used by codex CLI to re-mint access tokens)
 *     account_id      (optional; parsed from id_token by the
 *                      frontend before submitting)
 *   vaultPath?       (default: agent-office/codex-subscription-credentials)
 *
 * Output:
 *   vaultVersion     (new KV v2 version number)
 *
 * Auth to Vault: the Backstage backend pod's projected SA token
 * (mounted at /var/run/secrets/kubernetes.io/serviceaccount/token)
 * is exchanged for a Vault token via the `codex-reauth-writer`
 * kubernetes auth role (bound to the v1-developer-hub SA — see
 * cluster/vault-secret-store/kubernetes-auth-config-job.yaml).
 */
import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import fs from 'fs';

const DEFAULT_VAULT_ADDR = 'http://vault.vault.svc:8200';
const DEFAULT_VAULT_K8S_ROLE = 'codex-reauth-writer';
const DEFAULT_VAULT_PATH = 'agent-office/codex-subscription-credentials';
const SA_TOKEN_PATH = '/var/run/secrets/kubernetes.io/serviceaccount/token';

// Shape required by the openclaw container's expected auth.json.
// Identical to what `codex login` writes locally on a laptop.
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
  createTemplateAction({
    id: 'codex:reauth',
    description:
      'Write a pre-obtained Codex OAuth auth.json into Vault. ' +
      'The frontend runs the device-code flow against ChatGPT ' +
      '(browser-side, to bypass Cloudflare) and posts the result here.',
    schema: {
      input: {
        idToken: z =>
          z
            .string()
            .min(1)
            .describe('OAuth id_token from ChatGPT (JWT).'),
        accessToken: z =>
          z
            .string()
            .min(1)
            .describe('OAuth access_token (Bearer).'),
        refreshToken: z =>
          z
            .string()
            .min(1)
            .describe(
              'OAuth refresh_token used by openclaw to re-mint access tokens.',
            ),
        accountId: z =>
          z
            .string()
            .optional()
            .describe(
              'ChatGPT account_id (parsed by frontend from the id_token).',
            ),
        vaultAddr: z =>
          z
            .string()
            .optional()
            .describe(`Vault URL. Default ${DEFAULT_VAULT_ADDR}.`),
        vaultPath: z =>
          z
            .string()
            .optional()
            .describe(`KV v2 path. Default ${DEFAULT_VAULT_PATH}.`),
        vaultK8sRole: z =>
          z
            .string()
            .optional()
            .describe(`Vault k8s-auth role. Default ${DEFAULT_VAULT_K8S_ROLE}.`),
      },
      output: {
        vaultVersion: z =>
          z
            .number()
            .describe('KV v2 version the new auth.json was written as.'),
      },
    },
    async handler(ctx) {
      const log = (msg: string) =>
        ctx.logger.info(`[codex:reauth] ${msg}`);

      const input = ctx.input as unknown as {
        idToken: string;
        accessToken: string;
        refreshToken: string;
        accountId?: string;
        vaultAddr?: string;
        vaultPath?: string;
        vaultK8sRole?: string;
      };

      const vaultAddr = input.vaultAddr ?? DEFAULT_VAULT_ADDR;
      const vaultPath = input.vaultPath ?? DEFAULT_VAULT_PATH;
      const vaultRole = input.vaultK8sRole ?? DEFAULT_VAULT_K8S_ROLE;

      const authJson: CodexAuthJson = {
        auth_mode: 'chatgpt',
        OPENAI_API_KEY: null,
        tokens: {
          id_token: input.idToken,
          access_token: input.accessToken,
          refresh_token: input.refreshToken,
          account_id: input.accountId ?? null,
        },
        last_refresh: new Date().toISOString(),
      };

      log(`Authenticating to Vault @ ${vaultAddr} as role ${vaultRole}`);
      const vaultToken = await loginToVault(vaultAddr, vaultRole);
      const currentVersion = await readVaultVersion(
        vaultAddr,
        vaultToken,
        vaultPath,
      );
      log(
        `Writing auth.json to ${vaultPath} ` +
          `(CAS expecting version ${currentVersion})`,
      );
      const newVersion = await writeVaultCAS(
        vaultAddr,
        vaultToken,
        vaultPath,
        authJson,
        currentVersion,
      );
      log(`✓ Vault write OK — new version ${newVersion}`);
      log(
        'ESO will sync the new auth.json into the in-cluster Secret ' +
          'within ~60s; gateway pods pick it up on the next kubelet ' +
          'refresh (another ~60s). Total propagation: ~2 minutes.',
      );

      ctx.output('vaultVersion', newVersion);
    },
  });

// ─────────────────────────────────────────────────────────────
// Vault helpers
// ─────────────────────────────────────────────────────────────

async function loginToVault(
  vaultAddr: string,
  role: string,
): Promise<string> {
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
        `updated this path concurrently. Re-run the re-auth flow to merge.`,
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
