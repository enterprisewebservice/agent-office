/*
 * CodexAuthPreflightField — scaffolder field extension that gates
 * a template's submit button on Codex auth being fresh.
 *
 * UX: a banner appears at the top of the form. If Codex auth is
 * live-verified healthy (refresh token proven alive, or access token
 * unexpired with no proof of death — same verdict the backend's
 * /codex-auth/status endpoint computes), the banner is green and the
 * field's value is "ok" (passes required validation). If unhealthy,
 * the banner is red, the value is empty (failing required validation,
 * blocking submit), and a "Re-authenticate now" button opens the
 * CodexReauthDialog. When the dialog completes, the banner re-checks
 * and unlocks the form.
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
 * If the status endpoint is unreachable the field fails OPEN (assumes
 * ok) so an agent-office backend outage never blocks unrelated
 * template submissions.
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
import {
  CodexAuthHealth,
  fetchAuthHealth,
  relativeTime,
  credentialHealthy,
} from './status';

type Status =
  | { kind: 'loading' }
  | { kind: 'ok'; health: CodexAuthHealth }
  | { kind: 'unhealthy'; health: CodexAuthHealth }
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
      const health = await fetchAuthHealth(discovery, fetchApi);
      if (!health) {
        setStatus({ kind: 'unknown' });
        props.onChange('ok');
        return;
      }
      if (health.ok) {
        setStatus({ kind: 'ok', health });
        props.onChange('ok');
      } else {
        setStatus({ kind: 'unhealthy', health });
        props.onChange(undefined as any);
      }
    } catch {
      // Status endpoint not reachable — fail OPEN: assume ok so the
      // form remains submittable.
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

function summarizeOk(health: CodexAuthHealth): string {
  const soonest = (health.credentials ?? [])
    .filter(c => credentialHealthy(c) && c.accessTokenExpiresAt)
    .map(c => c.accessTokenExpiresAt as string)
    .sort()[0];
  const verified = (health.credentials ?? []).some(
    c => c.refreshAlive === true,
  );
  let line = verified
    ? 'Codex refresh token verified alive against OpenAI'
    : 'Codex token is fresh';
  if (soonest) line += ` (access token expires ${relativeTime(soonest)})`;
  return line;
}

function renderBody(status: Status, openDialog: () => void) {
  switch (status.kind) {
    case 'loading':
      return (
        <Box display="flex" alignItems="center" gridGap={8}>
          <CircularProgress size={16} />
          <Typography variant="body2">
            Verifying Codex tokens against OpenAI…
          </Typography>
        </Box>
      );
    case 'ok':
      return (
        <Box display="flex" alignItems="center" gridGap={8}>
          <CheckCircleIcon style={{ color: 'green' }} />
          <Typography variant="body2">
            {summarizeOk(status.health)}. You can submit the form.
          </Typography>
        </Box>
      );
    case 'unhealthy':
      return (
        <Box>
          <Box display="flex" alignItems="center" gridGap={8} mb={1}>
            <ErrorIcon style={{ color: 'red' }} />
            <Typography variant="body2">
              Codex auth is unhealthy
              {status.health.reason ? ` — ${status.health.reason}` : ''}. The
              agent this template creates won't work until you
              re-authenticate.
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
            Codex auth status endpoint unreachable. Continuing
            optimistically — re-auth via the agent's overview tab if
            things go wrong.
          </Typography>
        </Box>
      );
  }
}
