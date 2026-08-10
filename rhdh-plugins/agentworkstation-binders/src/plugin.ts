/*
 * Plugin registration.
 *
 * Mirrors codex-reauth-ui's pattern: createPlugin() defines the
 * plugin's scope namespace ("agentworkstation-binders") that
 * Backstage's PluginScanner uses to register all exports as
 * mountable components under
 * `allPlugins[scope][module][importName]`. RHDH's DynamicRoot
 * walks that tree and mounts components per the dynamic-plugins
 * config's mountPoints / scaffolderFieldExtensions / importName /
 * module fields.
 *
 * This plugin contributes BOTH:
 *   - AgentBindingsCard — an entity-page card, mounted via the
 *     `mountPoints` config entry (entity.page.overview/cards).
 *   - agentComposerFieldExtension — a scaffolder field extension
 *     (`ui:field: AgentComposer`), mounted via the
 *     `scaffolderFieldExtensions` config entry. NEW in v0.0.7.
 *
 * Shipping both from one plugin is exactly what codex-reauth-ui does
 * (CodexAuthCard + codexAuthPreflightFieldExtension). The card and
 * the field are independent registrations — adding the field does
 * NOT change the card.
 *
 * IMPORTANT: scaffolder host packages stay in peerDependencies (NOT
 * dependencies) so janus-cli treats them as externals — otherwise
 * the bundle re-registers @backstage/plugin-scaffolder and RHDH
 * throws "Duplicate plugin found 'scaffolder'". The field extension
 * attaches to the host's already-loaded scaffolderPlugin instance
 * via `.provide(...)`.
 */
import { createPlugin } from '@backstage/core-plugin-api';
import { createScaffolderFieldExtension } from '@backstage/plugin-scaffolder-react';
import { scaffolderPlugin } from '@backstage/plugin-scaffolder';
import { AgentComposerField } from './AgentComposerField';
import { AgentGenesisField } from './AgentGenesisField';

export const agentworkstationBindersPlugin = createPlugin({
  id: 'agentworkstation-binders',
});

// Scaffolder field extension — wired via dynamic-plugins config:
//   scaffolderFieldExtensions:
//     - importName: agentComposerFieldExtension
//       module: PluginRoot
// Then in a template: `ui:field: AgentComposer` on an object property.
export const agentComposerFieldExtension = scaffolderPlugin.provide(
  createScaffolderFieldExtension({
    component: AgentComposerField,
    name: 'AgentComposer',
  }),
);

// The one-step creator (v0.0.10): `ui:field: AgentGenesis` on the
// genesis template's single object property. Describe the job, pick
// the brain, Create — identity and wiring come from
// /catalog/recommend + /catalog/packs.
export const agentGenesisFieldExtension = scaffolderPlugin.provide(
  createScaffolderFieldExtension({
    component: AgentGenesisField,
    name: 'AgentGenesis',
  }),
);
