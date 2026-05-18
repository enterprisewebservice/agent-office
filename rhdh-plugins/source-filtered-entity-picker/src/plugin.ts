/*
 * Plugin registration.
 *
 * IMPORTANT (v0.0.2 fix): DO NOT import `scaffolderPlugin` from
 * `@backstage/plugin-scaffolder`. Doing so pulls the entire
 * scaffolder frontend plugin into the dynamic chunk that scalprum
 * loads at runtime. The host RHDH app already has its own
 * scaffolder plugin loaded — when our chunk evaluates, Backstage's
 * plugin registry sees two plugins with id 'scaffolder' and throws:
 *
 *   Error: Duplicate plugin found 'scaffolder'
 *
 * That error bricks the entire frontend (blank page).
 *
 * The right pattern for a dynamic field-extension plugin: export
 * the bare `FieldExtension` descriptor produced by
 * `createScaffolderFieldExtension`. RHDH's dynamic loader reads
 * the `scaffolderFieldExtensions` entry in our config and wires it
 * into the host scaffolder. No `scaffolderPlugin.provide()` needed
 * — that's a static-app pattern.
 */
import { createScaffolderFieldExtension } from '@backstage/plugin-scaffolder-react';
import { SourceFilteredEntityPicker } from './SourceFilteredEntityPicker';

export const sourceFilteredEntityPickerFieldExtension =
  createScaffolderFieldExtension({
    component: SourceFilteredEntityPicker,
    name: 'SourceFilteredEntityPicker',
  });
