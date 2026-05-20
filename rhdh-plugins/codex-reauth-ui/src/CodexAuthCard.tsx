/*
 * CodexAuthCard — entity-page overview card.
 *
 * Mounted on every Component entity's overview tab (see the
 * mountPoint config in cluster/rhdh/dynamic-plugins-configmap.yaml).
 * Decides per-render whether to actually display anything by
 * fetching /api/proxy/agent-office/codex-auth/status:
 *
 *   {ok: true,  lastRefresh: "<iso>"}           → green "OK" pill
 *   {ok: false, lastRefresh, reason}            → red "Expired" pill
 *   {ok: true,  reason: "secret not readable"}  → return null
 *     (cluster has no Codex usage — keep non-agent Component pages
 *      clean)
 *
 * The proxy entry is declared in the codex-reauth-ui plugin's
 * pluginConfig block: /api/proxy/agent-office → the operator's
 * backstage-catalog Service in agent-office-operator namespace.
 *
 * Clicking "Re-authenticate" opens the shared CodexReauthDialog
 * which runs the OAuth device-code flow IN THE BROWSER (necessary
 * because OpenAI's auth.openai.com sits behind a Cloudflare WAF
 * that refuses data-center IPs).
 */
import React from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  Box,
  Button,
  Chip,
  Typography,
  CircularProgress,
} from '@material-ui/core';
import VpnKeyIcon from '@material-ui/icons/VpnKey';
import {
  useApi,
  discoveryApiRef,
  fetchApiRef,
} from '@backstage/core-plugin-api';
import { CodexReauthDialog } from './CodexReauthDialog';

type Status =
  | { kind: 'loading' }
  | { kind: 'hidden' }
  | { kind: 'ok'; lastRefresh?: string }
  | { kind: 'expired'; reason?: string; lastRefresh?: string };

// Heuristic: when the operator can't find the secret it returns
// {ok: true, reason: "secret ... not readable"} — that's our cue
// that there's no Codex usage on this cluster, so hide the card.
function isNoCodexUsage(reason: string | undefined): boolean {
  if (!reason) return false;
  return /not readable|no auth\.json key|has no data field/i.test(reason);
}

export const CodexAuthCard = () => {
  const discovery = useApi(discoveryApiRef);
  // fetchApi attaches the user's identity token to every request,
  // which Backstage's proxy plugin requires (returns 401 to plain
  // fetch()). Without this the card silently hid itself because
  // every status check came back as !resp.ok.
  const fetchApi = useApi(fetchApiRef);
  const [status, setStatus] = React.useState<Status>({ kind: 'loading' });
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const fetchStatus = React.useCallback(async () => {
    try {
      const base = await discovery.getBaseUrl('proxy');
      const resp = await fetchApi.fetch(`${base}/agent-office/codex-auth/status`);
      if (!resp.ok) {
        setStatus({ kind: 'hidden' });
        return;
      }
      const body = (await resp.json()) as {
        ok: boolean;
        lastRefresh?: string;
        reason?: string;
      };
      if (body.ok && isNoCodexUsage(body.reason)) {
        setStatus({ kind: 'hidden' });
      } else if (body.ok) {
        setStatus({ kind: 'ok', lastRefresh: body.lastRefresh });
      } else {
        setStatus({
          kind: 'expired',
          reason: body.reason,
          lastRefresh: body.lastRefresh,
        });
      }
    } catch {
      // Endpoint not reachable — don't decorate non-agent pages
      // with errors. Hide silently.
      setStatus({ kind: 'hidden' });
    }
  }, [discovery, fetchApi]);

  React.useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  if (status.kind === 'hidden') return null;

  if (status.kind === 'loading') {
    return (
      <Card>
        <CardHeader avatar={<VpnKeyIcon />} title="Codex Subscription Auth" />
        <CardContent>
          <Box display="flex" alignItems="center" gridGap={8}>
            <CircularProgress size={16} />
            <Typography variant="body2">Checking token freshness…</Typography>
          </Box>
        </CardContent>
      </Card>
    );
  }

  const isExpired = status.kind === 'expired';
  const pillProps = isExpired
    ? { label: 'Expired', color: 'secondary' as const }
    : { label: 'OK', color: 'primary' as const };
  const lastRefresh = status.lastRefresh;

  return (
    <Card>
      <CardHeader
        avatar={<VpnKeyIcon />}
        title="Codex Subscription Auth"
        subheader={
          lastRefresh
            ? `Last refresh: ${new Date(lastRefresh).toLocaleString()}`
            : 'Cluster-wide token via Vault'
        }
      />
      <CardContent>
        <Box display="flex" alignItems="center" gridGap={12} mb={2}>
          <Typography variant="body2" color="textSecondary">
            Status:
          </Typography>
          <Chip {...pillProps} />
        </Box>
        <Typography variant="body2" color="textSecondary" paragraph>
          {isExpired
            ? `${status.reason ?? 'Token has expired.'} The new token will propagate to every Codex agent within ~2 minutes after re-authentication.`
            : 'Token is fresh. Use the button below if you need to force-rotate (e.g., after a ChatGPT logout).'}
        </Typography>
        <Button
          variant="contained"
          color={isExpired ? 'secondary' : 'default'}
          onClick={() => setDialogOpen(true)}
        >
          {isExpired ? 'Re-authenticate now' : 'Re-authenticate'}
        </Button>
      </CardContent>
      <CodexReauthDialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
          void fetchStatus();
        }}
      />
    </Card>
  );
};
