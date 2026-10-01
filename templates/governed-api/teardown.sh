#!/usr/bin/env bash
# Remove one API created by the Governed REST API template. Explicit by design:
# the ApplicationSet never deletes Applications and Applications never delete
# their resources (NOTES.md). Needs: oc (cluster-admin), gh (for the repository).
#
#   templates/governed-api/teardown.sh <name> [--keep-repo | --delete-repo]   (default: archive the repository)
#
# Deletes, in order: the GitOps Application <name>-api, the namespace api-<name>
# (backend, policies, product, key requests and approvals), the Route and the
# dashboard next to the shared gateway, the enforcement Secrets of approved
# keys, the Developer Hub catalog Location, and the GitHub repository.
set -euo pipefail
name="${1:?usage: teardown.sh <name> [--keep-repo]}"
keep_repo="${2:-}"
org=enterprisewebservice
devhub=https://v1-developer-hub-rhdh-test.apps.salamander.aimlworkbench.com
gateway_ns=api-demo
dash_ns=openshift-cluster-observability-operator

echo "== $name: GitOps application (cascades to the namespace, route and dashboard)"
oc delete applications.argoproj.io "${name}-api" -n openshift-gitops --ignore-not-found --wait=false
# belt and braces for Applications created before the finalizer existed
oc delete namespace "api-${name}" --ignore-not-found --wait=false 2>/dev/null
oc delete route "api-${name}" -n "$gateway_ns" --ignore-not-found 2>/dev/null
oc delete persesdashboard "${name}-api" -n "$dash_ns" --ignore-not-found 2>/dev/null
echo "== $name: enforcement secrets of approved keys"
oc delete secret -n kuadrant-system -l "app=${name}-api" --ignore-not-found

echo "== $name: Developer Hub catalog location"
tok=$(oc get secret agent-office-rhdh-token -n rhdh-test -o jsonpath='{.data.token}' | base64 -d)
target="https://github.com/${org}/${name}-api-gitops/tree/main/catalog-info.yaml"
ids=$(curl -sk -H "Authorization: Bearer $tok" "$devhub/api/catalog/locations" \
  | python3 -c 'import sys,json; t=sys.argv[1]; print("\n".join(l["data"]["id"] for l in json.load(sys.stdin) if l["data"]["target"]==t))' "$target")
for id in $ids; do
  curl -sk -o /dev/null -w "   location $id -> HTTP %{http_code}\n" -X DELETE -H "Authorization: Bearer $tok" "$devhub/api/catalog/locations/$id"
done
[ -n "$ids" ] || echo "   (no location registered for $target)"

if [ "$keep_repo" = "--delete-repo" ]; then
  echo "== $name: deleting GitHub repository ${org}/${name}-api-gitops"
  gh repo delete "${org}/${name}-api-gitops" --yes || echo "   (gh could not delete it)"
elif [ "$keep_repo" != "--keep-repo" ]; then
  echo "== $name: archiving GitHub repository ${org}/${name}-api-gitops (the record stays)"
  gh repo archive "${org}/${name}-api-gitops" --yes || echo "   (gh could not archive it; archive it on github.com)"
fi
echo "== done; the namespace finishes terminating in the background"
