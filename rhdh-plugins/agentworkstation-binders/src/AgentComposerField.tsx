/*
 * <AgentComposerField> — scaffolder field extension (v0.0.9).
 *
 * v0.0.9 is the "less is more" redesign: the three per-kind tabs
 * (Knowledge Bases / Skills / Tools) are gone. There is ONE search box
 * over ONE catalog — the operator's /catalog/packs index (>= v1.7.11),
 * which serves every composable thing as a typed pack: skills (with
 * live-enriched dependencies), tools (with the exact mcpServers entry
 * that consumes them, sourced from the registration's client-recipe
 * annotation in gitops), and knowledge bases. Type to filter, click to
 * add, and the composition below is everything the agent gets.
 *
 * What clicking adds:
 *   tool  → the pack's recipe, verbatim, into mcpServers (the old
 *           hardcoded GitHub preset is now just a catalog row).
 *   kb    → a knowledgeBaseRefs entry (role editable in the
 *           composition list).
 *   skill → skills are not bound per-agent (runtime discovery), so
 *           picking one adds its DECLARED PREREQUISITES — the deps the
 *           catalog says it needs and the cluster has. A skill whose
 *           prerequisite is not deployed says so honestly.
 *
 * The written form value is unchanged from v0.0.7 — the skeleton
 * consumes the same shape:
 *
 *   { knowledgeBaseRefs: [{name, role}],
 *     mcpServers: [{name, url, type, authHeaderValue?, envFromSecret?}] }
 *
 * A collapsed "custom MCP server" escape hatch remains for servers the
 * catalog doesn't know.
 */
