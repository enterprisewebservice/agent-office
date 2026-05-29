/*
 * <AgentComposerField> — scaffolder field extension (v0.0.7).
 *
 * This is the SAME binder experience as the entity-page
 * AgentBindingsCard, but living INSIDE the create wizard so you
 * compose an agent at creation time instead of typing names into a
 * bare string field and discovering the card afterwards.
 *
 * It does NOT touch the entity card. The card mounts via the
 * plugin's `mountPoints` entry (entity.page.overview/cards); this
 * field mounts via the plugin's `scaffolderFieldExtensions` entry.
 * Both are registered side-by-side in dynamic-plugins config, the
 * same way codex-reauth-ui ships CodexAuthCard + CodexAuthPreflight.
 *
 * Used by a template as:
 *
 *   parameters:
 *     - title: Compose the agent
 *       properties:
 *         compose:
 *           type: object
 *           ui:field: AgentComposer
 *
 * The value written into the form is a structured object the
 * skeleton consumes directly:
 *
 *   {
 *     knowledgeBaseRefs: [{ name, role }],
 *     mcpServers: [{ name, url, type, authHeaderValue?, envFromSecret? }]
 *   }
 *
 * Three sections, mirroring the card's tabs:
 *
 *   - Knowledge Bases  → live pick-list of KnowledgeBase CRs in the
 *                        target namespace (no typing). Each pick gets
 *                        a role dropdown. Writes knowledgeBaseRefs.
 *   - Skills           → READ-ONLY preview of the runtime discovery
 *                        catalog. Skills are NOT bound per-agent
 *                        (v1.6.0 discovery model: every agent sees the
 *                        whole catalog and picks at runtime via
 *                        progressive disclosure). Shown here purely so
 *                        the creator can see what the agent will have.
 *   - Tools / MCP      → GitHub MCP preset toggle + custom add. Writes
 *                        mcpServers.
 *
 * Data is read through the same proxies the card uses:
 *   - useProxiedK8s   → /agent-office-binders/namespaces/<ns>/knowledgebases
 *   - useCatalogClient → /agent-office-catalog/skills
 * Both work fine pre-creation: they only read cluster catalog state,
 * which exists independently of the agent being created.
 *
 * The target namespace is read from the sibling `namespace` form
 * field (formContext.formData.namespace), defaulting to agent-office.
 */
