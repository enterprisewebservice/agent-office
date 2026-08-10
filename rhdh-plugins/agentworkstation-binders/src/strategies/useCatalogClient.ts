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
  packs: { type: string; name: string; displayName?: string; reason?: string }[];
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

  return useMemo(
    () => ({ listSkills, listPacks, recommend }),
    [listSkills, listPacks, recommend],
  );
};
