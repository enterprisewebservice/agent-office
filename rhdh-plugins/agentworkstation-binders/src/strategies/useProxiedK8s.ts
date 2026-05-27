/*
 * useProxiedK8s — small client for the agent-office-binders proxy
 * endpoint declared in app-config.yaml. The proxy points at the
 * operator's in-cluster agent-office-backstage-catalog Service
 * (same one codex-reauth-ui uses for /codex-auth/status).
 *
 * Endpoints assumed on the operator (operator owes these in a
 * later release — for tonight's MVP the strategies are coded
 * against a contract; if the endpoints don't exist yet the
 * strategy surfaces a clear errorMessage in the panel):
 *
 *   GET /agent-office-binders/namespaces/<ns>/knowledgebases
 *     → { items: [{name, displayName, description, gatewayRef}] }
 *
 *   GET /agent-office-binders/namespaces/<ns>/memorymodules
 *     → { items: [{name, displayName, kind, filename, version}] }
 *
 *   GET /agent-office-binders/namespaces/<ns>/skills
 *     → { items: [{name, displayName, tool, version}] }
 *
 *   GET /agent-office-binders/namespaces/<ns>/agentworkstations/<name>
 *     → { spec: {...full AW spec...}, metadata: {...} }
 *
 *   GET /agent-office-binders/namespaces/<ns>/agentworkstations/<name>/gitops-source
 *     → { repoUrl, repoOwner, repoName, defaultBranch, filePath }
 *     so the plugin knows which file to patch on Save.
 */
import { useApi, discoveryApiRef, fetchApiRef } from '@backstage/core-plugin-api';

export const useProxiedK8s = () => {
  const discoveryApi = useApi(discoveryApiRef);
  const fetchApi = useApi(fetchApiRef);

  const base = async () =>
    `${await discoveryApi.getBaseUrl('proxy')}/agent-office-binders`;

  const get = async <T>(path: string): Promise<T> => {
    const url = `${await base()}${path}`;
    const res = await fetchApi.fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `proxied K8s GET ${path} failed: HTTP ${res.status} ${text.slice(0, 200)}`,
      );
    }
    return res.json() as Promise<T>;
  };

  return { get };
};
