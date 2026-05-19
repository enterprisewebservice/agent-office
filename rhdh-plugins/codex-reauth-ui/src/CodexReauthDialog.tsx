/*
 * CodexReauthDialog — the device-code OAuth flow, run IN THE BROWSER.
 *
 * Why browser: OpenAI's auth.openai.com sits behind Cloudflare which
 * blocks server-side calls from cluster DC IPs ("Just a moment..."
 * challenge page). Running it in the browser gets through CF because
 * the user's residential IP + real browser context is what CF expects.
 *
 * Flow:
 *   1. POST auth.openai.com/oauth/device/code with the codex CLI's
 *      client_id → receive { device_code, user_code, verification_uri }
 *   2. Show the URL + 8-char code to the user.
 *   3. Poll auth.openai.com/oauth/token every N seconds until the user
 *      authorizes in another tab. (RFC 8628 device-flow contract.)
 *   4. On success, POST { tokens } to the codex:reauth scaffolder
 *      action which writes them to Vault using KV v2 CAS.
 *
 * UX-side, the dialog progresses through three states:
 *   "starting" → "awaiting authorization" → "writing to vault" → done|error
 */
import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  LinearProgress,
  Box,
  Chip,
  Link,
  Divider,
} from '@material-ui/core';
import OpenInNewIcon from '@material-ui/icons/OpenInNew';
import CheckCircleIcon from '@material-ui/icons/CheckCircle';
import ErrorIcon from '@material-ui/icons/Error';
import { useApi } from '@backstage/core-plugin-api';
import { scaffolderApiRef } from '@backstage/plugin-scaffolder-react';

// Public OAuth client of the openai/codex CLI. Not a secret — it
// ships in the binary on every laptop that has Codex installed.
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const DEVICE_URL = 'https://auth.openai.com/oauth/device/code';
const TOKEN_URL = 'https://auth.openai.com/oauth/token';
const SCOPE = 'openid profile email offline_access';

// The scaffolder template the dialog submits when OAuth completes.
// One-step template that calls codex:reauth with the obtained tokens.
// Lives in tssc-dev-multi-ci (see template install below).
const SCAFFOLDER_TEMPLATE_REF = 'template:default/codex-reauth-store';

type Phase =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | {
      kind: 'awaiting-authorization';
      userCode: string;
      verificationUri: string;
      verificationUriComplete?: string;
      expiresAt: number;
    }
  | { kind: 'writing-vault' }
  | { kind: 'done'; vaultVersion: number }
  | { kind: 'error'; message: string };

export interface CodexReauthDialogProps {
  open: boolean;
  onClose: () => void;
  /** Override default Vault path. Used by callers that test against
   *  a non-production tenancy. */
  vaultPath?: string;
}

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
}

