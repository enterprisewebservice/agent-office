/*
 * Plugin registration.
 *
 * RHDH's DynamicRoot walks `allPlugins[scope][module][importName]`
 * and treats each found export as a renderable component, mounting
 * it according to whatever extension the dynamic-plugins config
 * declares (`scaffolderFieldExtensions`, `mountPoints`, etc.).
 *
 * Exports below:
 *   - codexAuthPreflightFieldExtension: a scaffolder field extension
 *     that wraps CodexAuthPreflightField. Use as `ui:field:
 *     CodexAuthPreflight` in a template's parameters block.
 *   - CodexAuthCard: a regular React component pointed at by a
 *     mountPoints entry that puts it on AgentWorkstation entity
 *     pages (`entity.page.overview/cards`).
 *
 * The frontend plugin role we attach to is `scaffolderPlugin` from
 * @backstage/plugin-scaffolder — same as source-filtered-entity-picker.
 */
import { createScaffolderFieldExtension } from '@backstage/plugin-scaffolder-react';
import { scaffolderPlugin } from '@backstage/plugin-scaffolder';
import { CodexAuthPreflightField } from './CodexAuthPreflightField';

export const codexAuthPreflightFieldExtension = scaffolderPlugin.provide(
  createScaffolderFieldExtension({
    component: CodexAuthPreflightField,
    name: 'CodexAuthPreflight',
  }),
);
