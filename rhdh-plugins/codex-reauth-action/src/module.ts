/*
 * Backstage backend module that registers `codex:reauth` with the
 * host Scaffolder. RHDH's dynamic-plugin loader picks this default
 * export up via the package.json `backstage.role: backend-plugin-module`
 * + the entry point.
 */
import { createBackendModule } from '@backstage/backend-plugin-api';
// Import from the main entry.
//
// History: scaffolderActionsExtensionPoint lived in the main
// entry of @backstage/plugin-scaffolder-node up through ~0.4,
// moved to /alpha around v0.5, and was promoted back to the
// main entry by v0.12 (which is what RHDH 1.x ships). Pinning
// the devDep to ^0.12.0 so build-time tsc agrees with what's
// running on the cluster — otherwise the bundle resolved
// `/alpha.scaffolderActionsExtensionPoint = undefined` at
// runtime and the host crashed reading `.id` off it.
import { scaffolderActionsExtensionPoint } from '@backstage/plugin-scaffolder-node';
import { createCodexReauthAction } from './actions/codexReauth';

export const codexReauthModule = createBackendModule({
  pluginId: 'scaffolder',
  moduleId: 'codex-reauth',
  register(env) {
    env.registerInit({
      deps: { scaffolder: scaffolderActionsExtensionPoint },
      async init({ scaffolder }) {
        scaffolder.addActions(createCodexReauthAction());
      },
    });
  },
});
