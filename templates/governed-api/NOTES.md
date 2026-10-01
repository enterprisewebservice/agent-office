# governed-api: registration, platform pieces, teardown

## What the template touches

| Piece | Where | Owner |
|---|---|---|
| The form and the skeleton | `templates/governed-api/` (this directory) | platform |
| The per-API repository `<name>-api-gitops` | github.com/enterprisewebservice | the API team (created by the template) |
| AppProject `governed-apis` (the allow-list of kinds and namespaces) and ApplicationSet `governed-apis` | `cluster/governed-apis/`, applied by `cluster/governed-apis-app.yaml` | platform |
| The shared gateway `api-demo/api-gateway` (wildcard listener, routes allowed from namespaces labelled `governed-api=true`), its Telemetry (access log with identity, tracing, path metric) | `cluster/api-demo/` | platform |
| Developer Hub audit log into Loki (`rhdh-test` in the collector input) | `cluster/logging/clusterlogforwarder.yaml` | platform |

## Make Developer Hub load the template

Same as `skill-authoring`: a catalog Location created through the API with the
`agent-office-rhdh-token` service token (namespace `rhdh-test`), target
`https://github.com/enterprisewebservice/agent-office/blob/main/templates/governed-api/template.yaml`.
Developer Hub refreshes the location on its schedule; to pick up a change to
the template immediately, open the Template entity in the catalog and use
**Refresh** (the ⟳ on the entity page).

```bash
TOK=$(oc get secret agent-office-rhdh-token -n rhdh-test -o jsonpath='{.data.token}' | base64 -d)
curl -sk -H "Authorization: Bearer $TOK" -H 'content-type: application/json' \
  https://v1-developer-hub-rhdh-test.apps.salamander.aimlworkbench.com/api/catalog/locations \
  -d '{"type":"url","target":"https://github.com/enterprisewebservice/agent-office/blob/main/templates/governed-api/template.yaml"}'
```

## Platform pieces, once per cluster

```bash
oc apply -f cluster/governed-apis-app.yaml
```

## Teardown of one API

The ApplicationSet never deletes an Application and an Application never
deletes its resources (the same safety settings as the agent ApplicationSet,
after the 2026-09-04 incident). Removing an API is therefore explicit, in this
order (`templates/governed-api/teardown.sh <name>` does all of it):

1. `oc delete application <name>-api -n openshift-gitops` (resources stay).
2. `oc delete namespace api-<name>` (backend, policies, product, key requests and approvals).
3. `oc delete route api-<name> -n api-demo`; `oc delete persesdashboard <name>-api -n openshift-cluster-observability-operator`.
4. Enforcement Secrets of approved keys: `oc delete secret -n kuadrant-system -l app=<name>-api`.
5. Developer Hub: delete the catalog Location whose target is the repository's `catalog-info.yaml` (otherwise re-creating the API answers 409 at "Register in the catalog").
6. Archive or delete the GitHub repository `enterprisewebservice/<name>-api-gitops`.

## Why the backend is a mock by default

Sean (Best Buy Canada, 29 Sep 2026) asked about mocks ("commonly used, not
make or break"). A mock generated from the contract gives a real endpoint, with
the real governance in front of it, before a line of the implementation
exists; the switch to the implementation is the image line in
`gitops/backend.yaml`. Prism is a community project and is labelled as such on
the form.
