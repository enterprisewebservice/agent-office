/*
 * <AgentGenesisField> — the ONE-STEP agent creator (v0.0.19).
 *
 * The whole wizard collapses into this field. The user:
 *
 *   1. describes the job in plain language,
 *   2. picks the brain from the connections the admin published FOR
 *      THEM (ModelConnections filtered by the signed-in user's group
 *      memberships — an admin sees the house subscriptions, an
 *      attendee sees the MaaS lane and the sovereign model),
 *   3. hits Create.
 *
 * No credentials are ever typed here. The old paste-an-Anthropic-key
 * radio was a dead lane (the operator never rendered an anthropic
 * provider block) and is gone.
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
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  MenuItem,
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
import ExpandMoreIcon from '@material-ui/icons/ExpandMore';
import { identityApiRef, useApi } from '@backstage/core-plugin-api';
import { FieldExtensionComponentProps } from '@backstage/plugin-scaffolder-react';
import {
  useCatalogClient,
  CatalogPack,
  ModelConnectionEntry,
  RecommendResponse,
  RecommendTeam,
} from './strategies/useCatalogClient';
import { AgentConstellation, packHue } from './AgentConstellation';

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
  /** Provider written to the AgentWorkstation. Subscription/apiKey
   *  connections carry their preset (`openai-codex`, `openai`);
   *  endpoint connections emit `custom` + connectionRef, and the
   *  operator renders the matching gateway provider block. */
  provider: string;
  modelName: string;
  /** Cluster-scoped ModelConnection this brain choice rides
   *  (endpoint kind only; empty for subscription/apiKey presets). */
  connectionRef: string;
  /** Vestigial — the template still receives it; always ''. The old
   *  paste-an-Anthropic-key path was a dead lane (no operator
   *  rendering) and is gone from the UI. */
  apiKey: string;
  compose: { knowledgeBaseRefs: KbRef[]; mcpServers: McpServerVal[] };
  /** The gateway the agent joins. Chosen by Suggest, shown read-only —
   *  a gateway is a shared runtime, browser node and blast radius, so
   *  it is a platform decision, not a dropdown. */
  gatewayRef: string;
  team?: RecommendTeam;
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
  connectionRef: '',
  apiKey: '',
  compose: { knowledgeBaseRefs: [], mcpServers: [] },
  gatewayRef: '',
};

/** The always-works fallback brain: the platform Codex subscription,
 *  exactly what the field offered before connections existed. Shown
 *  when the connections API is unreachable or advertises nothing to
 *  this user — hiring must never brick on the menu. */
