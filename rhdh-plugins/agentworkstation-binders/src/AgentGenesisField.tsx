/*
 * <AgentGenesisField> — the ONE-STEP agent creator (v0.0.10).
 *
 * The whole wizard collapses into this field. The user:
 *
 *   1. describes the job in plain language,
 *   2. picks the brain — Codex subscription (default) or Claude
 *      (which shows the existing API-key path),
 *   3. hits Create.
 *
 * Everything else comes from POST /catalog/recommend (operator >=
 * v1.7.12): identity (name/displayName/emoji/role/systemPrompt) and
 * the pack selection, which this field expands into concrete compose
 * wiring using the /catalog/packs index — tool packs contribute their
 * gitops-owned recipe verbatim, kb packs a knowledgeBaseRefs entry,
 * and skill packs their available prerequisites. The recommendation is
 * fully editable before Create; it is a draft, not a decision.
 *
 * The field writes ONE object the genesis template consumes as
 * `parameters.genesis.*`:
 *
 *   { description, name, displayName, emoji, role, systemPrompt,
 *     provider, modelName, apiKey,
 *     compose: { knowledgeBaseRefs, mcpServers } }
 *
 * Deployment (namespace/runtime/gateway/owner) is defaulted by the
 * template itself — not asked here.
 */
import React from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  Paper,
  Radio,
  RadioGroup,
  Table,
  TableBody,
  TableCell,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@material-ui/core';
import { FieldExtensionComponentProps } from '@backstage/plugin-scaffolder-react';
import {
  useCatalogClient,
  CatalogPack,
  RecommendResponse,
} from './strategies/useCatalogClient';

interface KbRef {
  name: string;
  role: string;
}
type SelectedPack = CatalogPack & { reason?: string };

interface McpServerVal {
  name: string;
  url: string;
  type: string;
  authHeaderValue?: string;
  envFromSecret?: string;
}
export interface GenesisValue {
  description: string;
  /** What the platform selected, and why. In the form value — NOT
   *  component state — so it survives a remount, is visible on the
   *  review page, and is recorded with the agent. */
  packs: SelectedPack[];
  /** One-line human summary; the review page renders this readably. */
  selection: string;
  name: string;
  displayName: string;
  emoji: string;
  role: string;
  systemPrompt: string;
  provider: 'openai-codex' | 'anthropic';
  modelName: string;
  apiKey: string;
  compose: { knowledgeBaseRefs: KbRef[]; mcpServers: McpServerVal[] };
}

const EMPTY: GenesisValue = {
  description: '',
  packs: [],
  selection: '',
  name: '',
  displayName: '',
  emoji: '🤖',
  role: 'assistant',
  systemPrompt: '',
  provider: 'openai-codex',
  modelName: '',
  apiKey: '',
  compose: { knowledgeBaseRefs: [], mcpServers: [] },
};

const typeChipStyle: Record<string, React.CSSProperties> = {
  skill: { backgroundColor: '#e8eefc' },
  tool: { backgroundColor: '#fdf1e2' },
  kb: { backgroundColor: '#e6f4ea' },
};

