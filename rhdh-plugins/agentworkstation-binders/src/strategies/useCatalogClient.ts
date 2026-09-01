/*
 * useCatalogClient — small client for the operator's /catalog/skills
 * runtime-discovery endpoints (v1.6.0).
 *
 * Mirrors useProxiedK8s in shape but talks through a DIFFERENT
 * Backstage proxy entry, `agent-office-catalog`, configured in
 * cluster/rhdh/dynamic-plugins-configmap.yaml. The catalog endpoint
 * is on the same operator HTTP server as the /binders/ routes; the
 * separate proxy entry is so each one can have its own pathRewrite
 * (binders → /binders/, catalog → /catalog/) and there's no path
 * collision risk.
 *
 * Endpoints consumed:
 *
 *   GET /agent-office-catalog/skills?query=&tier=
 *     → { items: [{name, displayName, description, version, tier,
 *                  sourceRepo, sourceRevision, contentSha256,
 *                  tool, requires}], count }
 *
 *   GET /agent-office-catalog/skills/<name>
 *     → { ..., skillMd, promptTemplate }
 *
 * Slice 1 of v1.6.0 #6 uses only the LIST endpoint — the Skills tab
 * is a read-only browser. Detail-view (modal showing the full
 * SKILL.md) comes in a follow-up.
 */
import { useCallback, useMemo } from 'react';
import { useApi, discoveryApiRef, fetchApiRef } from '@backstage/core-plugin-api';

export interface CatalogSkillEntry {
  name: string;
  displayName?: string;
  description?: string;
  version?: string;
  tier?: string;
  sourceRepo?: string;
  sourceRevision?: string;
  contentSha256?: string;
  tool?: string;
  requires?: string[];
  dependencies?: CatalogSkillDependency[];
}

// Serve-time-enriched projection of Skill.spec.dependencies
// (operator >= v1.7.10). `available` reflects live cluster state;
// `gatewayUrl` is set for available mcpServer deps — ONE shared
// gateway endpoint serves every registration (credentials are
// injected gateway-side on the tool-call path), so fulfillment
// dedupes to a single mcpServers entry pointing at that URL.
export interface CatalogSkillDependency {
  kind: 'mcpServer' | 'knowledgeBase';
  name: string;
  optional?: boolean;
  available: boolean;
  gatewayUrl?: string;
}

export interface CatalogSkillList {
  items: CatalogSkillEntry[];
  count: number;
}

// One row of the unified /catalog/packs index (operator >= v1.7.11):
// every composable thing — skill, tool, knowledge base — as a typed
// pack sharing the pack-manifest vocabulary
// (name/version/description/requires). Tools carry the exact
// mcpServers entry that consumes them; nothing is hardcoded client-side.
export interface CatalogPack {
  type: 'skill' | 'tool' | 'kb';
  name: string;
  displayName?: string;
  description?: string;
  version?: string;
  tier?: string;
  requires?: string[];
  dependencies?: CatalogSkillDependency[];
  recipe?: {
    url: string;
    type: string;
    authHeaderValue?: string;
    envFromSecret?: string;
  };
  gatewayRef?: string;
  // Registry provenance — present on federated artifacts (not installed
  // on this cluster yet). `installed` is false only for those.
  installed?: boolean;
  registry?: string;
  artifactKind?: 'meta-pack' | 'pack' | 'skill';
  /** Registry namespace — the family boundary (e.g. meshforge). */
  namespace?: string;
  member?: string;
  /** Child packs of a meta-pack, from the registry manifest
   *  (operator >= v1.7.21). parkforge-brain lists five. */
  members?: string[];
  /** Leaf skills a pack ships, by short name. Advisory — the
   *  authoritative edge is `member` on each skill row. */
  skills?: string[];
  /** The Maven-style pack->pack dependency graph with version ranges
   *  (operator >= v1.7.23). Separate from `dependencies`, which are
   *  cluster resources. Reported, never auto-resolved — mindifact
   *  treats requires as a presence check. */
  packRequires?: CatalogPackRequirement[];
}

export interface CatalogPackRequirement {
  name: string;
  range?: string;
  satisfied: boolean;
}

export interface CatalogPackList {
  items: CatalogPack[];
  count: number;
}

// POST /catalog/recommend (operator >= v1.7.12) — the one-step
// composer's brain. `source` is honest about which engine answered:
// "model" (recommender endpoint, constrained to the catalog) or
// "fallback" (deterministic keyword scoring).
export interface RecommendResponse {
  source: 'model' | 'fallback';
  identity: {
    name: string;
    displayName: string;
    emoji?: string;
    role: string;
    systemPrompt: string;
  };
  // Each pack is the FULL catalog entry (recipe, dependencies) plus the
  // reason — operator >= v1.7.13. One call is enough to wire the agent.
  packs: (CatalogPack & { reason?: string })[];
  /** Which gateway (== team) the agent joins, chosen by the recommender
   *  rather than picked from a list — operator >= v1.7.32. Displayed,
   *  never overridable: a gateway is a shared runtime, browser node and
   *  blast radius, so the platform decides and the user reviews. */
  team?: RecommendTeam;
}

export interface RecommendTeam {
  gateway: string;
  team?: string;
  reason?: string;
  /** The crew already on that gateway — what makes a wrong pick obvious. */
  members?: string[];
  ready: boolean;
  existing: boolean;
}

