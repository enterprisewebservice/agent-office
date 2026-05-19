/*
 * Public surface of the codex-reauth-action plugin.
 *
 * RHDH's dynamic-plugin loader picks up the `default` export as the
 * backend module to register against the host Scaffolder, via the
 * scaffolder.actions.v1 extension point that ./module.ts subscribes
 * to.
 */
import { codexReauthModule } from './module';

export { createCodexReauthAction } from './actions/codexReauth';

export default codexReauthModule;
