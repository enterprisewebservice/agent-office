/*
 * <AgentBindingsCard>
 *
 * The entity-page card mounted by RHDH on AgentWorkstation Component
 * entities. Renders three sub-tabs, each an instance of <BindingPanel>:
 *
 *   - Knowledge Bases  → v1.5.0 spec.knowledgeBaseRefs
 *   - Memory Modules   → existing spec.memory.modules
 *   - Skills           → sibling SkillBinding CRs
 *
 * Each tab is wired by a strategy hook (useKBStrategy, etc.) that
 * lists the available resources via the in-cluster catalog proxy,
 * reads the current attachments from the AW spec / SkillBinding CRs,
 * and on Save composes a publish:github:pull-request scaffolder task
 * with the right YAML patch.
 *
 * Tonight's MVP: all three tabs render and call the same strategy
 * pattern. KB + Memory tabs have working Save; Skills tab is
 * scaffolded with a tooltip explaining that the SkillBinding patch
 * model is asymmetric and ships in a follow-up.
 */
import React, { useState } from 'react';
import {
  Box,
  Tab,
  Tabs,
  Card,
  CardHeader,
  CardContent,
  Divider,
} from '@material-ui/core';
import { useEntity } from '@backstage/plugin-catalog-react';
import { BindingPanel } from './BindingPanel';
import { useKnowledgeBaseStrategy } from './strategies/useKnowledgeBaseStrategy';
import { useMemoryModuleStrategy } from './strategies/useMemoryModuleStrategy';
import { useSkillStrategy } from './strategies/useSkillStrategy';

type TabId = 'kb' | 'memory' | 'skill';

export const AgentBindingsCard: React.FC = () => {
  const { entity } = useEntity();
  const [activeTab, setActiveTab] = useState<TabId>('kb');

  // The AW name + namespace come from the entity's metadata.
  //
  // Default: entity.metadata.name IS the AgentWorkstation name (works
  // for the common case where one Backstage Component entity maps 1:1
  // to one AgentWorkstation CR — e.g. pm-agent, taskmaster,
  // permission-probe).
  //
  // Override: if the entity is something OTHER than an AW (e.g. an
  // AutoResearchProject parent entity whose actual agent lives at
  // <project>-experimenter), the entity can declare which AW to bind
  // against via the `agentoffice.ai/agentworkstation-name` annotation.
  // That lets the karpathy template (and future templates) point
  // project entities at their associated experimenter AW without
  // changing the entity name.
  //
  // Namespace defaults to agent-office; overridable via
  // `agentoffice.ai/namespace`.
  const annotations = entity.metadata.annotations ?? {};
  const awName =
    annotations['agentoffice.ai/agentworkstation-name'] ??
    entity.metadata.name;
  const awNamespace =
    annotations['agentoffice.ai/namespace'] ?? 'agent-office';

  const kb = useKnowledgeBaseStrategy({ awName, awNamespace });
  const memory = useMemoryModuleStrategy({ awName, awNamespace });
  const skill = useSkillStrategy({ awName, awNamespace });

  return (
    <Card>
      <CardHeader
        title="Bindings"
        subheader={`Attach Knowledge Bases, Memory Modules, and Skills to ${awName}. Drag from the LEFT panel onto the RIGHT panel. Save opens a PR against the gitops repo so changes flow through ArgoCD with full audit trail.`}
      />
      <Divider />
      <Tabs
        value={activeTab}
        onChange={(_, v) => setActiveTab(v)}
        indicatorColor="primary"
        textColor="primary"
      >
        <Tab value="kb" label={`Knowledge Bases (${kb.attached.length})`} />
        <Tab
          value="memory"
          label={`Memory Modules (${memory.attached.length})`}
        />
        <Tab value="skill" label={`Skills (${skill.attached.length})`} />
      </Tabs>
      <CardContent>
        <Box mt={1}>
          {activeTab === 'kb' && <BindingPanel {...kb} />}
          {activeTab === 'memory' && <BindingPanel {...memory} />}
          {activeTab === 'skill' && <BindingPanel {...skill} />}
        </Box>
      </CardContent>
    </Card>
  );
};
