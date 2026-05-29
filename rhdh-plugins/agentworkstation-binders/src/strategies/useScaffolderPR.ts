/*
 * useScaffolderPR — shared hook the binding strategies use to open
 * a PR against the gitops repo via Backstage's scaffolder.
 *
 * Why a template-driven scaffolder call instead of a custom backend
 * action: the stock publish:github:pull-request action already handles
 * everything we need (clone, branch, commit, push, open PR with body
 * + reviewers). The template is a thin wrapper that takes our
 * strategy's "edit this file with this content" output and runs the
 * action. Saves us from shipping a backend plugin like codex-reauth
 * does.
 *
 * The template itself lives at templates/agentworkstation-binder-save/
 * in the agent-office gitops repo. The plugin assumes the template
 * is registered with name `agentworkstation-binder-save` in the
 * cluster's Backstage catalog.
 *
 * Usage:
 *   const open = useScaffolderPR();
 *   await open({
 *     awName, awNamespace,
 *     bindingType: 'kb',
 *     targetPath: 'agents/pm-agent.yaml',
 *     newContent: '... full file content after the patch ...',
 *     branchName: `aw-binder/pm-agent-kb-${Date.now()}`,
 *     title: 'pm-agent: attach knowledge-base agent-platform-capabilities',
 *     body: 'Attaches 1 KnowledgeBase via the AgentWorkstation Bindings plugin.',
 *   });
 */
import { useApi } from '@backstage/core-plugin-api';
import { scaffolderApiRef } from '@backstage/plugin-scaffolder-react';

export interface ScaffolderPROpts {
  awName: string;
  awNamespace: string;
  // 'kb' / 'memory' / 'skill' are the v0.0.3 binding edits.
  // 'identity' is the v0.0.5 SOUL+IDENTITY editor (edits the AW
  // spec.systemPrompt + spec.displayName + spec.role + capabilities
  // + emoji in a single PR — the fields that define agent uniqueness).
  // 'mcp' is the v0.0.6 Tools/MCP editor (edits spec.tools.mcpServers
  // — which MCP servers the agent calls, e.g. the GitHub MCP gateway).
  bindingType: 'kb' | 'memory' | 'skill' | 'identity' | 'mcp';
  /** Path inside the gitops repo of the file to overwrite. */
  targetPath: string;
  /** Full new content of the file after the edit. */
  newContent: string;
  /** Branch name on the gitops repo. */
  branchName: string;
  /** PR title. */
  title: string;
  /** PR body markdown. */
  body: string;
}

export const useScaffolderPR = () => {
  const scaffolderApi = useApi(scaffolderApiRef);

  return async (opts: ScaffolderPROpts) => {
    return scaffolderApi.scaffold({
      templateRef: 'template:default/agentworkstation-binder-save',
      values: {
        awName: opts.awName,
        awNamespace: opts.awNamespace,
        bindingType: opts.bindingType,
        targetPath: opts.targetPath,
        newContent: opts.newContent,
        branchName: opts.branchName,
        title: opts.title,
        body: opts.body,
      },
    });
  };
};