// POST /catalog/refine (operator >= v1.7.61) — the conversational half
// of the composer. The whole chat rides up each turn; the server
// applies the model's targeted ops to `current` and returns the full
// updated composition, so the client swaps state wholesale while the
// edit itself stays surgical.
export interface RefineMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface RefineRequest {
  description: string;
  current: {
    identity: {
      name: string;
      displayName: string;
      emoji?: string;
      role: string;
      systemPrompt: string;
    };
    /** Names only — the server re-resolves against the live catalog. */
    packs: string[];
    /** Display label of the chosen brain, for conversation only. */
    brain?: string;
  };
  messages: RefineMessage[];
}

export interface RefineResponse {
  source: string;
  /** What the composer says back — rendered as the assistant bubble. */
  reply: string;
  identity: RecommendResponse['identity'];
  packs: (CatalogPack & { reason?: string })[];
  team?: RecommendTeam;
  /** False for question-only turns: nothing to re-apply. */
  changed: boolean;
}

// GET /catalog/model-connections (operator >= v1.7.59) — the brain
// menu. Admin-published ModelConnections: non-secret metadata plus
// access rules the field filters against the signed-in user's group
// memberships. Secret references never cross this wire.
export interface ModelConnectionEntry {
  name: string;
  displayName: string;
  description?: string;
  kind: 'subscription' | 'apiKey' | 'endpoint';
  provider?: string;
  models?: { id: string; name?: string }[];
  keyStrategy?: string;
  access?: { groups?: string[]; users?: string[] };
}

export interface ModelConnectionList {
  items: ModelConnectionEntry[];
  count: number;
}

export const useCatalogClient = () => {
  const discoveryApi = useApi(discoveryApiRef);
  const fetchApi = useApi(fetchApiRef);

  // Memoized for the same reason as useProxiedK8s.get — strategy
  // hooks include the function in useEffect deps; without
  // useCallback the reference changes every render and the effect
  // refires in an infinite loop (the bug v0.0.2 fixed).
  const listSkills = useCallback(
    async (opts: { query?: string; tier?: string } = {}): Promise<CatalogSkillList> => {
      const base = await discoveryApi.getBaseUrl('proxy');
      const url = new URL(`${base}/agent-office-catalog/skills`);
      if (opts.query) url.searchParams.set('query', opts.query);
      if (opts.tier) url.searchParams.set('tier', opts.tier);

      const res = await fetchApi.fetch(url.toString(), {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(
          `catalog list failed: HTTP ${res.status} ${text.slice(0, 200)}`,
        );
      }
      return (await res.json()) as CatalogSkillList;
    },
    [discoveryApi, fetchApi],
  );

  const listPacks = useCallback(
    async (opts: { query?: string; type?: string } = {}): Promise<CatalogPackList> => {
      const base = await discoveryApi.getBaseUrl('proxy');
      const url = new URL(`${base}/agent-office-catalog/packs`);
      if (opts.query) url.searchParams.set('query', opts.query);
      if (opts.type) url.searchParams.set('type', opts.type);
      const res = await fetchApi.fetch(url.toString(), {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(
          `packs list failed: HTTP ${res.status} ${text.slice(0, 200)}`,
        );
      }
      return (await res.json()) as CatalogPackList;
    },
    [discoveryApi, fetchApi],
  );

  const recommend = useCallback(
    async (description: string): Promise<RecommendResponse> => {
      const base = await discoveryApi.getBaseUrl('proxy');
      const res = await fetchApi.fetch(`${base}/agent-office-catalog/recommend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ description }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(
          `recommend failed: HTTP ${res.status} ${text.slice(0, 200)}`,
        );
      }
      return (await res.json()) as RecommendResponse;
    },
    [discoveryApi, fetchApi],
  );

  const refine = useCallback(
    async (req: RefineRequest): Promise<RefineResponse> => {
      const base = await discoveryApi.getBaseUrl('proxy');
      const res = await fetchApi.fetch(`${base}/agent-office-catalog/refine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(req),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(
          res.status === 404
            ? 'this platform does not have the conversational composer yet (operator < v1.7.61)'
            : `refine failed: HTTP ${res.status} ${text.slice(0, 200)}`,
        );
      }
      return (await res.json()) as RefineResponse;
    },
    [discoveryApi, fetchApi],
  );

  // Materialize a registry artifact on the cluster (operator >= v1.7.16).
  // A pack installs its member skills; a meta-pack installs everything.
  const install = useCallback(
    async (name: string): Promise<{ installed: string[]; skipped: string[] }> => {
      const base = await discoveryApi.getBaseUrl('proxy');
      const res = await fetchApi.fetch(`${base}/agent-office-catalog/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`install failed: HTTP ${res.status} ${text.slice(0, 200)}`);
      }
      return (await res.json()) as { installed: string[]; skipped: string[] };
    },
    [discoveryApi, fetchApi],
  );

  const listModelConnections = useCallback(async (): Promise<ModelConnectionList> => {
    const base = await discoveryApi.getBaseUrl('proxy');
    const res = await fetchApi.fetch(`${base}/agent-office-catalog/model-connections`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `model-connections list failed: HTTP ${res.status} ${text.slice(0, 200)}`,
      );
    }
    return (await res.json()) as ModelConnectionList;
  }, [discoveryApi, fetchApi]);

  return useMemo(
    () => ({ listSkills, listPacks, recommend, refine, install, listModelConnections }),
    [listSkills, listPacks, recommend, refine, install, listModelConnections],
  );
};
