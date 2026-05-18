/*
 * Public API of the Source-Filtered EntityPicker scaffolder plugin.
 *
 * The single export is `sourceFilteredEntityPickerFieldExtension`,
 * which RHDH's dynamic-plugin loader picks up and registers as a
 * scaffolder field extension named "SourceFilteredEntityPicker".
 *
 * Templates use it via `ui:field: SourceFilteredEntityPicker` on
 * any string property. Behavior matches the stock EntityPicker
 * (catalogFilter, allowArbitraryValues, etc.) with one extra
 * affordance: a filter-icon button next to the picker that opens
 * a popover. Each popover row is a source the operator emits on
 * its entities (`agentoffice.ai/model-source`), and the popover
 * narrows the dropdown to the picked source(s).
 */
export { sourceFilteredEntityPickerPlugin, sourceFilteredEntityPickerFieldExtension } from './plugin';
export { SourceFilteredEntityPicker } from './SourceFilteredEntityPicker';
