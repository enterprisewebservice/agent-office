/*
 * Public API of the Source-Filtered EntityPicker scaffolder plugin.
 *
 * The single critical export is `sourceFilteredEntityPickerFieldExtension`,
 * which RHDH's dynamic-plugin loader picks up and registers as a
 * scaffolder field extension named "SourceFilteredEntityPicker".
 *
 * Templates use it via `ui:field: SourceFilteredEntityPicker` on
 * any string property. Behavior matches the stock EntityPicker
 * (catalogFilter, etc.) plus a filter-icon button next to the
 * picker that opens a popover for narrowing by source annotation.
 */
export { sourceFilteredEntityPickerFieldExtension } from './plugin';
export { SourceFilteredEntityPicker } from './SourceFilteredEntityPicker';
