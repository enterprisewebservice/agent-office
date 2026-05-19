/*
 * CodexAuthCard — entity-page overview card.
 *
 * Renders on AgentWorkstation entity pages whose Codex agent uses
 * the chatgpt provider. Shows a status pill (OK / Expired) driven
 * by the `agentoffice.ai/codex-auth-ok` annotation that the
 * operator emits via the BackstageCatalogHandler (step B-3, ships
 * separately). Clicking the pill opens the CodexReauthDialog.
 *
 * If the annotation is missing, the card falls back to "Unknown"
 * — still clickable so the user can run a re-auth proactively.
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
} from '@material-ui/core';
import VpnKeyIcon from '@material-ui/icons/VpnKey';
import { useEntity } from '@backstage/plugin-catalog-react';
import { CodexReauthDialog } from './CodexReauthDialog';

const ANNOTATION_CODEX_AUTH_OK = 'agentoffice.ai/codex-auth-ok';
const ANNOTATION_CODEX_LAST_REFRESH = 'agentoffice.ai/codex-last-refresh';

type AuthState = 'ok' | 'expired' | 'unknown';

export const CodexAuthCard = () => {
  const { entity } = useEntity();
  const [dialogOpen, setDialogOpen] = React.useState(false);

  // Only show on entities that opted in. Specifically AgentWorkstation
  // resources whose model provider is openai-codex — surfaced as the
  // annotation `agentoffice.ai/model-provider`. If we can't tell, we
  // still render (better noisy than missing).
  const annotations = entity.metadata.annotations ?? {};
  const okRaw = annotations[ANNOTATION_CODEX_AUTH_OK];
  const lastRefresh = annotations[ANNOTATION_CODEX_LAST_REFRESH];

  let state: AuthState = 'unknown';
  if (okRaw === 'true') state = 'ok';
  else if (okRaw === 'false') state = 'expired';

  const pillProps =
    state === 'ok'
      ? { label: 'OK', color: 'primary' as const }
      : state === 'expired'
        ? { label: 'Expired', color: 'secondary' as const }
        : { label: 'Unknown', variant: 'outlined' as const };

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
          {state === 'expired'
            ? 'The cluster-wide Codex OAuth token has expired. Click below to re-authenticate. ' +
              'The new token will propagate to every Codex agent within ~2 minutes.'
            : state === 'ok'
              ? 'Token is fresh. Use the button below if you need to force-rotate (e.g., after a ChatGPT logout).'
              : 'Token status not yet reported by the operator. You can still re-authenticate proactively.'}
        </Typography>
        <Button
          variant="contained"
          color={state === 'expired' ? 'secondary' : 'default'}
          onClick={() => setDialogOpen(true)}
        >
          {state === 'expired' ? 'Re-authenticate now' : 'Re-authenticate'}
        </Button>
      </CardContent>
      <CodexReauthDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
      />
    </Card>
  );
};
