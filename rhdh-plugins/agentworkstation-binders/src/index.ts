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
 */
export { AgentBindingsCard } from './AgentBindingsCard';
export { BindingPanel } from './BindingPanel';
