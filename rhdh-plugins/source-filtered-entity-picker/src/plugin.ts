/*
 * Plugin registration.
 *
 * v0.0.3 lesson: RHDH's DynamicRoot.tsx walks
 * `allPlugins[scope][module][importName]` and treats the result
 * as a *renderable Extension component* (it ends up under
 * `<ScaffolderFieldExtensions>{Component}</ScaffolderFieldExtensions>`).
 * That Extension component is exactly what
 * `scaffolderPlugin.provide(createScaffolderFieldExtension(...))`
 * returns. Exporting the bare `createScaffolderFieldExtension(...)`
 * result (a `FieldExtensionOptions` object) doesn't work — the
 * dropdown silently never renders.
 *
 * The v0.0.1 build hit "Duplicate plugin found 'scaffolder'" not
 * because of the `.provide()` call itself but because
 * `@backstage/plugin-scaffolder` was in `dependencies` (so janus-cli
 * bundled the whole plugin into our chunk and its self-registration
 * ran a second time when the chunk loaded). v0.0.3 moves the
 * Backstage host packages to `peerDependencies` so janus-cli treats
 * them as externals — the host's already-loaded `scaffolderPlugin`
 * instance is the one we attach to.
 */
import { createScaffolderFieldExtension } from '@backstage/plugin-scaffolder-react';
import { scaffolderPlugin } from '@backstage/plugin-scaffolder';
import { SourceFilteredEntityPicker } from './SourceFilteredEntityPicker';

export const sourceFilteredEntityPickerFieldExtension =
  scaffolderPlugin.provide(
    createScaffolderFieldExtension({
      component: SourceFilteredEntityPicker,
      name: 'SourceFilteredEntityPicker',
    }),
  );
