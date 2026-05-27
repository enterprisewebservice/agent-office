/*
 * useSkillStrategy
 *
 * Strategy for the "Skills" tab. This one is structurally
 * different from KB and MemoryModule strategies because Skills
 * are bound to AWs via SEPARATE SkillBinding CRs (not a field on
 * AgentWorkstation spec).
 *
 * Two paths to ship this cleanly:
 *
 *  1. (Today's stub) UI lists Skill CRs as available, lists
 *     existing SkillBinding CRs that have this AW in
 *     status.appliedTo as attached. Save is DISABLED with a
 *     tooltip explaining we need an operator follow-up
 *     (v1.6.0: `spec.skillRefs []SkillRef` on AW, operator
 *     translates into managed SkillBinding CRs). Without that
 *     normalization, Save would need to compose multi-file PRs
 *     editing/creating SkillBinding YAMLs, which is doable but
 *     materially more complex than the KB/Memory path.
 *
 *  2. (Follow-up) When v1.6.0 ships spec.skillRefs, swap this
 *     strategy to write spec.skillRefs like the other two
 *     strategies write to AW spec fields. UX becomes identical.
 *
 * We render the tab today so the plugin's full shape is visible
 * — both for design feedback and so users see Skills will be a
 * first-class binding type.
 */
import { useEffect, useState } from 'react';
import { BindingStrategy, BindingItem } from '../BindingPanel';
import { useProxiedK8s } from './useProxiedK8s';

interface SkillList {
  items: Array<{
    name: string;
    displayName?: string;
    tool?: string;
    version?: string;
  }>;
}

interface SkillBindingList {
  items: Array<{
    name: string;
    skillRef: { name: string; version?: string };
    appliedTo: string[];
  }>;
}

export const useSkillStrategy = ({
  awName,
  awNamespace,
}: {
  awName: string;
  awNamespace: string;
}): BindingStrategy => {
  const { get } = useProxiedK8s();

  const [available, setAvailable] = useState<BindingItem[]>([]);
  const [attached, setAttached] = useState<BindingItem[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [skills, bindings] = await Promise.all([
          get<SkillList>(`/namespaces/${awNamespace}/skills`),
          get<SkillBindingList>(`/namespaces/${awNamespace}/skillbindings`),
        ]);
        if (cancelled) return;
        const appliedSkills = new Set(
          bindings.items
            .filter(b => b.appliedTo.includes(awName))
            .map(b => b.skillRef.name),
        );
        setAvailable(
          skills.items.map(s => ({
            name: s.name,
            displayName: s.displayName ?? s.name,
            description: `${s.tool ?? 'tool'}${s.version ? ` (${s.version})` : ''}`,
          })),
        );
        setAttached(
          skills.items
            .filter(s => appliedSkills.has(s.name))
            .map(s => ({
              name: s.name,
              displayName: s.displayName ?? s.name,
              description: `${s.tool ?? 'tool'}${s.version ? ` (${s.version})` : ''}`,
            })),
        );
        setErrorMessage(undefined);
      } catch (err) {
        if (!cancelled) {
          setErrorMessage((err as Error).message);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [awName, awNamespace, get]);

  return {
    resourceLabel: 'Skills',
    available,
    attached,
    // Save is intentionally a no-op until v1.6.0 ships
    // spec.skillRefs. The tooltip below explains why.
    onSave: async () => {
      throw new Error('SkillBinding patch model ships in v1.6.0');
    },
    errorMessage,
    saveDisabledTooltip:
      'Skill attachment via drag-drop ships in operator v1.6.0 (spec.skillRefs on AgentWorkstation). Until then, attach Skills by creating/editing SkillBinding CRs directly.',
  };
};
