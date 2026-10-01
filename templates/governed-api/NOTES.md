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

## Retiring one API

Since 1 Oct 2026 the generated Application carries the resources finalizer, so
a *deliberate* delete of the Application cascades. The generator itself never
deletes Applications (`applicationsSync: create-update`) and would strip the
finalizer first if it ever did (`preserveResourcesOnDeletion: true`), so a
generator blip (the 2026-09-04 incident) cannot cascade; only a human can.
Retiring an API is therefore, in this order (`templates/governed-api/teardown.sh <name>`
does all of it):

1. Remove `argocd/applicationset-managed` from the repository: the generator
   stops matching and, with create-update, leaves the running Application alone.
   `main` is protected in the org, so this is a one-line pull request; the
   script opens it and stops until it is merged. Skip this and the generator
   re-creates the Application about 60 s after step 3. Archiving alone does not
   help: the GitHub SCM provider lists archived repositories too.
2. Developer Hub: the component's `⋮` menu → **Unregister entity** (removes the
   Component, the API and their Location; audited as `location-mutate`). The
   script deletes the Location through the catalog API instead. Either way the
   Location must go, or re-creating the API answers 409 at "Register in the catalog".
3. OpenShift GitOps: delete the Application `<name>-api` (console **Delete**,
   Foreground, or `oc delete applications.argoproj.io <name>-api -n openshift-gitops`;
   plain `application` is ambiguous on this cluster). The finalizer takes the
   namespace `api-<name>` (backend, policies, product, key requests, approvals),
   the Route next to the gateway and the dashboard with it.
4. Enforcement Secrets of approved keys live in `kuadrant-system`, outside the
   cascade (inert once the AuthPolicy is gone): `oc delete secret -n kuadrant-system -l app=<name>-api`.
5. Archive the repository: it stays as the record.

## Why the backend is a mock by default

Sean (Best Buy Canada, 29 Sep 2026) asked about mocks ("commonly used, not
make or break"). A mock generated from the contract gives a real endpoint, with
the real governance in front of it, before a line of the implementation
exists; the switch to the implementation is the image line in
`gitops/backend.yaml`. Prism is a community project and is labelled as such on
the form.
