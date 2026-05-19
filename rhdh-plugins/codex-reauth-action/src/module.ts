/*
 * Backstage backend module that registers `codex:reauth` with the
 * host Scaffolder. RHDH's dynamic-plugin loader picks this default
 * export up via the package.json `backstage.role: backend-plugin-module`
 * + the entry point.
 */
import { createBackendModule } from '@backstage/backend-plugin-api';
import { scaffolderActionsExtensionPoint } from '@backstage/plugin-scaffolder-node/alpha';
import { createCodexReauthAction } from './actions/codexReauth';

export const codexReauthModule = createBackendModule({
  pluginId: 'scaffolder',
  moduleId: 'codex-reauth',
  register(env) {
    env.registerInit({
      deps: { scaffolderActions: scaffolderActionsExtensionPoint },
      async init({ scaffolderActions }) {
        scaffolderActions.addActions(createCodexReauthAction());
      },
    });
  },
});