import React from 'react';
import {
  Box,
  Button,
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
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@material-ui/core';
import DeleteIcon from '@material-ui/icons/Delete';
import SearchIcon from '@material-ui/icons/Search';
import { FieldExtensionComponentProps } from '@backstage/plugin-scaffolder-react';
import {
  useCatalogClient,
  CatalogPack,
  CatalogSkillDependency,
} from './strategies/useCatalogClient';

// ---- value shape (what the skeleton consumes — UNCHANGED) -----------

interface KbRef {
  name: string;
  role: string;
}
interface McpServerVal {
  name: string;
  url: string;
  type: string;
  authHeaderValue?: string;
  envFromSecret?: string;
}
export interface ComposerValue {
  knowledgeBaseRefs: KbRef[];
  mcpServers: McpServerVal[];
}

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

const EMPTY: ComposerValue = { knowledgeBaseRefs: [], mcpServers: [] };

const typeChipStyle: Record<string, React.CSSProperties> = {
  skill: { backgroundColor: '#e8eefc' },
  tool: { backgroundColor: '#fdf1e2' },
  kb: { backgroundColor: '#e6f4ea' },
};

export const AgentComposerField = (
  props: FieldExtensionComponentProps<ComposerValue>,
) => {
  const { onChange, formData } = props;
  const catalog = useCatalogClient();

  const value: ComposerValue = {
    knowledgeBaseRefs: formData?.knowledgeBaseRefs ?? [],
    mcpServers: formData?.mcpServers ?? [],
  };

  const [packs, setPacks] = React.useState<CatalogPack[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | undefined>();
  const [query, setQuery] = React.useState('');
  const [showCustom, setShowCustom] = React.useState(false);
  const [installing, setInstalling] = React.useState<string | undefined>();
  const [installErr, setInstallErr] = React.useState<string | undefined>();

  // Install a federated registry artifact onto the cluster, then reload
  // the catalog so it comes back as a local, installed pack.
  const installPack = async (p: CatalogPack) => {
    setInstalling(p.name);
    setInstallErr(undefined);
    try {
      await catalog.install(p.name);
      const res = await catalog.listPacks();
      setPacks(res.items ?? []);
    } catch (e) {
      setInstallErr((e as Error).message);
    } finally {
      setInstalling(undefined);
    }
  };

  // custom MCP escape hatch
  const [cName, setCName] = React.useState('');
  const [cUrl, setCUrl] = React.useState('');
  const [cSecret, setCSecret] = React.useState('');

  React.useEffect(() => {
    if (!formData) onChange(EMPTY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One fetch of the whole catalog; filtering is client-side as you
  // type — same model as the registry site's search input.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const res = await catalog.listPacks();
        if (!cancelled) {
          setPacks(res.items ?? []);
          setError(undefined);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [catalog]);

  // ---- membership --------------------------------------------------
  const kbAttached = (name: string) =>
    value.knowledgeBaseRefs.some(r => r.name === name);
  const toolAttached = (p: CatalogPack) =>
    value.mcpServers.some(
      m => m.name === p.name || (p.recipe && m.url === p.recipe.url),
    );

  const depFulfilled = (d: CatalogSkillDependency) =>
    d.kind === 'mcpServer'
      ? value.mcpServers.some(m => d.gatewayUrl && m.url === d.gatewayUrl)
      : value.knowledgeBaseRefs.some(r => r.name === d.name);

  // skill status: everything it needs is met / addable / blocked
  const skillStatus = (p: CatalogPack): 'ready' | 'addable' | 'blocked' => {
    const deps = p.dependencies ?? [];
    if (deps.length === 0) return 'ready';
    if (deps.every(depFulfilled)) return 'ready';
    if (deps.some(d => !d.available && !depFulfilled(d) && !d.optional)) {
      return 'blocked';
    }
    return 'addable';
  };

  // ---- add/remove --------------------------------------------------
  const addPack = (p: CatalogPack) => {
    if (p.type === 'kb') {
      if (kbAttached(p.name)) return;
      onChange({
        ...value,
        knowledgeBaseRefs: [
          ...value.knowledgeBaseRefs,
          { name: p.name, role: 'knowledge-pool' },
        ],
      });
      return;
    }
    if (p.type === 'tool') {
      if (toolAttached(p) || !p.recipe) return;
      const entry: McpServerVal = {
        name: p.name,
        url: p.recipe.url,
        type: p.recipe.type || 'http',
      };
      if (p.recipe.authHeaderValue) entry.authHeaderValue = p.recipe.authHeaderValue;
      if (p.recipe.envFromSecret) entry.envFromSecret = p.recipe.envFromSecret;
      onChange({ ...value, mcpServers: [...value.mcpServers, entry] });
      return;
    }
    // skill: add its unmet, available prerequisites in one shot.
    const next: ComposerValue = {
      knowledgeBaseRefs: [...value.knowledgeBaseRefs],
      mcpServers: [...value.mcpServers],
    };
    for (const d of p.dependencies ?? []) {
      if (depFulfilled(d) || !d.available) continue;
      if (d.kind === 'mcpServer' && d.gatewayUrl) {
        if (!next.mcpServers.some(m => m.url === d.gatewayUrl)) {
          next.mcpServers.push({ name: d.name, url: d.gatewayUrl, type: 'http' });
        }
      } else if (d.kind === 'knowledgeBase') {
        if (!next.knowledgeBaseRefs.some(r => r.name === d.name)) {
          next.knowledgeBaseRefs.push({ name: d.name, role: 'knowledge-pool' });
        }
      }
    }
    onChange(next);
  };

  const removeKb = (name: string) =>
    onChange({
      ...value,
      knowledgeBaseRefs: value.knowledgeBaseRefs.filter(r => r.name !== name),
    });
  const removeServer = (name: string) =>
    onChange({
      ...value,
      mcpServers: value.mcpServers.filter(s => s.name !== name),
    });
  const setKbRole = (name: string, role: string) =>
    onChange({
      ...value,
      knowledgeBaseRefs: value.knowledgeBaseRefs.map(r =>
        r.name === name ? { ...r, role } : r,
      ),
    });

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

  // ---- search ------------------------------------------------------
  const q = query.trim().toLowerCase();
  const visible = packs.filter(p => {
    if (!q) return true;
    return (p.name + ' ' + (p.displayName ?? '') + ' ' + (p.description ?? ''))
      .toLowerCase()
      .includes(q);
  });

  const selectedCount =
    value.knowledgeBaseRefs.length + value.mcpServers.length;

  return (
    <Paper variant="outlined">
      <Box p={2}>
        <Typography variant="h6">Compose this agent</Typography>
        <Typography variant="body2" color="textSecondary" gutterBottom>
          Search the catalog and pick what the agent needs — skills bring
          their prerequisites with them. Skills themselves are discovered at
          runtime by every agent; tools and knowledge bases you pick here
          become the agent's <code>spec</code>.
        </Typography>

        <TextField
          fullWidth
          variant="outlined"
          size="small"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search skills, tools, knowledge bases…"
          InputProps={{ startAdornment: <SearchIcon color="disabled" /> }}
        />

        {loading && (
          <Box display="flex" justifyContent="center" my={3}>
            <CircularProgress size={24} />
          </Box>
        )}
        {error && (
          <Typography color="error" variant="body2">
            Couldn't load the catalog: {error}
          </Typography>
        )}
        {installErr && (
          <Typography color="error" variant="body2">
            Install failed: {installErr}
          </Typography>
        )}

        {!loading && !error && (
          <TableContainer style={{ maxHeight: 320, marginTop: 8 }}>
            <Table size="small" stickyHeader>
              <TableBody>
                {visible.map(p => {
                  const attached =
                    p.type === 'kb'
                      ? kbAttached(p.name)
                      : p.type === 'tool'
                        ? toolAttached(p)
                        : skillStatus(p) === 'ready';
                  const blocked = p.type === 'skill' && skillStatus(p) === 'blocked';
                  return (
                    <TableRow key={`${p.type}:${p.name}`} hover>
                      <TableCell style={{ width: 70 }}>
                        <Chip
                          size="small"
                          label={p.type}
                          style={typeChipStyle[p.type]}
                        />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          <strong>{p.displayName || p.name}</strong>
                          {p.version ? ` · v${p.version}` : ''}
                          {p.installed === false && (
                            <Chip
                              size="small"
                              variant="outlined"
                              label={p.registry ?? 'registry'}
                              style={{ marginLeft: 8, height: 18 }}
                            />
                          )}
                        </Typography>
                        <Typography
                          variant="caption"
                          color="textSecondary"
                          style={{
                            display: 'block',
                            maxWidth: 520,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {p.description}
                        </Typography>
                        {p.type === 'skill' &&
                          (p.dependencies ?? []).map(d => (
                            <Chip
                              key={d.name}
                              size="small"
                              variant="outlined"
                              label={`needs ${d.name}${d.available || depFulfilled(d) ? '' : ' (not deployed)'}`}
                              style={{ marginRight: 4, marginTop: 2 }}
                            />
                          ))}
                      </TableCell>
                      <TableCell align="right" style={{ width: 130 }}>
                        {p.installed === false ? (
                          <Tooltip
                            arrow
                            title={`Published to ${p.registry ?? 'a registry'} but not installed on this cluster. Install creates the Skill so agents can discover it.`}
                          >
                            <span>
                              <Button
                                size="small"
                                color="primary"
                                variant="outlined"
                                disabled={!!installing}
                                onClick={() => installPack(p)}
                              >
                                {installing === p.name ? 'Installing…' : 'Install'}
                              </Button>
                            </span>
                          </Tooltip>
                        ) : attached ? (
                          <Chip size="small" label="✓ added" />
                        ) : blocked ? (
                          <Tooltip
                            arrow
                            title="A required backing service is not deployed on this cluster yet — the skill will light up once it ships."
                          >
                            <Chip size="small" label="unavailable" disabled />
                          </Tooltip>
                        ) : (
                          <Button
                            size="small"
                            color="primary"
                            onClick={() => addPack(p)}
                          >
                            {p.type === 'skill' ? 'Add prereqs' : 'Add'}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {visible.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3}>
                      <Typography variant="caption" color="textSecondary">
                        Nothing in the catalog matches “{query}”.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        <Box mt={2}>
          <Divider />
          <Box mt={1.5}>
            <Typography variant="subtitle2">
              Composition ({selectedCount})
            </Typography>
            {selectedCount === 0 && (
              <Typography variant="caption" color="textSecondary">
                Nothing selected yet — the agent still discovers every skill
                at runtime; add tools and knowledge bases above as its
                skills require them.
              </Typography>
            )}
            <Table size="small">
              <TableBody>
                {value.mcpServers.map(s => (
                  <TableRow key={`mcp:${s.name}`}>
                    <TableCell style={{ width: 70 }}>
                      <Chip size="small" label="tool" style={typeChipStyle.tool} />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{s.name}</Typography>
                      <Typography variant="caption" color="textSecondary">
                        {s.url}
                      </Typography>
                    </TableCell>
                    <TableCell align="right" style={{ width: 60 }}>
                      <IconButton size="small" onClick={() => removeServer(s.name)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
                {value.knowledgeBaseRefs.map(r => (
                  <TableRow key={`kb:${r.name}`}>
                    <TableCell style={{ width: 70 }}>
                      <Chip size="small" label="kb" style={typeChipStyle.kb} />
                    </TableCell>
                    <TableCell>
                      <Box display="flex" alignItems="center" gridGap={12}>
                        <Typography variant="body2">{r.name}</Typography>
                        <TextField
                          select
                          size="small"
                          value={r.role}
                          onChange={e => setKbRole(r.name, e.target.value)}
                        >
                          {roleOptions.map(o => (
                            <MenuItem key={o.value} value={o.value}>
                              {o.label}
                            </MenuItem>
                          ))}
                        </TextField>
                      </Box>
                    </TableCell>
                    <TableCell align="right" style={{ width: 60 }}>
                      <IconButton size="small" onClick={() => removeKb(r.name)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </Box>

        <Box mt={1}>
          <Button size="small" onClick={() => setShowCustom(!showCustom)}>
            {showCustom ? 'Hide' : 'Add a custom MCP server…'}
          </Button>
          {showCustom && (
            <Box display="flex" gridGap={8} mt={1} alignItems="center">
              <TextField
                size="small"
                label="name"
                value={cName}
                onChange={e => setCName(e.target.value)}
              />
              <TextField
                size="small"
                label="url"
                value={cUrl}
                onChange={e => setCUrl(e.target.value)}
                style={{ minWidth: 260 }}
              />
              <TextField
                size="small"
                label="secret (optional)"
                value={cSecret}
                onChange={e => setCSecret(e.target.value)}
              />
              <Button size="small" variant="outlined" onClick={addCustom}>
                Add
              </Button>
            </Box>
          )}
        </Box>
      </Box>
    </Paper>
  );
};
