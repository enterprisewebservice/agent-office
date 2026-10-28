/*
 * CodexAuthCard — entity-page overview card.
 *
 * Mounted on every Component entity's overview tab (see the
 * mountPoint config in cluster/rhdh/dynamic-plugins-configmap.yaml).
 * Fetches /api/proxy/agent-office/codex-auth/status — the agent-office
 * backend's LIVE-VERIFIED auth health:
 *
 *   - stored access token's real JWT expiry per credential secret,
 *   - refresh-token liveness proven by an actual (throttled) refresh
 *     against auth.openai.com — the old "auth.json present and
 *     well-formed" check stayed green through the 2026-08-23 16-hour
 *     newsroom outage; this one cannot,
 *   - per-gateway agent auth profiles (the thing openclaw prunes on a
 *     refresh hiccup) and newsroom desk activity.
 *
 * Four refresh states, and the card's main job is keeping the middle two
 * apart (see refreshState in status.ts):
 *
 *   alive / dead    verdicts from a real refresh — outlined blue / red.
 *   not probed      the backend declined to spend a token that running
 *                   agents hold. Grey and informational: this is the
 *                   system protecting the desk, not a gap.
 *   unverified      a probe ran and reached no verdict — red outline,
 *                   because something is in the way.
 *
 * Colouring "not probed" like "unverified" would train operators to
 * ignore the one state that means a probe genuinely failed.
 *
 * Legacy backends that return only {ok, lastRefresh, reason} still
 * render as a basic pill. If the endpoint is unreachable the card
 * hides itself so non-agent Component pages stay clean.
 *
 * Clicking "Re-authenticate" opens the shared CodexReauthDialog
 * which runs the OAuth device-code flow IN THE BROWSER (necessary
 * because OpenAI's auth.openai.com sits behind a Cloudflare WAF
 * that refuses data-center IPs). The paste-auth.json flow in the
 * agent-office UI is unchanged and remains the manual fallback.
 */
import React from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  Box,
  Button,
  Chip,
  Divider,
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
import {
  CodexAuthHealth,
  CredentialHealth,
  GatewayHealth,
  RefreshState,
  fetchAuthHealth,
  relativeTime,
  credentialProblem,
  credentialHealthy,
  refreshState,
  lineageDrift,
} from './status';

type Status =
  | { kind: 'loading' }
  | { kind: 'hidden' }
  | { kind: 'loaded'; health: CodexAuthHealth };

// When the backend can't see any Codex credential secret or gateway,
// this cluster has no Codex usage — keep non-agent Component pages clean.
function isNoCodexUsage(health: CodexAuthHealth): boolean {
  if (health.credentials && health.gateways) {
    return (
      health.gateways.length === 0 &&
      health.credentials.every(c => !c.secretExists)
    );
  }
  // Legacy operator heuristic.
  return (
    health.ok &&
    /not readable|no auth\.json key|has no data field/i.test(health.reason ?? '')
  );
}

