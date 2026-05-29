/*
 * <McpServersPanel>
 *
 * The Tools/MCP tab. Edits spec.tools.mcpServers on the
 * AgentWorkstation — which MCP servers the agent can call through
 * the Kuadrant MCP Gateway.
 *
 * The headline use case: give an agent access to GitHub (Issues,
 * Projects v2, PRs) by adding the github MCP server. The "Add GitHub
 * MCP" preset fills in the exact block the operator expects — URL =
 * the in-cluster gateway, auth = a Bearer header that resolves to the
 * ESO-rotated GitHub App installation token (github-mcp-installation-
 * token), so the agent never holds a durable credential and all its
 * GitHub actions are attributed to the shared App identity. Adding a
 * custom MCP server (Slack, Jira, internal APIs) follows the same
 * shape.
 *
 * Save composes the updated AW YAML (preserving everything else) and
 * opens a PR via the agentworkstation-binder-save scaffolder template,
 * the same path the Identity + KB tabs use. PR merge → ArgoCD sync →
 * operator wires the MCP server into the agent's openclaw runtime +
 * mounts the named Secret into the gateway pod's envFrom.
 *
 * Future enhancement: list the MCPServerRegistrations the gateway
 * already federates (via a new operator endpoint) as one-click
 * presets, instead of just the GitHub preset + custom form.
 */
