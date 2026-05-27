# agentworkstation-binder-save — registration notes

The Software Template in this directory is consumed by the
**agentworkstation-binders** Backstage plugin's "Save" button. The
template itself doesn't appear in the Templates page (it's marked
`tags: [internal]` and not meant for manual invocation).

## Make RHDH load this template

Two ways. Pick whichever fits your gitops workflow.

### Option A — add a catalog Location to the existing app-config

Edit `cluster/rhdh/dynamic-plugins-configmap.yaml` (or the rendered
`v1-developer-hub-app-config` ConfigMap if it's not gitops-managed
yet) and append to `catalog.locations[]`:

```yaml
catalog:
  locations:
    # ... existing locations ...
    - target: https://github.com/enterprisewebservice/agent-office/blob/main/templates/agentworkstation-binder-save/template.yaml
      type: url
      rules:
        - allow: [Template]
```

Restart the dev-hub pod to pick up the new location:

```sh
oc -n rhdh-test rollout restart deploy/v1-developer-hub
```

### Option B — register via the operator's catalog endpoint

The operator already serves a `Resource`-only catalog at
`http://agent-office-backstage-catalog.agent-office-operator.svc.cluster.local/backstage/catalog.yaml`.
Extending that to also serve operator-curated `Template` entities is
a small operator change (a v1.5.3 or v1.6.0 release): emit a
`Template` entity for this template in the same catalog payload, and
update the location's `rules.allow` to include `Template`.

Cleaner long-term — keeps the templates list in lockstep with the
operator's actual capabilities — but requires an operator release.
Option A is faster.

## Why this template is a thin pass-through

The plugin (`rhdh-plugins/agentworkstation-binders/`) composes the
entire new YAML content client-side from the user's drag-drop edits
in the `<BindingPanel>` component. The template just needs to:

1. Fetch the gitops repo into the workspace.
2. Overwrite the target file with the supplied content.
3. Open a PR.

All three are stock Scaffolder actions; no custom backend plugin.
Future versions of the binder plugin may move to a richer template
(per-binding-type validation, conflict detection, etc.) — for now
the simple shape keeps the round-trip fast.

## Testing the template registration

After registration:

```sh
oc -n rhdh-test exec deploy/v1-developer-hub -c backend -- \
  curl -s http://localhost:7007/api/catalog/entities/by-name/template/default/agentworkstation-binder-save
```

Should return the template JSON. If you get `404`, the location
hasn't been ingested yet — restart the dev-hub pod or wait for the
30-min catalog refresh.
