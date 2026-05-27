/*
 * Plugin registration.
 *
 * Mirrors codex-reauth-ui's pattern: createPlugin() defines the
 * plugin's scope namespace ("agentworkstation-binders") that
 * Backstage's PluginScanner uses to register all exports as
 * mountable components under
 * `allPlugins[scope][module][importName]`. RHDH's DynamicRoot
 * walks that tree and mounts components per the dynamic-plugins
 * config's mountPoints / importName / module fields.
 *
 * No plugin-level routes (extensions) here — we only contribute an
 * entity-page card. The card is a regular React component that
 * RHDH mounts via the entity.page.overview/cards mount point.
 */
import { createPlugin } from '@backstage/core-plugin-api';

export const agentworkstationBindersPlugin = createPlugin({
  id: 'agentworkstation-binders',
});
