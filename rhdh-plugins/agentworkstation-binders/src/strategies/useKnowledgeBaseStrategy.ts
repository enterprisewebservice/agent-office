/*
 * useKnowledgeBaseStrategy
 *
 * Strategy for the "Knowledge Bases" tab.
 *   - Lists KnowledgeBase CRs in the AW's namespace
 *   - Reads current spec.knowledgeBaseRefs from the AW
 *   - Greys out KBs whose spec.gatewayRef doesn't match this AW's
 *     runtime.shared.gatewayRef (cross-gateway refs are refused by
 *     the operator's reconciler — see v1.5.0 controller code)
 *   - Renders a role-picker on attached items (planning-reference /
 *     knowledge-pool / experiment-history / runbook / style-guide)
 *   - On Save, fires the stock scaffolder template that opens a PR
 *     against the gitops repo with the updated AW YAML
 */
import { useEffect, useState } from 'react';
import yaml from 'js-yaml';
import { BindingStrategy, BindingItem } from '../BindingPanel';
import { useProxiedK8s } from './useProxiedK8s';
import { useScaffolderPR } from './useScaffolderPR';

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

interface AwSpec {
  spec: {
    runtime?: { shared?: { gatewayRef?: string } };
    knowledgeBaseRefs?: { name: string; role?: string }[];
  };
}

interface GitopsSource {
  repoUrl: string;
  filePath: string;
  defaultBranch: string;
}

interface KbList {
  items: Array<{
    name: string;
    displayName?: string;
    description?: string;
    gatewayRef?: string;
  }>;
}

export const useKnowledgeBaseStrategy = ({
  awName,
  awNamespace,
}: {
  awName: string;
  awNamespace: string;
}): BindingStrategy => {
  const { get } = useProxiedK8s();
  const openPR = useScaffolderPR();

  const [available, setAvailable] = useState<BindingItem[]>([]);
  const [attached, setAttached] = useState<BindingItem[]>([]);
  const [aw, setAw] = useState<AwSpec | null>(null);
  const [gitops, setGitops] = useState<GitopsSource | null>(null);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [kbList, awSpec, gitopsSrc] = await Promise.all([
          get<KbList>(`/namespaces/${awNamespace}/knowledgebases`),
          get<AwSpec>(`/namespaces/${awNamespace}/agentworkstations/${awName}`),
          get<GitopsSource>(
            `/namespaces/${awNamespace}/agentworkstations/${awName}/gitops-source`,
          ),
        ]);
        if (cancelled) return;
        const myGateway = awSpec.spec.runtime?.shared?.gatewayRef ?? '';
        const items: BindingItem[] = kbList.items.map(kb => {
          const cross = myGateway && kb.gatewayRef && kb.gatewayRef !== myGateway;
          return {
            name: kb.name,
            displayName: kb.displayName ?? kb.name,
            description: kb.description,
            disabled: !!cross,
            disabledReason: cross
              ? `Lives on gateway "${kb.gatewayRef}" — this agent runs on "${myGateway}". Move the agent or the KB to attach.`
              : undefined,
            roleOptions,
          };
        });
        setAvailable(items);

        const refs = awSpec.spec.knowledgeBaseRefs ?? [];
        setAttached(
          refs.map(ref => {
            const meta = kbList.items.find(k => k.name === ref.name);
            return {
              name: ref.name,
              displayName: meta?.displayName ?? ref.name,
              description: meta?.description,
              role: ref.role ?? 'knowledge-pool',
              roleOptions,
            };
          }),
        );
        setAw(awSpec);
        setGitops(gitopsSrc);
        setErrorMessage(undefined);
      } catch (err) {
        if (!cancelled) {
          setErrorMessage(
            (err as Error).message +
              ' — most commonly: this entity has no matching AgentWorkstation CR. Set the `agentoffice.ai/agentworkstation-name` annotation on the entity to point at the AW you want bindings managed for.',
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [awName, awNamespace, get]);

  const onSave = async (next: BindingItem[]) => {
    if (!aw || !gitops) {
      throw new Error('AW spec or gitops source not loaded yet');
    }
    setSaving(true);
    try {
      // Compose the new AW spec.knowledgeBaseRefs block. We
      // overwrite ONLY this field — the rest of the spec is
      // preserved verbatim by re-emitting it from the loaded AW.
      const newRefs = next.map(i => ({
        name: i.name,
        ...(i.role && i.role !== 'knowledge-pool' ? { role: i.role } : {}),
      }));
      const updatedSpec = {
        ...aw.spec,
        knowledgeBaseRefs: newRefs.length > 0 ? newRefs : undefined,
      };
      // The full file content we'd PR. Note: this assumes the gitops
      // file contains ONLY the AW YAML. For multi-doc files we'd
      // need smarter merging — flagged as a v0.0.2 limitation.
      const newContent = yaml.dump({
        apiVersion: 'agentoffice.ai/v1alpha1',
        kind: 'AgentWorkstation',
        metadata: { name: awName, namespace: awNamespace },
        spec: updatedSpec,
      });

      await openPR({
        awName,
        awNamespace,
        bindingType: 'kb',
        targetPath: gitops.filePath,
        newContent,
        branchName: `aw-binder/${awName}-kb-${Date.now()}`,
        title: `${awName}: update knowledge-base attachments (${newRefs.length})`,
        body: [
          `Updates \`spec.knowledgeBaseRefs\` on AgentWorkstation \`${awName}\`.`,
          '',
          '## New attachments',
          ...newRefs.map(r => `- \`${r.name}\` (role: \`${r.role ?? 'knowledge-pool'}\`)`),
          '',
          'Generated by the agentworkstation-binders Backstage plugin.',
        ].join('\n'),
      });
      setSaving(false);
    } catch (err) {
      setSaving(false);
      setErrorMessage((err as Error).message);
      throw err;
    }
  };

  return {
    resourceLabel: 'Knowledge Bases',
    available,
    attached,
    onSave,
    saving,
    errorMessage,
  };
};
