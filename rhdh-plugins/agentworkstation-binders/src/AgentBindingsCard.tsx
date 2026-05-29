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
 * v0.0.5 adds:
 *   - Identity tab — edits the AW spec fields that define agent
 *     uniqueness (displayName, role, capabilities, emoji,
 *     systemPrompt). Save → PR → operator re-renders SOUL.md +
 *     IDENTITY.md into the agent's workspace.
 *
 * Deferred:
 *   - USER.md editor — no AW spec field currently maps to USER.md,
 *     so there's nothing to edit. Will add once user-prefs land on
 *     the spec.
 *   - Markdown preview / WYSIWYG for the system-prompt editor —
 *     plain monospace textarea today; pull in a real markdown editor
 *     when the friction justifies the bundle weight.
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
import { IdentityEditorPanel } from './IdentityEditorPanel';
import { McpServersPanel } from './McpServersPanel';

type TabId = 'identity' | 'kb' | 'skill' | 'mcp';

export const AgentBindingsCard: React.FC = () => {
  const { entity } = useEntity();
  // Default to Identity tab — it's the most-commonly-edited surface
  // (system prompt tweaks, displayName changes) and it loads quickly
  // since it only reads the AW spec, not the full catalog.
  const [activeTab, setActiveTab] = useState<TabId>('identity');

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
        title="Identity, Bindings & Skills"
        subheader={`Edit ${awName}'s identity + system prompt (Identity tab), attach Knowledge Bases (KB tab), or browse the runtime skill catalog (Skills tab). Edits open a PR against the gitops repo — ArgoCD syncs and the operator re-renders into the agent's workspace.`}
      />
      <Divider />
      <Tabs
        value={activeTab}
        onChange={(_, v) => setActiveTab(v)}
        indicatorColor="primary"
        textColor="primary"
      >
        <Tab value="identity" label="Identity" />
        <Tab value="kb" label={`Knowledge Bases (${kb.attached.length})`} />
        <Tab value="skill" label="Skills (catalog)" />
        <Tab value="mcp" label="Tools / MCP" />
      </Tabs>
      <CardContent>
        <Box mt={1}>
          {activeTab === 'identity' && (
            <IdentityEditorPanel
              awName={awName}
              awNamespace={awNamespace}
            />
          )}
          {activeTab === 'kb' && <BindingPanel {...kb} />}
          {activeTab === 'skill' && <SkillCatalogPanel />}
          {activeTab === 'mcp' && (
            <McpServersPanel awName={awName} awNamespace={awNamespace} />
          )}
        </Box>
      </CardContent>
    </Card>
  );
};
