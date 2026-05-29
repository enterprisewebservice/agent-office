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
}

export interface CatalogSkillList {
  items: CatalogSkillEntry[];
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

  return useMemo(() => ({ listSkills }), [listSkills]);
};
