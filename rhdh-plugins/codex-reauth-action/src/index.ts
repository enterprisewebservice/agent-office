/*
 * Public surface of the codex-reauth backend plugin.
 *
 * Default export is the backend plugin instance — RHDH's dynamic-
 * plugin loader picks it up via the package.json
 * `backstage.role: backend-plugin` and mounts the plugin's HTTP
 * router at /api/codex-reauth/.
 */
import { codexReauthPlugin } from './plugin';

export { writeCodexAuthJson } from './vault';

export default codexReauthPlugin;