export const CodexAuthCard = () => {
  const discovery = useApi(discoveryApiRef);
  // fetchApi attaches the user's identity token to every request,
  // which Backstage's proxy plugin requires (returns 401 to plain
  // fetch()).
  const fetchApi = useApi(fetchApiRef);
  const [status, setStatus] = React.useState<Status>({ kind: 'loading' });
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [probing, setProbing] = React.useState(false);

  // probe=true is the operator override: it bypasses the backend's probe
  // cache AND its safety gate, so it rotates the stored refresh token.
  const fetchStatus = React.useCallback(
    async (probe = false) => {
      try {
        if (probe) setProbing(true);
        const health = await fetchAuthHealth(discovery, fetchApi, { probe });
        if (!health || isNoCodexUsage(health)) {
          setStatus({ kind: 'hidden' });
          return;
        }
        setStatus({ kind: 'loaded', health });
      } catch {
        // Endpoint not reachable — don't decorate non-agent pages
        // with errors. Hide silently.
        setStatus({ kind: 'hidden' });
      } finally {
        setProbing(false);
      }
    },
    [discovery, fetchApi],
  );

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
            <Typography variant="body2">
              Verifying tokens against OpenAI…
            </Typography>
          </Box>
        </CardContent>
      </Card>
    );
  }

  const { health } = status;
  const problem = !health.ok;

  return (
    <Card>
      <CardHeader
        avatar={<VpnKeyIcon />}
        title="Codex Subscription Auth"
        subheader={
          health.checkedAt
            ? `Live-verified ${relativeTime(health.checkedAt)}`
            : 'Live-verified against OpenAI'
        }
        action={
          <Box mt={1} mr={1}>
            <Chip
              label={problem ? 'Attention' : 'OK'}
              color={problem ? 'secondary' : 'primary'}
            />
          </Box>
        }
      />
      <CardContent>
        {problem && (
          <Typography variant="body2" color="error" paragraph>
            {health.reason ?? 'Codex auth needs attention.'}
          </Typography>
        )}

        {health.credentials ? (
          renderCredentials(health.credentials, probing, () =>
            fetchStatus(true),
          )
        ) : (
          <Typography variant="body2" color="textSecondary" paragraph>
            {health.ok
              ? 'Token is fresh.'
              : health.reason ?? 'Token has expired.'}
            {health.lastRefresh
              ? ` Last refresh: ${new Date(health.lastRefresh).toLocaleString()}.`
              : ''}
          </Typography>
        )}

        {health.gateways && health.gateways.length > 0 && (
          <>
            <Box my={1.5}>
              <Divider />
            </Box>
            {renderGateways(health.gateways, health.credentials)}
          </>
        )}

        <Box mt={2}>
          <Button
            variant="contained"
            color={problem ? 'secondary' : 'default'}
            onClick={() => setDialogOpen(true)}
          >
            {problem ? 'Re-authenticate now' : 'Re-authenticate'}
          </Button>
        </Box>
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

function renderCredentials(
  credentials: CredentialHealth[],
  probing: boolean,
  forceProbe: () => void,
) {
  return (
    <Box>
      {credentials.map(c => {
        const healthy = credentialHealthy(c);
        const reason = credentialProblem(c);
        const state = refreshState(c);
        const pill = credentialPill(c, state);
        return (
          <Box key={c.secret} mb={1.5}>
            <Box display="flex" alignItems="center" gridGap={8}>
              <Typography variant="subtitle2">{c.secret}</Typography>
              <Chip
                size="small"
                label={pill.label}
                color={pill.color}
                variant={pill.variant}
              />
            </Box>
            <Typography variant="body2" color="textSecondary">
              Access token{' '}
              {c.accessTokenExpired
                ? `expired ${relativeTime(c.accessTokenExpiresAt)}`
                : `expires ${relativeTime(c.accessTokenExpiresAt)}`}
              {' · '}
              {refreshLine(c, state)}
              {c.lastRefresh
                ? ` · last refresh ${relativeTime(c.lastRefresh)}`
                : ''}
            </Typography>
            {!healthy && reason && (
              <Typography variant="body2" color="error">
                {reason}
              </Typography>
            )}
            {state === 'not-probed' && renderNotProbed(c, probing, forceProbe)}
            {c.gateways.length > 0 && (
              <Typography variant="caption" color="textSecondary">
                Used by: {c.gateways.join(', ')}
              </Typography>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

/*
 * The not-probed explainer. Deliberately grey and wordy: an operator
 * seeing "not probed" for the first time needs to learn that the backend
 * held the probe back ON PURPOSE, what it is reporting instead, and that
 * the override exists — otherwise they go looking for a fault that isn't
 * there, or worse, force a rotation without knowing what it costs.
 */
function renderNotProbed(
  c: CredentialHealth,
  probing: boolean,
  forceProbe: () => void,
) {
  return (
    <Box mt={0.5} mb={0.5}>
      <Typography variant="caption" color="textSecondary" component="div">
        {c.refreshSkipReason}
        {c.lineage ? ` (lineage ${c.lineage})` : ''}. Verifying spends the
        token — Codex rotates on every refresh — so liveness here is read
        from {c.livenessBasis || 'the signals above'}.
        {c.refreshLastAlive
          ? ` Last proven alive ${relativeTime(c.refreshLastAlive)}.`
          : ''}
      </Typography>
      <Button
        size="small"
        disabled={probing}
        onClick={forceProbe}
        style={{ paddingLeft: 0, minWidth: 0 }}
      >
        {probing ? 'Verifying…' : 'Verify now (rotates the token)'}
      </Button>
    </Box>
  );
}

type Pill = {
  label: string;
  color: 'primary' | 'secondary' | 'default';
  variant: 'outlined' | 'default';
};

/*
 * "Not probed" is grey-outlined and "Unverified" is red-outlined on
 * purpose: only one of them means a check failed.
 */
function credentialPill(c: CredentialHealth, state: RefreshState): Pill {
  if (!c.secretExists)
    return { label: 'Missing', color: 'secondary', variant: 'default' };
  switch (state) {
    case 'alive':
      return { label: 'Refresh alive', color: 'primary', variant: 'outlined' };
    case 'dead':
      return { label: 'Refresh dead', color: 'secondary', variant: 'default' };
    case 'not-probed':
      return c.accessTokenExpired
        ? { label: 'Expired', color: 'secondary', variant: 'default' }
        : { label: 'Not probed', color: 'default', variant: 'outlined' };
    default:
      return c.accessTokenExpired
        ? { label: 'Expired', color: 'secondary', variant: 'default' }
        : { label: 'Unverified', color: 'secondary', variant: 'outlined' };
  }
}

function refreshLine(c: CredentialHealth, state: RefreshState): string {
  switch (state) {
    case 'alive':
      return `refresh verified ${relativeTime(c.refreshCheckedAt)}`;
    case 'dead':
      return 'refresh token rejected';
    case 'not-probed':
      return c.agentsOnLineage
        ? `refresh not probed (${c.agentsOnLineage} agent${
            c.agentsOnLineage === 1 ? '' : 's'
          } on this token)`
        : 'refresh not probed';
    default:
      return c.refreshError
        ? `refresh unverified (${c.refreshError})`
        : 'refresh not yet verified';
  }
}

function renderGateways(
  gateways: GatewayHealth[],
  credentials: CredentialHealth[] = [],
) {
  const anyMissing = gateways.some(
    g => g.agentsWithProfile < g.agents.length && g.agents.length > 0,
  );
  return (
    <Box>
      {gateways.map(g => {
        const total = g.agents.length;
        const missing = g.agents.filter(a => !a.profilePresent);
        const gwProblem = total > 0 && missing.length > 0;
        const drift = lineageDrift(g, credentials);
        return (
          <Box key={g.name} mb={1}>
            <Box display="flex" alignItems="center" gridGap={8} flexWrap="wrap">
              <Typography variant="subtitle2">{g.name}</Typography>
              <Chip
                size="small"
                label={
                  total > 0
                    ? `${g.agentsWithProfile}/${total} agent profiles`
                    : 'no agents probed'
                }
                color={gwProblem ? 'secondary' : 'default'}
                variant={gwProblem ? 'default' : 'outlined'}
              />
              {g.desk?.verdict && (
                <Chip
                  size="small"
                  label={`desk ${g.desk.verdict}`}
                  color={g.desk.verdict === 'HEALTHY' ? 'default' : 'secondary'}
                  variant="outlined"
                />
              )}
            </Box>
            <Typography variant="body2" color="textSecondary">
              Last agent activity:{' '}
              {g.lastActivity ? relativeTime(g.lastActivity) : 'none observed'}
              {gwProblem
                ? ` · missing profiles: ${missing.map(a => a.name).join(', ')}`
                : ''}
            </Typography>
            {drift.length > 0 && (
              <Typography variant="caption" color="textSecondary">
                Token lineage differs from {g.secret}: {drift.join(', ')} —
                expected within ~2min of a rotation, worth a look if it
                persists.
              </Typography>
            )}
            {g.probeError && (
              <Typography variant="caption" color="textSecondary">
                probe: {g.probeError}
              </Typography>
            )}
          </Box>
        );
      })}
      {anyMissing && (
        <Typography variant="caption" color="textSecondary">
          Agents without an oauth profile fail with ProviderAuthError on
          their next shift even while this credential secret is healthy —
          re-seed them from the gateway's auth.json (runbook: “Desk
          watchdog + Codex auth outage”).
        </Typography>
      )}
    </Box>
  );
}