import React from 'react';
import {
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@material-ui/core';
import DeleteIcon from '@material-ui/icons/Delete';
import GitHubIcon from '@material-ui/icons/GitHub';
import AddIcon from '@material-ui/icons/Add';
import MenuBookIcon from '@material-ui/icons/MenuBook';
import { FieldExtensionComponentProps } from '@backstage/plugin-scaffolder-react';
import { useProxiedK8s } from './strategies/useProxiedK8s';
import { useCatalogClient, CatalogSkillEntry } from './strategies/useCatalogClient';

// ---- value shape (what the skeleton consumes) -----------------------

interface KbRef {
  name: string;
  role: string;
}
interface McpServerVal {
  name: string;
  url: string;
  type: string;
  // The literal Authorization header value, e.g.
  // "Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}". Kept as a single
  // string so the skeleton emits one clean header line without
  // Nunjucks dict iteration.
  authHeaderValue?: string;
  envFromSecret?: string;
}
export interface ComposerValue {
  knowledgeBaseRefs: KbRef[];
  mcpServers: McpServerVal[];
}

// KB role options — same vocabulary as the entity card's KB tab.
const roleOptions = [
  { value: 'planning-reference', label: 'planning-reference (read at start)' },
  { value: 'knowledge-pool', label: 'knowledge-pool (search on-demand)' },
  {
    value: 'experiment-history',
    label: 'experiment-history (read when related CR is in scope)',
  },
  { value: 'runbook', label: 'runbook (read on operational trigger)' },
  { value: 'style-guide', label: 'style-guide (read when producing output)' },
];

// Canonical GitHub MCP block — matches the operator's wiring and what
// pm-agent already uses. URL is namespace-templated.
const githubPreset = (ns: string): McpServerVal => ({
  name: 'github',
  url: `http://mcp-gateway-data-science-gateway-class.${ns}.svc.cluster.local/mcp`,
  type: 'http',
  authHeaderValue: 'Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}',
  envFromSecret: 'github-mcp-installation-token',
});

interface KbList {
  items: Array<{
    name: string;
    displayName?: string;
    description?: string;
    gatewayRef?: string;
  }>;
}

const EMPTY: ComposerValue = { knowledgeBaseRefs: [], mcpServers: [] };

export const AgentComposerField = (
  props: FieldExtensionComponentProps<ComposerValue>,
) => {
  const { onChange, formData, formContext } = props;
  const { get } = useProxiedK8s();
  const catalog = useCatalogClient();

  // Target namespace comes from the sibling form field. The Deployment
  // page's `namespace` defaults to agent-office; read it live so the
  // KB list + GitHub MCP URL track whatever the user picked.
  const namespace: string =
    (formContext?.formData as any)?.namespace || 'agent-office';

  // Local mirror of the form value. Initialize from formData so the
  // selections survive navigating away and back within the wizard.
  const value: ComposerValue = {
    knowledgeBaseRefs: formData?.knowledgeBaseRefs ?? [],
    mcpServers: formData?.mcpServers ?? [],
  };

  const [tab, setTab] = React.useState<'kb' | 'skill' | 'mcp'>('kb');

  const [kbs, setKbs] = React.useState<KbList['items']>([]);
  const [kbLoading, setKbLoading] = React.useState(true);
  const [kbError, setKbError] = React.useState<string | undefined>();

  const [skills, setSkills] = React.useState<CatalogSkillEntry[]>([]);
  const [skillLoading, setSkillLoading] = React.useState(true);
  const [skillError, setSkillError] = React.useState<string | undefined>();

  // custom MCP add form
  const [cName, setCName] = React.useState('');
  const [cUrl, setCUrl] = React.useState('');
  const [cSecret, setCSecret] = React.useState('');

  // Ensure the field has a defined object value from the start so
  // downstream `${{ parameters.compose.* }}` never hits undefined.
  React.useEffect(() => {
    if (!formData) onChange(EMPTY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load available KnowledgeBases for the target namespace.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setKbLoading(true);
        const list = await get<KbList>(`/namespaces/${namespace}/knowledgebases`);
        if (!cancelled) {
          setKbs(list.items ?? []);
          setKbError(undefined);
        }
      } catch (err) {
        if (!cancelled) setKbError((err as Error).message);
      } finally {
        if (!cancelled) setKbLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [namespace, get]);

  // Load the runtime skill catalog (read-only preview).
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setSkillLoading(true);
        const res = await catalog.listSkills();
        if (!cancelled) {
          setSkills(res.items ?? []);
          setSkillError(undefined);
        }
      } catch (err) {
        if (!cancelled) setSkillError((err as Error).message);
      } finally {
        if (!cancelled) setSkillLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [catalog]);

  // ---- KB handlers --------------------------------------------------
  const isKbAttached = (name: string) =>
    value.knowledgeBaseRefs.some(r => r.name === name);

  const toggleKb = (name: string) => {
    const next = isKbAttached(name)
      ? value.knowledgeBaseRefs.filter(r => r.name !== name)
      : [...value.knowledgeBaseRefs, { name, role: 'knowledge-pool' }];
    onChange({ ...value, knowledgeBaseRefs: next });
  };

  const setKbRole = (name: string, role: string) => {
    onChange({
      ...value,
      knowledgeBaseRefs: value.knowledgeBaseRefs.map(r =>
        r.name === name ? { ...r, role } : r,
      ),
    });
  };

  // ---- MCP handlers -------------------------------------------------
  const hasGithub = value.mcpServers.some(s => s.name === 'github');

  const addGithub = () => {
    if (hasGithub) return;
    onChange({ ...value, mcpServers: [...value.mcpServers, githubPreset(namespace)] });
  };
  const addCustom = () => {
    if (!cName || !cUrl) return;
    const s: McpServerVal = { name: cName, url: cUrl, type: 'http' };
    if (cSecret) {
      s.envFromSecret = cSecret;
      s.authHeaderValue = 'Bearer ${MCP_TOKEN}';
    }
    onChange({ ...value, mcpServers: [...value.mcpServers, s] });
    setCName('');
    setCUrl('');
    setCSecret('');
  };
  const removeServer = (name: string) =>
    onChange({ ...value, mcpServers: value.mcpServers.filter(s => s.name !== name) });

  // ---- render -------------------------------------------------------
  return (
    <Paper variant="outlined" style={{ padding: 16, marginTop: 8 }}>
      <Typography variant="subtitle1" gutterBottom>
        Compose this agent
      </Typography>
      <Typography variant="body2" color="textSecondary" style={{ marginBottom: 8 }}>
        Attach Knowledge Bases, review the skills the agent will discover, and
        wire up tools (MCP) — all from the live cluster catalog. These choices
        become the new agent's <code>spec.knowledgeBaseRefs</code> and
        <code> spec.tools.mcpServers</code>. You can change everything later from
        the agent's page.
      </Typography>

      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        indicatorColor="primary"
        textColor="primary"
      >
        <Tab
          value="kb"
          label={`Knowledge Bases (${value.knowledgeBaseRefs.length})`}
        />
        <Tab value="skill" label="Skills (auto-discovered)" />
        <Tab value="mcp" label={`Tools / MCP (${value.mcpServers.length})`} />
      </Tabs>

      <Box mt={2}>
        {tab === 'kb' && (
          <KbSection
            loading={kbLoading}
            error={kbError}
            kbs={kbs}
            refs={value.knowledgeBaseRefs}
            namespace={namespace}
            isAttached={isKbAttached}
            onToggle={toggleKb}
            onRole={setKbRole}
          />
        )}
        {tab === 'skill' && (
          <SkillSection loading={skillLoading} error={skillError} skills={skills} />
        )}
        {tab === 'mcp' && (
          <McpSection
            servers={value.mcpServers}
            hasGithub={hasGithub}
            onAddGithub={addGithub}
            onRemove={removeServer}
            cName={cName}
            cUrl={cUrl}
            cSecret={cSecret}
            setCName={setCName}
            setCUrl={setCUrl}
            setCSecret={setCSecret}
            onAddCustom={addCustom}
          />
        )}
      </Box>
    </Paper>
  );
};

// ------------------------------------------------------------------ KB
const KbSection: React.FC<{
  loading: boolean;
  error?: string;
  kbs: KbList['items'];
  refs: KbRef[];
  namespace: string;
  isAttached: (n: string) => boolean;
  onToggle: (n: string) => void;
  onRole: (n: string, role: string) => void;
}> = ({ loading, error, kbs, refs, namespace, isAttached, onToggle, onRole }) => {
  if (loading) {
    return (
      <Box display="flex" justifyContent="center" my={3}>
        <CircularProgress size={24} />
      </Box>
    );
  }
  if (error) {
    return (
      <Typography color="error" variant="body2">
        Couldn't list KnowledgeBases in namespace "{namespace}": {error}
      </Typography>
    );
  }
  if (kbs.length === 0) {
    return (
      <Typography variant="body2" color="textSecondary">
        No KnowledgeBases found in namespace "{namespace}". You can create one
        from the KnowledgeBase template, then attach it here or from the agent's
        page later.
      </Typography>
    );
  }
  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell padding="checkbox" />
            <TableCell>Knowledge Base</TableCell>
            <TableCell>Role (when attached)</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {kbs.map(kb => {
            const attached = isAttached(kb.name);
            const role =
              refs.find(r => r.name === kb.name)?.role ?? 'knowledge-pool';
            return (
              <TableRow key={kb.name} hover>
                <TableCell padding="checkbox">
                  <Checkbox
                    checked={attached}
                    onChange={() => onToggle(kb.name)}
                    color="primary"
                  />
                </TableCell>
                <TableCell>
                  <Box display="flex" alignItems="center" gridGap={8}>
                    <MenuBookIcon fontSize="small" color="action" />
                    <Box>
                      <Typography variant="body2">
                        <strong>{kb.displayName ?? kb.name}</strong>
                      </Typography>
                      {kb.description && (
                        <Typography variant="caption" color="textSecondary">
                          {kb.description}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                </TableCell>
                <TableCell>
                  <TextField
                    select
                    size="small"
                    variant="outlined"
                    value={role}
                    disabled={!attached}
                    onChange={e => onRole(kb.name, e.target.value)}
                    style={{ minWidth: 240 }}
                  >
                    {roleOptions.map(o => (
                      <MenuItem key={o.value} value={o.value}>
                        {o.label}
                      </MenuItem>
                    ))}
                  </TextField>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

// -------------------------------------------------------------- Skills
const SkillSection: React.FC<{
  loading: boolean;
  error?: string;
  skills: CatalogSkillEntry[];
}> = ({ loading, error, skills }) => {
  if (loading) {
    return (
      <Box display="flex" justifyContent="center" my={3}>
        <CircularProgress size={24} />
      </Box>
    );
  }
  if (error) {
    return (
      <Typography color="error" variant="body2">
        Couldn't list the skill catalog: {error}
      </Typography>
    );
  }
  return (
    <Box>
      <Typography variant="body2" color="textSecondary" gutterBottom>
        Skills aren't attached per-agent. Every agent automatically discovers
        the full cluster skill catalog and picks what it needs at runtime
        (progressive disclosure). This agent will discover{' '}
        <strong>{skills.length}</strong> skill{skills.length === 1 ? '' : 's'}:
      </Typography>
      <Box display="flex" flexWrap="wrap" gridGap={8} mt={1}>
        {skills.map(s => (
          <Tooltip key={s.name} title={s.description ?? ''} arrow>
            <Chip
              size="small"
              label={s.displayName ?? s.name}
              variant="outlined"
              {...(s.tier ? { color: 'default' } : {})}
            />
          </Tooltip>
        ))}
        {skills.length === 0 && (
          <Typography variant="caption" color="textSecondary">
            No skills in the catalog yet.
          </Typography>
        )}
      </Box>
    </Box>
  );
};

// ----------------------------------------------------------- Tools/MCP
const McpSection: React.FC<{
  servers: McpServerVal[];
  hasGithub: boolean;
  onAddGithub: () => void;
  onRemove: (n: string) => void;
  cName: string;
  cUrl: string;
  cSecret: string;
  setCName: (v: string) => void;
  setCUrl: (v: string) => void;
  setCSecret: (v: string) => void;
  onAddCustom: () => void;
}> = ({
  servers,
  hasGithub,
  onAddGithub,
  onRemove,
  cName,
  cUrl,
  cSecret,
  setCName,
  setCUrl,
  setCSecret,
  onAddCustom,
}) => (
  <Box>
    <Typography variant="body2" color="textSecondary" gutterBottom>
      MCP servers this agent can call through the Kuadrant MCP Gateway. The
      GitHub preset gives it Issues / Projects v2 / PR tools — auth is the
      ESO-rotated GitHub App installation token, so the agent never holds a
      durable credential.
    </Typography>

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
                  <Typography variant="caption">{s.envFromSecret ?? '—'}</Typography>
                </TableCell>
                <TableCell align="right">
                  <Tooltip title="Remove">
                    <IconButton size="small" onClick={() => onRemove(s.name)}>
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

    <Box mt={2} mb={2}>
      <Button
        variant="outlined"
        size="small"
        startIcon={<GitHubIcon />}
        disabled={hasGithub}
        onClick={onAddGithub}
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
          onClick={onAddCustom}
        >
          Add
        </Button>
      </Box>
    </Box>
  </Box>
);
