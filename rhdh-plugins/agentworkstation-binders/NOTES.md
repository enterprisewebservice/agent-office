# agentworkstation-binders — post-scaffold steps

This plugin is scaffolded but needs four out-of-band steps before
the Save button works end-to-end. None require code changes; all are
"register this thing with that thing."

## 1. Create the Konflux Component

The `.tekton/agentworkstation-binders-on-push.yaml` pipeline is
already committed and will trigger on plugin-source pushes. But
Konflux needs a `Component` CR in the `default-tenant` namespace so
it knows what application this is part of. Create via the Konflux
UI (https://console.dev.redhat.com/application-pipeline/) under the
existing `agent-office` Application:

  - Component name: `agentworkstation-binders`
  - Application:    `agent-office`
  - Git repo:       `https://github.com/enterprisewebservice/agent-office`
  - Context dir:    `rhdh-plugins/agentworkstation-binders`
  - Dockerfile:     `rhdh-plugins/agentworkstation-binders/Dockerfile`

The on-push pipeline will trigger automatically after.

## 2. Register the Software Template

The Save button calls a Scaffolder template named
`agentworkstation-binder-save`. The template YAML is committed at
`templates/agentworkstation-binder-save/template.yaml`. RHDH needs
to ingest it — see that directory's NOTES.md for two registration
options (catalog location URL vs operator-served).

## 3. Add the dynamic-plugin entry once Konflux builds the OCI image

After the first successful Konflux build pushes
`quay.io/.../agent-office-agentworkstation-binders:v0.0.1`, add this
block to `cluster/rhdh/dynamic-plugins-configmap.yaml`:

```yaml
# agentworkstation-binders — drag-drop UI to attach KnowledgeBases,
# MemoryModules, and Skills to AgentWorkstations from the entity
# page. Three tabs share a single reusable <BindingPanel> component.
# Skills tab is read-only until operator v1.6.0 normalizes
# SkillBinding into spec.skillRefs.
- package: "oci://quay-quay-quay-test.apps.salamander.aimlworkbench.com/deanpeterson/agent-office-agentworkstation-binders:v0.0.1!agent-office-backstage-plugin-agentworkstation-binders"
  disabled: false
  pluginConfig:
    proxy:
      endpoints:
        /agent-office-binders:
          target: http://agent-office-backstage-catalog.agent-office-operator.svc.cluster.local
          changeOrigin: true
    dynamicPlugins:
      frontend:
        agent-office-backstage-plugin-agentworkstation-binders:
          mountPoints:
            - mountPoint: entity.page.overview/cards
              importName: AgentBindingsCard
              module: PluginRoot
              config:
                layout:
                  gridColumnEnd:
                    lg: "span 12"
                    md: "span 12"
                    xs: "span 12"
                if:
                  anyOf:
                    - hasAnnotation: agentoffice.ai/agent-kind
```

Then restart RHDH:

```sh
oc -n rhdh-test rollout restart deploy/v1-developer-hub
```

## 4. Add the operator's binder-proxy endpoints (NEXT)

The plugin assumes the operator exposes these endpoints at
`http://agent-office-backstage-catalog.agent-office-operator.svc.cluster.local`
(reached via the `/api/proxy/agent-office-binders` Backstage proxy):

  GET /namespaces/<ns>/knowledgebases
  GET /namespaces/<ns>/memorymodules
  GET /namespaces/<ns>/skills
  GET /namespaces/<ns>/skillbindings
  GET /namespaces/<ns>/agentworkstations/<name>
  GET /namespaces/<ns>/agentworkstations/<name>/gitops-source

The first 5 list/get the corresponding CRs (operator can use its
own informers to serve them efficiently). The last one returns
`{repoUrl, filePath, defaultBranch}` so the plugin knows which file
in the gitops repo holds the AW manifest.

Until these endpoints exist, the plugin loads fine but each tab
shows an error banner explaining the missing endpoint. Drag-drop
still works visually for design review.

## Architecture summary

```
RHDH (v1-developer-hub pod)
  └─ dynamic-plugin: agentworkstation-binders
     └─ <AgentBindingsCard>  on entity.page.overview/cards
        └─ <Tabs>
           ├─ KnowledgeBases  → <BindingPanel strategy={useKBStrategy()} />
           ├─ MemoryModules   → <BindingPanel strategy={useMemoryStrategy()} />
           └─ Skills          → <BindingPanel strategy={useSkillStrategy()} />
        Save → scaffolderApi.scaffold({templateRef: 'agentworkstation-binder-save', values: {...}})
                              ↓
                              workflow opens PR via publish:github:pull-request
                                  ↓
                                  gitops repo merge
                                      ↓
                                      ArgoCD sync
                                          ↓
                                          AgentWorkstation updated
                                              ↓
                                              Operator reconciles bindings
```

Each binding strategy is independently shippable. KB + Memory work
end-to-end once the operator endpoints exist. Skills needs operator
v1.6.0 (spec.skillRefs normalization).
