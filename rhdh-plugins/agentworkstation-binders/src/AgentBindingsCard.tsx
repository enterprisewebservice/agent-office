/*
 * <AgentBindingsCard>
 *
 * The entity-page card mounted by RHDH on AgentWorkstation Component
 * entities. v0.0.4 restructures the tabs around the v1.6.0 discovery
 * architecture:
 *
 *   - Knowledge Bases  → v1.5.0 spec.knowledgeBaseRefs
 *                         (still bound — KBs are intentionally
 *                         explicit per agent)
 *   - Skills           → READ-ONLY catalog browser
 *                         (skills are no longer bound via this plugin;
 *                         every agent sees the full local catalog
 *                         rendered into its workspace and picks at
 *                         runtime via progressive disclosure)
 *
 * Removed in v0.0.4:
 *   - Memory Modules tab — memories are AAIF-rendered from AW spec
 *     fields (systemPrompt → SOUL.md, displayName → IDENTITY.md,
 *     etc.); there's no per-agent memory binding to manage in the UI.
 *
 * Deferred to v0.0.5 (slice 2 of v1.6.0 #6):
 *   - SOUL.md / IDENTITY.md / USER.md editor — friendly form for the
 *     AW spec fields that define agent uniqueness, with markdown
 *     preview + Save-via-scaffolder-PR.
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
import { SkillCatalogPanel } from './SkillCatalogPanel';

type TabId = 'kb' | 'skill';

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

  return (
    <Card>
      <CardHeader
        title="Bindings & Skills"
        subheader={`Attach Knowledge Bases to ${awName} (drag from LEFT to RIGHT, Save opens a PR). The Skills tab is a read-only browse of the runtime catalog — skills are no longer bound per-agent; every agent sees the full catalog and picks at runtime via progressive disclosure.`}
      />
      <Divider />
      <Tabs
        value={activeTab}
        onChange={(_, v) => setActiveTab(v)}
        indicatorColor="primary"
        textColor="primary"
      >
        <Tab value="kb" label={`Knowledge Bases (${kb.attached.length})`} />
        <Tab value="skill" label="Skills (catalog)" />
      </Tabs>
      <CardContent>
        <Box mt={1}>
          {activeTab === 'kb' && <BindingPanel {...kb} />}
          {activeTab === 'skill' && <SkillCatalogPanel />}
        </Box>
      </CardContent>
    </Card>
  );
};