export const AgentGenesisField = (
  props: FieldExtensionComponentProps<GenesisValue>,
) => {
  const { onChange, formData } = props;
  const catalog = useCatalogClient();
  // Normalize hard. `packs`/`compose` are iterated in the render, and a
  // null from either the API (a Go nil slice serializes to `null`) or
  // RJSF's own initialization crashes the whole field
  // ("null is not an object"). Spreading alone is not enough — an
  // explicit null in formData overwrites the EMPTY default.
  const fd = (formData ?? {}) as Partial<GenesisValue>;
  const value: GenesisValue = {
    ...EMPTY,
    ...fd,
    packs: Array.isArray(fd.packs) ? fd.packs : [],
    compose: {
      knowledgeBaseRefs: Array.isArray(fd.compose?.knowledgeBaseRefs)
        ? fd.compose!.knowledgeBaseRefs
        : [],
      mcpServers: Array.isArray(fd.compose?.mcpServers) ? fd.compose!.mcpServers : [],
    },
  };

  const [thinking, setThinking] = React.useState(false);
  const [source, setSource] = React.useState<string | undefined>();
  const [error, setError] = React.useState<string | undefined>();

  const set = (patch: Partial<GenesisValue>) => onChange({ ...value, ...patch });

  // Expand the selection into compose wiring using ONLY the packs
  // themselves — each carries its recipe/dependencies (operator >=
  // v1.7.13), so there is no second lookup that can lag or fail and
  // leave the agent silently unwired. ONE gateway entry serves every
  // registration (credentials injected gateway-side), so tools dedupe
  // on URL.
  const composeFrom = (sel: SelectedPack[] | null | undefined): GenesisValue['compose'] => {
    const list = Array.isArray(sel) ? sel : [];
    const kbs: KbRef[] = [];
    const mcp: McpServerVal[] = [];
    const addTool = (name: string, recipe?: CatalogPack['recipe']) => {
      if (!recipe?.url || mcp.some(m => m.url === recipe.url)) return;
      const e: McpServerVal = { name, url: recipe.url, type: recipe.type || 'http' };
      if (recipe.authHeaderValue) e.authHeaderValue = recipe.authHeaderValue;
      if (recipe.envFromSecret) e.envFromSecret = recipe.envFromSecret;
      mcp.push(e);
    };
    for (const p of list) {
      if (p.type === 'kb') {
        if (!kbs.some(k => k.name === p.name))
          kbs.push({ name: p.name, role: 'knowledge-pool' });
      } else if (p.type === 'tool') {
        addTool(p.name, p.recipe);
      } else if (p.type === 'skill') {
        for (const d of p.dependencies ?? []) {
          if (!d.available) continue;
          if (d.kind === 'mcpServer' && d.gatewayUrl) {
            addTool(d.name, { url: d.gatewayUrl, type: 'http' });
          } else if (d.kind === 'knowledgeBase') {
            if (!kbs.some(k => k.name === d.name))
              kbs.push({ name: d.name, role: 'knowledge-pool' });
          }
        }
      }
    }
    return { knowledgeBaseRefs: kbs, mcpServers: mcp };
  };

  const summarize = (sel: SelectedPack[], c: GenesisValue['compose']) =>
    (sel?.length ?? 0) === 0
      ? 'nothing selected from the catalog'
      : `${sel.map(p => `${p.type}:${p.name}`).join(' · ')}  →  wires ` +
        `${c.mcpServers.length} tool endpoint(s), ${c.knowledgeBaseRefs.length} knowledge base(s)`;

  const suggest = async () => {
    if (!value.description.trim()) return;
    setThinking(true);
    setError(undefined);
    try {
      const rec: RecommendResponse = await catalog.recommend(value.description);
      setSource(rec.source);
      // Defensive: older operators (< v1.7.14) send `packs: null` when
      // nothing matched.
      const picked = Array.isArray(rec.packs) ? rec.packs : [];
      const compose = composeFrom(picked);
      onChange({
        ...value,
        name: rec.identity.name,
        displayName: rec.identity.displayName,
        emoji: rec.identity.emoji || '🤖',
        role: rec.identity.role,
        systemPrompt: rec.identity.systemPrompt,
        packs: picked,
        selection: summarize(picked, compose),
        compose,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setThinking(false);
    }
  };

  const removePack = (name: string) => {
    const next = value.packs.filter(p => p.name !== name);
    const compose = composeFrom(next);
    set({ packs: next, compose, selection: summarize(next, compose) });
  };

  const ready = value.name && value.systemPrompt;

  return (
    <Paper variant="outlined">
      <Box p={2}>
        <Typography variant="h6">What will your agent be doing?</Typography>
        <Typography variant="body2" color="textSecondary" gutterBottom>
          Describe the job. The platform picks the skills, tools, and
          knowledge it needs from the catalog, drafts the identity, and wires
          everything — you just review and create.
        </Typography>
        <Box display="flex" gridGap={8} alignItems="flex-start">
          <TextField
            fullWidth
            multiline
            minRows={2}
            variant="outlined"
            placeholder="e.g. Every Monday, summarize last week's orders: totals, revenue, stuck shipments, top products."
            value={value.description}
            onChange={e => set({ description: e.target.value })}
          />
          <Button
            variant="contained"
            color="primary"
            disabled={thinking || !value.description.trim()}
            onClick={suggest}
          >
            {thinking ? <CircularProgress size={20} /> : ready ? 'Re-suggest' : 'Suggest'}
          </Button>
        </Box>
        {error && (
          <Typography color="error" variant="body2">
            {error}
          </Typography>
        )}

        {ready && (
          <Box mt={2}>
            <Divider />
            <Box mt={2} display="flex" gridGap={12} alignItems="center" flexWrap="wrap">
              <TextField
                size="small"
                label="emoji"
                value={value.emoji}
                onChange={e => set({ emoji: e.target.value })}
                style={{ width: 70 }}
              />
              <TextField
                size="small"
                label="name"
                value={value.name}
                onChange={e => set({ name: e.target.value })}
              />
              <TextField
                size="small"
                label="display name"
                value={value.displayName}
                onChange={e => set({ displayName: e.target.value })}
              />
              <Chip size="small" label={`role: ${value.role}`} />
              {source && (
                <Tooltip
                  arrow
                  title={
                    source === 'model'
                      ? 'Selected by the configured recommender model, constrained to the catalog.'
                      : 'Selected by deterministic catalog matching (no recommender model configured).'
                  }
                >
                  <Chip size="small" variant="outlined" label={`via ${source}`} />
                </Tooltip>
              )}
            </Box>

            <Box mt={2}>
              <Typography variant="subtitle2">
                Selected from the catalog ({value.packs.length})
              </Typography>
              {value.packs.length === 0 && (
                <Typography variant="body2" color="error">
                  Nothing matched this description. The agent would be created
                  with no tools or knowledge — reword the description and press
                  Suggest again, or continue knowingly (it still discovers
                  skills at runtime).
                </Typography>
              )}
              {value.packs.length > 0 && (
                <Table size="small">
                  <TableBody>
                    {value.packs.map(p => (
                      <TableRow key={`${p.type}:${p.name}`}>
                        <TableCell style={{ width: 64 }}>
                          <Chip size="small" label={p.type} style={typeChipStyle[p.type]} />
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2">
                            <strong>{p.displayName || p.name}</strong>
                            {p.version ? ` · v${p.version}` : ''}
                          </Typography>
                          <Typography variant="caption" color="textSecondary">
                            {p.reason || 'selected'}
                          </Typography>
                        </TableCell>
                        <TableCell align="right" style={{ width: 80 }}>
                          <Button size="small" onClick={() => removePack(p.name)}>
                            remove
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Box>

            <Box mt={2}>
              <Typography variant="subtitle2">
                What this wires into the agent
              </Typography>
              <Typography variant="caption" color="textSecondary">
                Exactly what lands in the AgentWorkstation spec — verify it
                before Create.
              </Typography>
              <Table size="small">
                <TableBody>
                  {value.compose.mcpServers.map(m => (
                    <TableRow key={`w-mcp-${m.name}`}>
                      <TableCell style={{ width: 64 }}>
                        <Chip size="small" label="tool" style={typeChipStyle.tool} />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">{m.name}</Typography>
                        <Typography variant="caption" color="textSecondary">
                          {m.url}
                          {m.envFromSecret ? ` · secret: ${m.envFromSecret}` : ''}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ))}
                  {value.compose.knowledgeBaseRefs.map(k => (
                    <TableRow key={`w-kb-${k.name}`}>
                      <TableCell style={{ width: 64 }}>
                        <Chip size="small" label="kb" style={typeChipStyle.kb} />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">{k.name}</Typography>
                        <Typography variant="caption" color="textSecondary">
                          role: {k.role}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ))}
                  {value.compose.mcpServers.length === 0 &&
                    value.compose.knowledgeBaseRefs.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={2}>
                          <Typography variant="caption" color="textSecondary">
                            No tools or knowledge bases wired. Skills still
                            discover at runtime; a skill whose backing service
                            is not deployed contributes nothing here.
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )}
                </TableBody>
              </Table>
            </Box>

            <Box mt={2}>
              <TextField
                fullWidth
                multiline
                minRows={3}
                variant="outlined"
                label="System prompt"
                value={value.systemPrompt}
                onChange={e => set({ systemPrompt: e.target.value })}
              />
            </Box>

            <Box mt={2}>
              <Typography variant="subtitle2">Brain</Typography>
              <RadioGroup
                row
                value={value.provider}
                onChange={e =>
                  set({ provider: e.target.value as GenesisValue['provider'], apiKey: '' })
                }
              >
                <FormControlLabel
                  value="openai-codex"
                  control={<Radio size="small" />}
                  label="Codex subscription (no key — platform credentials)"
                />
                <FormControlLabel
                  value="anthropic"
                  control={<Radio size="small" />}
                  label="Claude (API key)"
                />
              </RadioGroup>
              {value.provider === 'anthropic' && (
                <TextField
                  size="small"
                  type="password"
                  label="Anthropic API key"
                  value={value.apiKey}
                  onChange={e => set({ apiKey: e.target.value })}
                  style={{ minWidth: 320 }}
                />
              )}
            </Box>
          </Box>
        )}
      </Box>
    </Paper>
  );
};
