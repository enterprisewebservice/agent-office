/*
 * CodexAuthPreflightField — scaffolder field extension that gates
 * a template's submit button on Codex auth being fresh.
 *
 * UX: a banner appears at the top of the form. If Codex auth is OK,
 * the banner is green and the field's value is "ok" (passes
 * required validation). If expired, the banner is red, the value
 * is empty (failing required validation, blocking submit), and a
 * "Re-authenticate now" button opens the CodexReauthDialog. When
 * the dialog completes, the banner re-checks and unlocks the form.
 *
 * Templates use it as:
 *
 *   parameters:
 *     - title: Pre-flight
 *       required: [codexAuthOk]
 *       properties:
 *         codexAuthOk:
 *           type: string
 *           ui:field: CodexAuthPreflight
 *
 * Auth status is fetched from the same operator catalog endpoint
 * that drives CodexAuthCard — a lightweight GET that returns the
 * cluster-wide token freshness. Until B-3 ships, the field
 * optimistically assumes OK and lets the user submit.
 */
import React from 'react';
import {
  Box,
  Button,
  Typography,
  Paper,
  Chip,
  CircularProgress,
} from '@material-ui/core';
import CheckCircleIcon from '@material-ui/icons/CheckCircle';
import ErrorIcon from '@material-ui/icons/Error';
import {
  useApi,
  discoveryApiRef,
  fetchApiRef,
} from '@backstage/core-plugin-api';
import { FieldExtensionComponentProps } from '@backstage/plugin-scaffolder-react';
import { CodexReauthDialog } from './CodexReauthDialog';

// Status endpoint path used via Backstage's discoveryApi (the
// 'proxy' baseUrl resolves to the cluster-internal proxy plugin).
// Kept as a const for clarity even though it's only referenced
// in a template string — explicit > clever.
//
// (Wire-up to the operator-emitted endpoint lands in B-3.)
type Status =
  | { kind: 'loading' }
  | { kind: 'ok'; lastRefresh?: string }
  | { kind: 'expired'; reason?: string }
  | { kind: 'unknown' };

export const CodexAuthPreflightField = (
  props: FieldExtensionComponentProps<string>,
) => {
  const discovery = useApi(discoveryApiRef);
  // Use fetchApi (not raw fetch) so Backstage's proxy plugin sees
  // the user's identity token — otherwise it returns 401.
  const fetchApi = useApi(fetchApiRef);
  const [status, setStatus] = React.useState<Status>({ kind: 'loading' });
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const fetchStatus = React.useCallback(async () => {
    try {
      const base = await discovery.getBaseUrl('proxy');
      const resp = await fetchApi.fetch(`${base}/agent-office/codex-auth/status`);
      if (!resp.ok) {
        setStatus({ kind: 'unknown' });
        return;
      }
      const body = (await resp.json()) as {
        ok: boolean;
        lastRefresh?: string;
        reason?: string;
      };
      if (body.ok) {
        setStatus({ kind: 'ok', lastRefresh: body.lastRefresh });
        props.onChange('ok');
      } else {
        setStatus({ kind: 'expired', reason: body.reason });
        props.onChange(undefined as any);
      }
    } catch {
      // Operator status endpoint not reachable — fail OPEN: assume
      // ok so the form remains submittable. B-3 (operator
      // CodexAuthOK condition) will make this strict.
      setStatus({ kind: 'unknown' });
      props.onChange('ok');
    }
  }, [discovery, fetchApi, props]);

  React.useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  return (
    <Paper variant="outlined" style={{ padding: 16, marginBottom: 16 }}>
      <Typography variant="subtitle2" gutterBottom>
        Codex subscription pre-flight
      </Typography>
      {renderBody(status, () => setDialogOpen(true))}
      <CodexReauthDialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
          void fetchStatus(); // refresh after re-auth
        }}
      />
    </Paper>
  );
};

function renderBody(status: Status, openDialog: () => void) {
  switch (status.kind) {
    case 'loading':
      return (
        <Box display="flex" alignItems="center" gridGap={8}>
          <CircularProgress size={16} />
          <Typography variant="body2">Checking Codex token freshness…</Typography>
        </Box>
      );
    case 'ok':
      return (
        <Box display="flex" alignItems="center" gridGap={8}>
          <CheckCircleIcon style={{ color: 'green' }} />
          <Typography variant="body2">
            Codex token is fresh
            {status.lastRefresh
              ? ` (refreshed ${new Date(status.lastRefresh).toLocaleString()})`
              : ''}
            . You can submit the form.
          </Typography>
        </Box>
      );
    case 'expired':
      return (
        <Box>
          <Box display="flex" alignItems="center" gridGap={8} mb={1}>
            <ErrorIcon style={{ color: 'red' }} />
            <Typography variant="body2">
              Codex token is expired
              {status.reason ? ` — ${status.reason}` : ''}. The agent
              this template creates won't work until you re-authenticate.
            </Typography>
          </Box>
          <Button color="secondary" variant="contained" onClick={openDialog}>
            Re-authenticate now
          </Button>
        </Box>
      );
    case 'unknown':
      return (
        <Box display="flex" alignItems="center" gridGap={8}>
          <Chip label="Unknown" variant="outlined" size="small" />
          <Typography variant="body2" color="textSecondary">
            Operator hasn't reported Codex token status yet. Continuing
            optimistically — re-auth via the agent's overview tab if
            things go wrong.
          </Typography>
        </Box>
      );
  }
}