const FALLBACK_BRAIN: ModelConnectionEntry = {
  name: '__platform-codex__',
  displayName: 'Codex subscription (platform credentials)',
  kind: 'subscription',
  provider: 'openai-codex',
  models: [{ id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' }],
};

/** Case-insensitive membership test between a connection's access
 *  rules and the signed-in user's identity refs. Group entries match
 *  either spelling the platform uses — bare (`attendees`) or full
 *  (`group:default/attendees`) — same as the genesis template's own
 *  memberOf checks. No access block ⇒ hidden (publishing is a
 *  deliberate admin act). */
const canSee = (
  conn: ModelConnectionEntry,
  userName: string,
  ownershipRefs: string[],
): boolean => {
  const a = conn.access;
  if (!a || ((a.groups ?? []).length === 0 && (a.users ?? []).length === 0)) {
    return false;
  }
  const lcUser = userName.toLowerCase();
  if ((a.users ?? []).some(u => u.toLowerCase() === lcUser)) return true;
  const mine = new Set<string>();
  for (const ref of ownershipRefs) {
    const lc = ref.toLowerCase();
    mine.add(lc);
    const short = lc.split('/').pop();
    if (short) mine.add(short);
  }
  return (a.groups ?? []).some(
    g => mine.has(g.toLowerCase()) || mine.has(`group:default/${g.toLowerCase()}`),
  );
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

  const identityApi = useApi(identityApiRef);

  const [thinking, setThinking] = React.useState(false);
  const [source, setSource] = React.useState<string | undefined>();
  const [error, setError] = React.useState<string | undefined>();

  // The brain menu: admin-published ModelConnections the signed-in
  // user is allowed to pick, resolved once. Falls back to the
  // platform Codex subscription when the API is unreachable or
  // nothing is advertised to this user.
  const [brains, setBrains] = React.useState<ModelConnectionEntry[]>([FALLBACK_BRAIN]);
  React.useEffect(() => {
    let live = true;
    Promise.all([
      catalog.listModelConnections().catch(() => ({ items: [], count: 0 })),
      identityApi.getBackstageIdentity().catch(() => undefined),
    ]).then(([list, ident]) => {
      if (!live) return;
      const userName =
        ident?.userEntityRef?.split('/').pop() ?? '';
      const refs = ident?.ownershipEntityRefs ?? [];
      const visible = (Array.isArray(list.items) ? list.items : []).filter(c =>
        canSee(c, userName, refs),
      );
      setBrains(visible.length > 0 ? visible : [FALLBACK_BRAIN]);
    });
    return () => {
      live = false;
    };
  }, [catalog, identityApi]);

  /** Write the brain choice into the form value. Endpoint kind rides
   *  connectionRef + provider `custom`; subscription/apiKey presets
   *  ride their legacy provider with no ref. */
  const pickBrain = (conn: ModelConnectionEntry, modelId?: string) => {
    const model = modelId || conn.models?.[0]?.id || '';
    if (conn.kind === 'endpoint') {
      set({ connectionRef: conn.name, provider: 'custom', modelName: model, apiKey: '' });
    } else {
      set({
        connectionRef: '',
        provider: conn.provider || 'openai-codex',
        modelName: model,
        apiKey: '',
      });
    }
  };

  /** Which menu entry the current form value corresponds to. */
  const selectedBrain = (): ModelConnectionEntry | undefined =>
    value.connectionRef
      ? brains.find(b => b.name === value.connectionRef)
      : brains.find(b => b.kind !== 'endpoint' && (b.provider || 'openai-codex') === value.provider) ??
        (value.provider === FALLBACK_BRAIN.provider ? FALLBACK_BRAIN : undefined);

  // The whole catalog, for resolving a parent pack to its children.
  // A recommendation returns only the artifacts it chose, so picking
  // parkforge-brain says nothing about the five member packs and six
  // skills underneath it — the tree lives in the index.
  const [catalogAll, setCatalogAll] = React.useState<CatalogPack[]>([]);
  React.useEffect(() => {
    let live = true;
    catalog
      .listPacks()
      .then(r => {
        if (live) setCatalogAll(Array.isArray(r?.items) ? r.items : []);
      })
      // Non-fatal: without it parents simply render without a tree.
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [catalog]);

  const byName = React.useMemo(() => {
    const m = new Map<string, CatalogPack>();
    for (const p of catalogAll) m.set(p.name, p);
    return m;
  }, [catalogAll]);

  const childrenOf = React.useCallback(
    (parent: string) => catalogAll.filter(p => p.member === parent),
    [catalogAll],
  );

  /** The pack tree under a selection, exactly as install resolves it:
   *  a meta-pack expands to its member packs, each pack to the skills
   *  naming it. Returns [] for a leaf skill. */
  const treeOf = React.useCallback(
    (p: SelectedPack): { pack: CatalogPack; skills: CatalogPack[] }[] => {
      if (p.artifactKind === 'meta-pack') {
        const names =
          p.members && p.members.length
            ? p.members
            : catalogAll
                .filter(
                  c => c.artifactKind === 'pack' && c.namespace === p.namespace,
                )
                .map(c => c.name);
        return names
          .map(n => ({
            pack: byName.get(n) ?? ({ name: n, type: 'skill' } as CatalogPack),
            skills: childrenOf(n),
          }))
          .filter(e => e.skills.length > 0 || byName.has(e.pack.name));
      }
      if (p.artifactKind === 'pack') {
        return [{ pack: p as CatalogPack, skills: childrenOf(p.name) }];
      }
      return [];
    },
    [byName, catalogAll, childrenOf],
  );

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

  // Counts skills alongside tools and KBs. Counting only what compose
  // produces made a skill-only pick summarise as "wires 0 tool
  // endpoint(s), 0 knowledge base(s)" — true of the spec, and wrong
  // about the agent.
  const summarize = (sel: SelectedPack[], c: GenesisValue['compose']) => {
    const list = Array.isArray(sel) ? sel : [];
    if (list.length === 0) return 'nothing selected from the catalog';
    const skills = list.filter(p => p.type === 'skill').length;
    const parts = [
      skills ? `${skills} skill(s)` : '',
      c.mcpServers.length ? `${c.mcpServers.length} tool endpoint(s)` : '',
      c.knowledgeBaseRefs.length
        ? `${c.knowledgeBaseRefs.length} knowledge base(s)`
        : '',
    ].filter(Boolean);
    const unmet = list
      .flatMap(p => p.dependencies ?? [])
      .filter(d => !d.available).length;
    return (
      `${list.map(p => `${p.type}:${p.name}`).join(' · ')}  →  ` +
      `${parts.join(', ')}` +
      (unmet ? ` · ${unmet} prerequisite(s) not deployed` : '')
    );
  };

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
        gatewayRef: rec.team?.gateway ?? '',
        team: rec.team,
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
            // nowrap + a floor wide enough for the longer label: the
            // button is a flex sibling of a full-width TextField, so
            // without these "Re-suggest" wraps mid-word.
            style={{ whiteSpace: 'nowrap', minWidth: 132, height: 56 }}
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
            {/* The agent, drawn: a deterministic radial view of what is
                being assembled — identity core, BRAIN ring, SKILLS as
                per-pack dot-arcs (meta-packs bloom into their real
                trees), TOOLS and KNOWLEDGE satellites, the TEAM ring
                outermost. Same agent ⇒ same constellation, so people
                learn to read agents at a glance. */}
            <Box mt={2}>
              <AgentConstellation
                emoji={value.emoji}
                name={value.name}
                brainLabel={(() => {
                  const b = selectedBrain();
                  const m = (b?.models ?? []).find(x => x.id === value.modelName);
                  return m?.name || value.modelName || b?.models?.[0]?.name || 'auto';
                })()}
                brainSub={selectedBrain()?.displayName}
                skills={value.packs
                  .filter(p => p.type === 'skill')
                  .map((p, i) => {
                    const tree = treeOf(p);
                    const leaves = tree.flatMap(e => e.skills.map(s => s.name));
                    return {
                      pack: p.displayName || p.name,
                      hue: packHue(i),
                      skills: leaves.length ? leaves : [p.name],
                    };
                  })}
                tools={value.compose.mcpServers.map(m => m.name)}
                knowledge={value.compose.knowledgeBaseRefs.map(k => k.name)}
                team={
                  value.team
                    ? {
                        gateway: value.team.gateway,
                        members: value.team.members ?? [],
                        isNew: !value.team.existing,
                      }
                    : undefined
                }
              />
            </Box>
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

            {/* The team is chosen, not offered. A gateway is a shared
                runtime, browser node, namespace and blast radius, so a
                dropdown would push a platform decision onto whoever
                wrote the sentence — same reasoning as the pack list.
                Shown with the crew already there, which is what makes a
                wrong placement obvious at a glance. */}
            {value.team && (
              <Box mt={2}>
                <Typography variant="subtitle2">
                  {value.team.existing ? 'Joins the team' : 'Starts a new team'}
                </Typography>
                <Box display="flex" gridGap={8} alignItems="center" flexWrap="wrap" mt={1}>
                  <Chip
                    size="small"
                    label={value.team.gateway}
                    style={{ backgroundColor: '#ede7f6', fontWeight: 600 }}
                  />
                  {!value.team.existing && (
                    <Chip size="small" label="new gateway" style={{ backgroundColor: '#e8f5e9' }} />
                  )}
                  {value.team.existing && !value.team.ready && (
                    <Chip size="small" label="gateway not ready" style={{ backgroundColor: '#fdecea' }} />
                  )}
                  {value.team.reason && (
                    <Typography variant="caption" color="textSecondary">
                      {value.team.reason}
                    </Typography>
                  )}
                </Box>
                <Typography variant="caption" color="textSecondary" component="div">
                  {!value.team.existing
                    ? 'no existing crew does this work — this gateway is created with the agent'
                    : value.team.members && value.team.members.length
                      ? `alongside ${value.team.members.join(', ')}`
                      : 'first agent on this gateway'}
                </Typography>
              </Box>
            )}

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
                Everything the agent ends up with — spec fields plus what it
                picks up at runtime. Verify it before Create.
              </Typography>
              <Table size="small">
                <TableBody>
                  {/* Skills attach by runtime discovery rather than a spec
                      field, so they used to be missing here entirely — which
                      made a skill-only recommendation read as "nothing
                      happened". Show them, and name any prerequisite the
                      cluster is missing instead of hinting at it. */}
                  {value.packs
                    .filter(p => p.type === 'skill')
                    .map(p => {
                      const unmet = (p.dependencies ?? []).filter(
                        d => !d.available,
                      );
                      const tree = treeOf(p);
                      const leafCount = tree.reduce(
                        (n, e) => n + e.skills.length,
                        0,
                      );
                      const kind = p.artifactKind || 'skill';
                      return (
                        <TableRow key={`w-skill-${p.name}`}>
                          <TableCell style={{ width: 64 }}>
                            <Chip
                              size="small"
                              label={kind === 'skill' ? 'skill' : kind}
                              style={typeChipStyle.skill}
                            />
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2">
                              {p.displayName || p.name}
                            </Typography>
                            <Typography variant="caption" color="textSecondary">
                              {kind === 'skill'
                                ? 'attaches by runtime discovery'
                                : `${tree.length} pack(s), ${leafCount} skill(s) — all installed together`}
                              {p.installed === false
                                ? ` · installs from ${p.registry || 'the registry'} on create`
                                : ''}
                            </Typography>
                            {unmet.length > 0 && (
                              <Typography
                                variant="caption"
                                component="div"
                                style={{ color: '#a15c07' }}
                              >
                                needs{' '}
                                {unmet
                                  .map(d => `${d.name} (${d.kind})`)
                                  .join(', ')}{' '}
                                — not deployed on this cluster, so that part of
                                the skill stays inert until it is.
                              </Typography>
                            )}
                            {/* The dependency graph, which is NOT the same as
                                containment: parkforge-terrain requires
                                parkforge-core, but core does not contain it.
                                Reported, never auto-installed — mindifact
                                treats requires as a presence check — so an
                                unmet edge is named and left to the user. */}
                            {(p.packRequires ?? []).length > 0 && (
                              <Typography
                                variant="caption"
                                component="div"
                                color="textSecondary"
                              >
                                requires{' '}
                                {(p.packRequires ?? []).map((r, i) => (
                                  <span key={r.name}>
                                    {i > 0 ? ', ' : ''}
                                    <span
                                      style={{
                                        color: r.satisfied ? undefined : '#a15c07',
                                        fontWeight: r.satisfied ? undefined : 600,
                                      }}
                                    >
                                      {r.name}
                                      {r.range ? ` ${r.range}` : ''}
                                      {r.satisfied ? '' : ' (not installed)'}
                                    </span>
                                  </span>
                                ))}
                              </Typography>
                            )}
                            {/* A parent pack is a container: picking
                                parkforge-brain installs five packs and six
                                skills, and one row saying "parkforge-brain"
                                hides all of it. Collapsed by default so the
                                panel stays scannable; open it to see exactly
                                what lands. */}
                            {tree.length > 0 && (
                              <Accordion
                                elevation={0}
                                square
                                style={{
                                  background: 'transparent',
                                  marginTop: 4,
                                }}
                              >
                                <AccordionSummary
                                  expandIcon={<ExpandMoreIcon fontSize="small" />}
                                  style={{ minHeight: 0, padding: 0 }}
                                >
                                  <Typography variant="caption" color="primary">
                                    what&apos;s inside
                                  </Typography>
                                </AccordionSummary>
                                <AccordionDetails style={{ padding: 0 }}>
                                  <Box pl={1} width="100%">
                                    {tree.map(entry => (
                                      <Box key={`t-${entry.pack.name}`} mb={1}>
                                        <Typography variant="caption">
                                          <strong>{entry.pack.name}</strong>
                                          {entry.pack.artifactKind
                                            ? ` · ${entry.pack.artifactKind}`
                                            : ''}
                                        </Typography>
                                        {entry.skills.length === 0 && (
                                          <Typography
                                            variant="caption"
                                            component="div"
                                            color="textSecondary"
                                            style={{ paddingLeft: 12 }}
                                          >
                                            no skills published yet
                                          </Typography>
                                        )}
                                        {entry.skills.map(s => (
                                          <Typography
                                            key={`t-${entry.pack.name}-${s.name}`}
                                            variant="caption"
                                            component="div"
                                            color="textSecondary"
                                            style={{ paddingLeft: 12 }}
                                          >
                                            • {s.name}
                                            {s.installed ? ' (installed)' : ''}
                                          </Typography>
                                        ))}
                                      </Box>
                                    ))}
                                  </Box>
                                </AccordionDetails>
                              </Accordion>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
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
                  {/* Only when there is genuinely nothing. Previously this
                      fired whenever compose was empty, so a perfectly good
                      skill-only pick announced that nothing was wired. */}
                  {value.packs.length === 0 &&
                    value.compose.mcpServers.length === 0 &&
                    value.compose.knowledgeBaseRefs.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={2}>
                          <Typography variant="caption" color="textSecondary">
                            Nothing selected. The agent is still created — it
                            just starts with its identity and no catalog
                            capabilities.
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

            {/* The brain menu is published, not hardcoded: each entry
                is a ModelConnection the admin created with access
                rules, so an admin sees the house subscriptions while
                an attendee sees the metered MaaS lane and the
                sovereign model — same picker, different menu. No
                credentials are entered here, ever: subscription
                entries ride the gateway's stored auth, endpoint
                entries are keyed by the operator from the admin
                namespace. */}
            <Box mt={2}>
              <Typography variant="subtitle2">Brain</Typography>
              <RadioGroup
                value={selectedBrain()?.name ?? ''}
                onChange={e => {
                  const conn = brains.find(b => b.name === e.target.value);
                  if (conn) pickBrain(conn);
                }}
              >
                {brains.map(b => (
                  <Box key={b.name} display="flex" alignItems="center" gridGap={8}>
                    <FormControlLabel
                      value={b.name}
                      control={<Radio size="small" />}
                      label={
                        <span>
                          {b.displayName}
                          {b.description ? (
                            <Typography
                              variant="caption"
                              color="textSecondary"
                              component="span"
                              style={{ marginLeft: 8 }}
                            >
                              {b.description}
                            </Typography>
                          ) : null}
                        </span>
                      }
                    />
                    {selectedBrain()?.name === b.name && (b.models ?? []).length > 1 && (
                      <TextField
                        select
                        size="small"
                        value={value.modelName || b.models![0].id}
                        onChange={e => pickBrain(b, e.target.value)}
                        style={{ minWidth: 180 }}
                      >
                        {b.models!.map(m => (
                          <MenuItem key={m.id} value={m.id}>
                            {m.name || m.id}
                          </MenuItem>
                        ))}
                      </TextField>
                    )}
                  </Box>
                ))}
              </RadioGroup>
            </Box>
          </Box>
        )}
      </Box>
    </Paper>
  );
};
