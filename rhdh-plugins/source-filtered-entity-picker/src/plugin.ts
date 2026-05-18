/*
 * Plugin registration. Backstage's @scaffolder/react `scaffolderPlugin`
 * exposes a `provide(createScaffolderFieldExtension(...))` factory
 * for installing a custom field extension. We re-export the result
 * so RHDH's dynamic loader can mount it from this plugin's frontend
 * scope.
 *
 * Dynamic-plugin config in v1-dynamic-plugins ConfigMap will use:
 *
 *   dynamicPlugins:
 *     frontend:
 *       agent-office.backstage-plugin-source-filtered-entity-picker:
 *         scaffolderFieldExtensions:
 *           - importName: sourceFilteredEntityPickerFieldExtension
 *             module: PluginRoot
 */
import {
  scaffolderPlugin,
  createScaffolderFieldExtension,
} from '@backstage/plugin-scaffolder-react';
import { SourceFilteredEntityPicker } from './SourceFilteredEntityPicker';

// Re-export the underlying scaffolder plugin so RHDH's frontend
// loader has something to attach the extension to.
export { scaffolderPlugin as sourceFilteredEntityPickerPlugin };

export const sourceFilteredEntityPickerFieldExtension = scaffolderPlugin.provide(
  createScaffolderFieldExtension({
    component: SourceFilteredEntityPicker,
    name: 'SourceFilteredEntityPicker',
  }),
);
