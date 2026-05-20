/*
 * CodexReauthDialog — runs Codex CLI's *real* device-code OAuth
 * flow from the browser.
 *
 * Endpoints + request shapes taken VERBATIM from openai/codex
 * (Rust impl, codex-rs/login/src/device_code_auth.rs and server.rs,
 * read against commit on main as of this writing):
 *
 *   1. POST {issuer}/api/accounts/deviceauth/usercode
 *      body: {"client_id": "<CLIENT_ID>"}
 *      → {device_auth_id, user_code, interval}
 *      The verification URL the user opens is hardcoded
 *      {issuer}/codex/device — they paste user_code there.
 *
 *   2. POST {issuer}/api/accounts/deviceauth/token   (poll loop)
 *      body: {"device_auth_id", "user_code"}
 *      → 200 success: {authorization_code, code_challenge, code_verifier}
 *      → 403/404: still pending, keep polling on `interval`
 *      Max wait 15 min (matches CLI).
 *
 *   3. POST {issuer}/oauth/token
 *      body (form-urlencoded):
 *        grant_type=authorization_code
 *        code=<authorization_code from step 2>
 *        redirect_uri={issuer}/deviceauth/callback   (fixed, NOT
 *          browser-callable — just an opaque marker the IdP expects)
 *        client_id=<CLIENT_ID>
 *        code_verifier=<from step 2>  (PKCE is *server-generated* —
 *          we don't compute the challenge, that's why the unified
 *          device-code endpoint hands it back to us)
 *      → {id_token, access_token, refresh_token}
 *
 * The browser-context is essential: server-side calls to
 * auth.openai.com from cluster DC IPs hit a Cloudflare managed
 * challenge ("Just a moment..."). From a real browser with
 * residential IP + cookies, CF lets the same requests through.
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
import {
  useApi,
  discoveryApiRef,
  fetchApiRef,
} from '@backstage/core-plugin-api';

// From codex-rs/login/src/auth/manager.rs:928
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
// From codex-rs/login/src/server.rs:54
const ISSUER = 'https://auth.openai.com';

const USERCODE_URL = `${ISSUER}/api/accounts/deviceauth/usercode`;
const POLL_URL = `${ISSUER}/api/accounts/deviceauth/token`;
const TOKEN_URL = `${ISSUER}/oauth/token`;
const REDIRECT_URI = `${ISSUER}/deviceauth/callback`;
// User-facing page hosted by OpenAI that prompts for user_code.
const VERIFICATION_URL = `${ISSUER}/codex/device`;

// Backend plugin route: discovery.getBaseUrl('codex-reauth') resolves
// to {backend-baseUrl}/api/codex-reauth — this code POSTs /write on
// top of that. The plugin's HTTP handler extracts tokens from the
// body, reads the pod's SA token, exchanges it for a Vault token,
// and CAS-writes auth.json.

type Phase =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | {
      kind: 'awaiting-authorization';
      userCode: string;
      verificationUrl: string;
    }
  | { kind: 'writing-vault' }
  | { kind: 'done'; vaultVersion: number }
  | { kind: 'error'; message: string };

export interface CodexReauthDialogProps {
  open: boolean;
  onClose: () => void;
  vaultPath?: string;
}

interface UserCodeResp {
  device_auth_id: string;
  user_code: string;
  // Codex's API returns interval as a stringified integer; we parse.
  interval: string | number;
}

interface AuthCodeResp {
  authorization_code: string;
  code_challenge: string;
  code_verifier: string;
}

interface TokenResp {
  id_token: string;
  access_token: string;
  refresh_token: string;
}

export const CodexReauthDialog = (props: CodexReauthDialogProps) => {
  // Backstage's backend default auth policy demands a user identity
  // token on every request; fetchApi.fetch attaches it automatically.
  // discoveryApi resolves the cluster-internal URL of any backend
  // plugin by pluginId — `codex-reauth` maps to /api/codex-reauth/.
  const discovery = useApi(discoveryApiRef);
  const fetchApi = useApi(fetchApiRef);
  const [phase, setPhase] = React.useState<Phase>({ kind: 'idle' });

  React.useEffect(() => {
    if (!props.open) {
      setPhase({ kind: 'idle' });
      return;
    }
    let cancelled = false;

    (async () => {
      try {
        setPhase({ kind: 'starting' });

        // 1. Get user_code + device_auth_id.
        const uc = await requestUserCode();
        if (cancelled) return;
        const intervalSec = Number(uc.interval) || 5;
        setPhase({
          kind: 'awaiting-authorization',
          userCode: uc.user_code,
          verificationUrl: VERIFICATION_URL,
        });

        // 2. Poll until the user authorizes (or 15 min timeout).
        const authResp = await pollForAuthorization(
          uc.device_auth_id,
          uc.user_code,
          intervalSec,
        );
        if (cancelled) return;

        // 3. Exchange authorization_code + PKCE for tokens.
        const tokens = await exchangeForTokens(authResp);
        if (cancelled) return;

        setPhase({ kind: 'writing-vault' });

        // 4. POST tokens to the codex-reauth backend plugin's HTTP
        //    route. The backend owns the SA-token-to-Vault exchange.
        const accountId = extractAccountId(tokens.id_token);
        const result = await postVaultWrite(discovery, fetchApi, {
          idToken: tokens.id_token,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          accountId: accountId ?? undefined,
          vaultPath: props.vaultPath,
        });
        if (cancelled) return;

        setPhase({ kind: 'done', vaultVersion: result.vaultVersion });
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
  }, [props.open, discovery, fetchApi, props.vaultPath]);

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
            Step 1 — Open in a new tab:
          </Typography>
          <Box mt={1} mb={2}>
            <Link
              href={phase.verificationUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {phase.verificationUrl} <OpenInNewIcon fontSize="inherit" />
            </Link>
          </Box>
          <Typography variant="body2" color="textSecondary">
            Step 2 — Enter this code:
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
              Waiting for authorization (up to 15 min)…
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
// Codex OAuth bits — match codex-rs/login/src/device_code_auth.rs
// ─────────────────────────────────────────────────────────────

async function requestUserCode(): Promise<UserCodeResp> {
  const resp = await fetch(USERCODE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '<no body>');
    throw new Error(
      `usercode request failed: HTTP ${resp.status} ${body.slice(0, 200)}`,
    );
  }
  return (await resp.json()) as UserCodeResp;
}

async function pollForAuthorization(
  deviceAuthId: string,
  userCode: string,
  intervalSec: number,
): Promise<AuthCodeResp> {
  const maxWaitMs = 15 * 60 * 1000;
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await new Promise(r => setTimeout(r, intervalSec * 1000));
    const resp = await fetch(POLL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_auth_id: deviceAuthId,
        user_code: userCode,
      }),
    });
    if (resp.ok) {
      return (await resp.json()) as AuthCodeResp;
    }
    // CLI's poll loop treats 403 + 404 as "still pending"; anything
    // else is a hard failure.
    if (resp.status !== 403 && resp.status !== 404) {
      const body = await resp.text().catch(() => '<no body>');
      throw new Error(
        `device-auth poll failed: HTTP ${resp.status} ${body.slice(0, 200)}`,
      );
    }
  }
  throw new Error('Timed out waiting for authorization (15 min)');
}

async function exchangeForTokens(auth: AuthCodeResp): Promise<TokenResp> {
  // form-urlencoded body — matches codex-rs/login/src/server.rs:740.
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: auth.authorization_code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: auth.code_verifier,
  });
  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!resp.ok) {
    const bodyText = await resp.text().catch(() => '<no body>');
    throw new Error(
      `token exchange failed: HTTP ${resp.status} ${bodyText.slice(0, 200)}`,
    );
  }
  return (await resp.json()) as TokenResp;
}

function extractAccountId(idToken: string): string | null {
  try {
    const parts = idToken.split('.');
    if (parts.length < 2) return null;
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(padded));
    const auth = json['https://api.openai.com/auth'] as
      | { chatgpt_account_id?: string }
      | undefined;
    return auth?.chatgpt_account_id ?? null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// Direct HTTP call to the codex-reauth backend plugin
// ─────────────────────────────────────────────────────────────

async function postVaultWrite(
  discovery: { getBaseUrl(pluginId: string): Promise<string> },
  fetchApi: { fetch(input: any, init?: any): Promise<Response> },
  tokens: {
    idToken: string;
    accessToken: string;
    refreshToken: string;
    accountId?: string;
    vaultPath?: string;
  },
): Promise<{ vaultVersion: number }> {
  // discovery.getBaseUrl('codex-reauth') resolves to
  // {backend-baseUrl}/api/codex-reauth. The plugin's router mounts
  // POST /write on top of that.
  const base = await discovery.getBaseUrl('codex-reauth');
  const resp = await fetchApi.fetch(`${base}/write`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(tokens),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '<no body>');
    throw new Error(
      `vault write failed: HTTP ${resp.status} ${body.slice(0, 300)}`,
    );
  }
  return (await resp.json()) as { vaultVersion: number };
}
