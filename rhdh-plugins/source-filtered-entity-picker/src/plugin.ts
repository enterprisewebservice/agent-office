/*
 * Plugin registration.
 *
 * Backstage 1.45 splits the scaffolder frontend across two packages:
 *
 *  - `@backstage/plugin-scaffolder`         → the `scaffolderPlugin`
 *    instance (the runtime hook RHDH's app uses to mount the
 *    Scaffolder UI), which exposes `.provide(...)` for registering
 *    plugins-with-extensions.
 *
 *  - `@backstage/plugin-scaffolder-react`   → the SDK used by field
 *    extension authors. Exports `createScaffolderFieldExtension`
 *    + `FieldExtensionComponentProps`.
 *
 * We grab the plugin from the first, the factory from the second.
 */
import { createScaffolderFieldExtension } from '@backstage/plugin-scaffolder-react';
import { scaffolderPlugin } from '@backstage/plugin-scaffolder';
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
