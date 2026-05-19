/*
 * Public surface of the codex-reauth-ui frontend plugin.
 *
 *   codexAuthPreflightFieldExtension
 *     scaffolder field extension wired via dynamic-plugins config:
 *       scaffolderFieldExtensions:
 *         - importName: codexAuthPreflightFieldExtension
 *           module: PluginRoot
 *     Then in a template:
 *       parameters:
 *         - title: Pre-flight
 *           required: [codexAuthOk]
 *           properties:
 *             codexAuthOk:
 *               type: string
 *               ui:field: CodexAuthPreflight
 *
 *   CodexAuthCard
 *     entity-page card. Wired via mountPoints in dynamic-plugins.yaml.
 */
export { codexAuthPreflightFieldExtension } from './plugin';
export { CodexAuthCard } from './CodexAuthCard';
export { CodexReauthDialog } from './CodexReauthDialog';
export { CodexAuthPreflightField } from './CodexAuthPreflightField';
