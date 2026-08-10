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
interface McpServerVal {
  name: string;
  url: string;
  type: string;
  authHeaderValue?: string;
  envFromSecret?: string;
}
export interface GenesisValue {
  description: string;
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
  const value: GenesisValue = { ...EMPTY, ...(formData ?? {}) };

  const [packsByName, setPacksByName] = React.useState<Map<string, CatalogPack>>(
    new Map(),
  );
  const [selected, setSelected] = React.useState<
    { type: string; name: string; displayName?: string; reason?: string }[]
  >([]);
  const [thinking, setThinking] = React.useState(false);
  const [source, setSource] = React.useState<string | undefined>();
  const [error, setError] = React.useState<string | undefined>();

  React.useEffect(() => {
    if (!formData) onChange(EMPTY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await catalog.listPacks();
        if (!cancelled)
          setPacksByName(new Map(res.items.map(p => [p.name, p])));
      } catch {
        /* packs map is an enhancement; recommend still works without it */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [catalog]);

  const set = (patch: Partial<GenesisValue>) => onChange({ ...value, ...patch });

  // Expand a pack selection into the compose wiring. ONE gateway entry
  // serves every registration (credentials injected gateway-side), so
  // tool entries dedupe on URL.
  const composeFrom = (
    sel: { type: string; name: string }[],
  ): GenesisValue['compose'] => {
    const kbs: KbRef[] = [];
    const mcp: McpServerVal[] = [];
    const addTool = (name: string, recipe?: CatalogPack['recipe']) => {
      if (!recipe || mcp.some(m => m.url === recipe.url)) return;
      const e: McpServerVal = { name, url: recipe.url, type: recipe.type || 'http' };
      if (recipe.authHeaderValue) e.authHeaderValue = recipe.authHeaderValue;
      if (recipe.envFromSecret) e.envFromSecret = recipe.envFromSecret;
      mcp.push(e);
    };
    for (const s of sel) {
      const p = packsByName.get(s.name);
      if (s.type === 'kb') {
        if (!kbs.some(k => k.name === s.name))
          kbs.push({ name: s.name, role: 'knowledge-pool' });
      } else if (s.type === 'tool') {
        addTool(s.name, p?.recipe);
      } else if (s.type === 'skill' && p) {
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

  const suggest = async () => {
    if (!value.description.trim()) return;
    setThinking(true);
    setError(undefined);
    try {
      const rec: RecommendResponse = await catalog.recommend(value.description);
      setSelected(rec.packs);
      setSource(rec.source);
      onChange({
        ...value,
        name: rec.identity.name,
        displayName: rec.identity.displayName,
        emoji: rec.identity.emoji || '🤖',
        role: rec.identity.role,
        systemPrompt: rec.identity.systemPrompt,
        compose: composeFrom(rec.packs),
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setThinking(false);
    }
  };

  const removePack = (name: string) => {
    const next = selected.filter(s => s.name !== name);
    setSelected(next);
    set({ compose: composeFrom(next) });
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

            <Box mt={1.5} display="flex" gridGap={6} flexWrap="wrap">
              {selected.map(s => (
                <Tooltip key={s.name} arrow title={s.reason ?? ''}>
                  <Chip
                    size="small"
                    label={`${s.type}: ${s.displayName || s.name}`}
                    style={typeChipStyle[s.type]}
                    onDelete={() => removePack(s.name)}
                  />
                </Tooltip>
              ))}
              {selected.length === 0 && (
                <Typography variant="caption" color="textSecondary">
                  No catalog packs matched — the agent starts with runtime
                  skill discovery only.
                </Typography>
              )}
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