export const CodexReauthDialog = (props: CodexReauthDialogProps) => {
  const scaffolderApi = useApi(scaffolderApiRef);
  const [phase, setPhase] = React.useState<Phase>({ kind: 'idle' });

  // Kick the flow when the dialog opens.
  React.useEffect(() => {
    if (!props.open) {
      setPhase({ kind: 'idle' });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setPhase({ kind: 'starting' });
        const dc = await startDeviceFlow();
        if (cancelled) return;
        setPhase({
          kind: 'awaiting-authorization',
          userCode: dc.user_code,
          verificationUri: dc.verification_uri,
          verificationUriComplete: dc.verification_uri_complete,
          expiresAt: Date.now() + dc.expires_in * 1000,
        });
        const tokens = await pollForTokens(dc.device_code, dc.interval, dc.expires_in);
        if (cancelled) return;

        setPhase({ kind: 'writing-vault' });
        const accountId = extractAccountId(tokens.id_token);
        const taskOutput = await submitVaultWrite(
          scaffolderApi,
          {
            idToken: tokens.id_token ?? '',
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            accountId: accountId ?? undefined,
            vaultPath: props.vaultPath,
          },
        );
        if (cancelled) return;
        setPhase({
          kind: 'done',
          vaultVersion: taskOutput.vaultVersion,
        });
      } catch (err) {
        if (cancelled) return;
        setPhase({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.open, scaffolderApi, props.vaultPath]);

  return (
    <Dialog open={props.open} onClose={props.onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Re-authenticate Codex Subscription</DialogTitle>
      <DialogContent>{renderBody(phase)}</DialogContent>
      <DialogActions>
        <Button onClick={props.onClose}>
          {phase.kind === 'done' || phase.kind === 'error' ? 'Close' : 'Cancel'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

function renderBody(phase: Phase) {
  switch (phase.kind) {
    case 'idle':
    case 'starting':
      return (
        <Box>
          <Typography>Contacting ChatGPT…</Typography>
          <LinearProgress />
        </Box>
      );

    case 'awaiting-authorization':
      return (
        <Box>
          <Typography variant="body2" color="textSecondary">
            Step 1 — Open the authorization page in another tab:
          </Typography>
          <Box mt={1} mb={2}>
            <Link
              href={phase.verificationUriComplete ?? phase.verificationUri}
              target="_blank"
              rel="noopener noreferrer"
            >
              {phase.verificationUriComplete ?? phase.verificationUri}{' '}
              <OpenInNewIcon fontSize="inherit" />
            </Link>
          </Box>
          <Typography variant="body2" color="textSecondary">
            Step 2 — Enter this code if prompted:
          </Typography>
          <Box mt={1} mb={2}>
            <Chip
              label={phase.userCode}
              style={{ fontSize: 18, letterSpacing: 4, padding: 8 }}
            />
          </Box>
          <Divider />
          <Box mt={2}>
            <Typography variant="body2">
              Waiting for you to authorize in the other tab…
            </Typography>
            <LinearProgress />
          </Box>
        </Box>
      );

    case 'writing-vault':
      return (
        <Box>
          <Typography>Writing new auth.json to Vault…</Typography>
          <LinearProgress />
        </Box>
      );

    case 'done':
      return (
        <Box display="flex" alignItems="center">
          <CheckCircleIcon style={{ color: 'green', marginRight: 8 }} />
          <Box>
            <Typography>
              Authentication updated (Vault version{' '}
              <strong>{phase.vaultVersion}</strong>).
            </Typography>
            <Typography variant="body2" color="textSecondary">
              ESO will sync the new token to every Codex agent within
              ~2 minutes.
            </Typography>
          </Box>
        </Box>
      );

    case 'error':
      return (
        <Box display="flex" alignItems="center">
          <ErrorIcon style={{ color: 'red', marginRight: 8 }} />
          <Typography>{phase.message}</Typography>
        </Box>
      );
  }
}

// ─────────────────────────────────────────────────────────────
// OAuth bits — run in the browser
// ─────────────────────────────────────────────────────────────

async function startDeviceFlow(): Promise<DeviceCodeResponse> {
  const body = new URLSearchParams({
    client_id: CODEX_CLIENT_ID,
    scope: SCOPE,
  });
  const resp = await fetch(DEVICE_URL, {
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

async function pollForTokens(
  deviceCode: string,
  intervalSec: number,
  timeoutSec: number,
): Promise<TokenResponse> {
  const start = Date.now();
  let interval = intervalSec;
  while ((Date.now() - start) / 1000 < timeoutSec) {
    await new Promise(r => setTimeout(r, interval * 1000));
    const body = new URLSearchParams({
      client_id: CODEX_CLIENT_ID,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
    const resp = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (resp.ok) {
      return (await resp.json()) as TokenResponse;
    }
    const err = (await resp.json().catch(() => ({}))) as { error?: string };
    switch (err.error) {
      case 'authorization_pending':
        continue;
      case 'slow_down':
        interval = intervalSec + 5;
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
  throw new Error(`Timed out waiting for authorization (${timeoutSec}s)`);
}

function extractAccountId(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const parts = idToken.split('.');
    if (parts.length < 2) return null;
    const json = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    const auth = json['https://api.openai.com/auth'] as
      | { chatgpt_account_id?: string }
      | undefined;
    return auth?.chatgpt_account_id ?? null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// Scaffolder API (server-side Vault write)
// ─────────────────────────────────────────────────────────────

async function submitVaultWrite(
  scaffolderApi: any,
  tokens: {
    idToken: string;
    accessToken: string;
    refreshToken: string;
    accountId?: string;
    vaultPath?: string;
  },
): Promise<{ vaultVersion: number }> {
  // Programmatically submit a one-step task that calls codex:reauth
  // with the tokens we just obtained. Backstage's scaffolder API
  // (`scaffold`) takes a template ref + values; the template is a
  // tiny wrapper in tssc-dev-multi-ci (codex-reauth-store).
  const { taskId } = await scaffolderApi.scaffold({
    templateRef: SCAFFOLDER_TEMPLATE_REF,
    values: tokens,
  });

  // Poll task status until done. The scaffolder backend streams
  // task progress; we don't need the log here, just the final
  // output. Cap at 30s — the action itself is just a few HTTP
  // calls to Vault.
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const task = await scaffolderApi.getTask(taskId);
    if (task.status === 'completed') {
      const out = task.output as { vaultVersion?: number } | undefined;
      return { vaultVersion: out?.vaultVersion ?? 0 };
    }
    if (task.status === 'failed' || task.status === 'cancelled') {
      throw new Error(
        `Vault write task ${task.status}: ` +
          (task.lastHeartbeatAt ?? 'see scaffolder task logs'),
      );
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('Vault write task did not complete within 30s');
}