import React, { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@material-ui/core';
import DeleteIcon from '@material-ui/icons/Delete';
import GitHubIcon from '@material-ui/icons/GitHub';
import AddIcon from '@material-ui/icons/Add';
import yaml from 'js-yaml';
import { useProxiedK8s } from './strategies/useProxiedK8s';
import { useScaffolderPR } from './strategies/useScaffolderPR';

interface McpServer {
  name: string;
  url: string;
  type?: string;
  headers?: Record<string, string>;
  envFromSecret?: string;
}

interface AwDoc {
  apiVersion?: string;
  kind?: string;
  metadata?: {
    name?: string;
    namespace?: string;
    annotations?: Record<string, string>;
    labels?: Record<string, string>;
  };
  spec: {
    tools?: { allow?: string[]; mcpServers?: McpServer[] };
    [k: string]: unknown;
  };
}

interface GitopsSource {
  repoUrl: string;
  filePath: string;
  defaultBranch: string;
}

interface Props {
  awName: string;
  awNamespace: string;
}

// The canonical GitHub MCP block — matches what the operator wires
// and what pm-agent already uses. URL is namespace-templated.
const githubPreset = (ns: string): McpServer => ({
  name: 'github',
  url: `http://mcp-gateway-data-science-gateway-class.${ns}.svc.cluster.local/mcp`,
  type: 'http',
  headers: { Authorization: 'Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}' },
  envFromSecret: 'github-mcp-installation-token',
});

export const McpServersPanel: React.FC<Props> = ({ awName, awNamespace }) => {
  const { get } = useProxiedK8s();
  const openPR = useScaffolderPR();

  const [aw, setAw] = useState<AwDoc | null>(null);
  const [gitops, setGitops] = useState<GitopsSource | null>(null);
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);

  // custom-add form
  const [cName, setCName] = useState('');
  const [cUrl, setCUrl] = useState('');
  const [cSecret, setCSecret] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const [awDoc, src] = await Promise.all([
          get<AwDoc>(`/namespaces/${awNamespace}/agentworkstations/${awName}`),
          get<GitopsSource>(
            `/namespaces/${awNamespace}/agentworkstations/${awName}/gitops-source`,
          ),
        ]);
        if (cancelled) return;
        setAw(awDoc);
        setGitops(src);
        setServers(awDoc.spec.tools?.mcpServers ?? []);
        setLoadError(undefined);
      } catch (err) {
        if (!cancelled) {
          setLoadError(
            (err as Error).message +
              ' — most commonly: this entity has no matching AgentWorkstation CR. ' +
              'Set the agentoffice.ai/agentworkstation-name annotation on the entity.',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [awName, awNamespace, get]);

  const hasGithub = servers.some(s => s.name === 'github');

  const addGithub = () => {
    if (hasGithub) return;
    setServers([...servers, githubPreset(awNamespace)]);
    setSaved(false);
  };

  const addCustom = () => {
    if (!cName || !cUrl) return;
    const s: McpServer = { name: cName, url: cUrl, type: 'http' };
    if (cSecret) {
      s.envFromSecret = cSecret;
      s.headers = { Authorization: 'Bearer ${MCP_TOKEN}' };
    }
    setServers([...servers, s]);
    setCName('');
    setCUrl('');
    setCSecret('');
    setSaved(false);
  };

  const removeServer = (name: string) => {
    setServers(servers.filter(s => s.name !== name));
    setSaved(false);
  };

  const onSave = async () => {
    if (!aw || !gitops) return;
    setSaving(true);
    setSaveError(undefined);
    setSaved(false);
    try {
      const updatedSpec = {
        ...aw.spec,
        tools: {
          ...(aw.spec.tools ?? {}),
          mcpServers: servers.length > 0 ? servers : undefined,
        },
      };
      const newContent = yaml.dump({
        apiVersion: aw.apiVersion ?? 'agentoffice.ai/v1alpha1',
        kind: aw.kind ?? 'AgentWorkstation',
        metadata: {
          name: awName,
          namespace: awNamespace,
          ...(aw.metadata?.annotations
            ? { annotations: aw.metadata.annotations }
            : {}),
          ...(aw.metadata?.labels ? { labels: aw.metadata.labels } : {}),
        },
        spec: updatedSpec,
      });
      await openPR({
        awName,
        awNamespace,
        bindingType: 'mcp',
        targetPath: gitops.filePath,
        newContent,
        branchName: `aw-binder/${awName}-mcp-${Date.now()}`,
        title: `${awName}: update MCP servers (${servers.length})`,
        body: [
          `Updates \`spec.tools.mcpServers\` on AgentWorkstation \`${awName}\`.`,
          '',
          '## MCP servers after this change',
          ...(servers.length
            ? servers.map(s => `- \`${s.name}\` → ${s.url}`)
            : ['- (none)']),
          '',
          'Generated by the agentworkstation-binders plugin (Tools/MCP tab). ' +
            'On merge the operator wires each MCP server into the agent and ' +
            'mounts any envFromSecret into the gateway pod.',
        ].join('\n'),
      });
      setSaved(true);
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" my={3}>
        <CircularProgress size={28} />
      </Box>
    );
  }
  if (loadError) {
    return (
      <Box my={2}>
        <Typography color="error" variant="body2">
          {loadError}
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Box mb={2}>
        <Typography variant="body2" color="textSecondary">
          MCP servers this agent can call through the Kuadrant MCP Gateway.
          Adding the GitHub MCP gives the agent Issues / Projects v2 / PR
          tools — auth is the ESO-rotated GitHub App installation token, so
          the agent never holds a durable credential and every action is
          attributed to the shared App identity. Save opens a PR; on merge
          the operator wires the server into the agent's runtime.
        </Typography>
      </Box>

      {/* current servers */}
      {servers.length > 0 ? (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>URL</TableCell>
                <TableCell>Auth secret</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {servers.map(s => (
                <TableRow key={s.name}>
                  <TableCell>
                    <strong>{s.name}</strong>
                    {s.name === 'github' && (
                      <Chip
                        size="small"
                        label="GitHub"
                        icon={<GitHubIcon />}
                        style={{ marginLeft: 8 }}
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" style={{ fontFamily: 'monospace' }}>
                      {s.url}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption">
                      {s.envFromSecret ?? '—'}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="Remove">
                      <IconButton size="small" onClick={() => removeServer(s.name)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      ) : (
        <Typography variant="body2" color="textSecondary">
          No MCP servers attached. Add the GitHub MCP below, or a custom one.
        </Typography>
      )}

      {/* presets + custom add */}
      <Box mt={2} mb={2} display="flex" gridGap={12} alignItems="center">
        <Button
          variant="outlined"
          size="small"
          startIcon={<GitHubIcon />}
          disabled={hasGithub}
          onClick={addGithub}
        >
          {hasGithub ? 'GitHub MCP added' : 'Add GitHub MCP'}
        </Button>
      </Box>

      <Divider />

      <Box mt={2}>
        <Typography variant="subtitle2" gutterBottom>
          Add a custom MCP server
        </Typography>
        <Box display="flex" gridGap={12} flexWrap="wrap" alignItems="center">
          <TextField
            label="Name"
            size="small"
            variant="outlined"
            value={cName}
            onChange={e => setCName(e.target.value)}
            style={{ width: 140 }}
          />
          <TextField
            label="URL (gateway /mcp endpoint)"
            size="small"
            variant="outlined"
            value={cUrl}
            onChange={e => setCUrl(e.target.value)}
            style={{ width: 360 }}
          />
          <TextField
            label="Auth Secret (optional)"
            size="small"
            variant="outlined"
            value={cSecret}
            onChange={e => setCSecret(e.target.value)}
            style={{ width: 200 }}
            helperText="envFromSecret name"
          />
          <Button
            variant="outlined"
            size="small"
            startIcon={<AddIcon />}
            disabled={!cName || !cUrl}
            onClick={addCustom}
          >
            Add
          </Button>
        </Box>
      </Box>

      <Box mt={3} display="flex" alignItems="center" gridGap={16}>
        <Button
          variant="contained"
          color="primary"
          disabled={saving}
          onClick={onSave}
        >
          {saving ? 'Opening PR…' : 'Save (opens PR)'}
        </Button>
        {saved && !saving && (
          <Typography variant="caption" style={{ color: 'green' }}>
            ✓ PR opened against the gitops repo.
          </Typography>
        )}
        {saveError && (
          <Typography variant="caption" color="error">
            {saveError}
          </Typography>
        )}
      </Box>
    </Box>
  );
};
