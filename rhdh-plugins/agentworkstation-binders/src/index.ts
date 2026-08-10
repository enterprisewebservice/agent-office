/*
 * Public surface of the agentworkstation-binders frontend plugin.
 *
 * Exports:
 *   AgentBindingsCard
 *     The main entity-page card. Renders on AgentWorkstation Component
 *     entities (discriminated by the agentoffice.ai/agent-kind
 *     annotation). Hosts three tabs:
 *       - Knowledge Bases   → writes spec.knowledgeBaseRefs (v1.5.0+)
 *       - Memory Modules    → writes spec.memory.modules (existing)
 *       - Skills            → creates/edits sibling SkillBinding CRs
 *
 *     Mount via dynamic-plugins config:
 *
 *       agent-office-backstage-plugin-agentworkstation-binders:
 *         mountPoints:
 *           - mountPoint: entity.page.overview/cards
 *             importName: AgentBindingsCard
 *             module: PluginRoot
 *             config:
 *               if:
 *                 anyOf:
 *                   - hasAnnotation: agentoffice.ai/agent-kind
 *
 *   BindingPanel
 *     Reusable React component the three tabs are instances of.
 *     Exported so other plugins can compose similar drag-drop UIs
 *     against new binding types (e.g. PromptTemplateRef when that
 *     shipping in a future operator version).
 *
 *   agentComposerFieldExtension  (v0.0.7)
 *     Scaffolder field extension — the SAME binder experience inside
 *     the create wizard. Wired via dynamic-plugins config:
 *
 *       agent-office-backstage-plugin-agentworkstation-binders:
 *         scaffolderFieldExtensions:
 *           - importName: agentComposerFieldExtension
 *             module: PluginRoot
 *
 *     Then in a template:
 *       parameters:
 *         - title: Compose the agent
 *           properties:
 *             compose:
 *               type: object
 *               ui:field: AgentComposer
 *
 *   AgentComposerField
 *     The raw component (exported for completeness / testing).
 */
export { AgentBindingsCard } from './AgentBindingsCard';
export { BindingPanel } from './BindingPanel';
export { agentComposerFieldExtension, agentGenesisFieldExtension } from './plugin';
export { AgentComposerField } from './AgentComposerField';
export { AgentGenesisField } from './AgentGenesisField';
