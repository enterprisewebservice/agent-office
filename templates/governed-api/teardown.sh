#!/usr/bin/env bash
# Retire one API created by the Governed REST API template (NOTES.md, "Retiring one API").
# Needs: oc (cluster-admin), gh (repository + pull request), python3.
#
#   templates/governed-api/teardown.sh <name> [--keep-repo | --delete-repo]   (default: archive the repository)
#
# Order matters: the deploy marker must be gone from the repository before the
# Application is deleted, or the ApplicationSet re-creates it a minute later.
set -euo pipefail
name="${1:?usage: teardown.sh <name> [--keep-repo | --delete-repo]}"
repo_mode="${2:-}"
org=enterprisewebservice
repo="${org}/${name}-api-gitops"
devhub=https://v1-developer-hub-rhdh-test.apps.salamander.aimlworkbench.com
marker=argocd/applicationset-managed

echo "== $name: deploy marker in $repo"
if sha=$(gh api "repos/$repo/contents/$marker" -q .sha 2>/dev/null); then
  if gh api -X DELETE "repos/$repo/contents/$marker" -f message="Retire the ${name} API: remove the deploy marker" -f sha="$sha" >/dev/null 2>&1; then
    echo "   removed on main"
  else
    # main is protected: a one-line pull request, merged by a human
    base=$(gh api "repos/$repo/git/ref/heads/main" -q .object.sha)
    gh api -X POST "repos/$repo/git/refs" -f ref=refs/heads/retire -f sha="$base" >/dev/null 2>&1 || true
    gh api -X DELETE "repos/$repo/contents/$marker" -f branch=retire -f message="Retire the ${name} API: remove the deploy marker" -f sha="$sha" >/dev/null
    url=$(gh pr create -R "$repo" --base main --head retire --title "Retire the ${name} API" \
      --body "Removes \`$marker\`; the governed-apis ApplicationSet then forgets this repository and deleting the Application in OpenShift GitOps is final.")
    echo "   main is protected: merge $url and run this script again"
    exit 2
  fi
else
  echo "   not present (already retired, or the repository is gone)"
fi

echo "== $name: GitOps application (the finalizer cascades to the namespace, the route and the dashboard)"
oc delete applications.argoproj.io "${name}-api" -n openshift-gitops --ignore-not-found --wait=false
echo "== $name: enforcement secrets of approved keys"
oc delete secret -n kuadrant-system -l "app=${name}-api" --ignore-not-found

echo "== $name: Developer Hub catalog location"
tok=$(oc get secret agent-office-rhdh-token -n rhdh-test -o jsonpath='{.data.token}' | base64 -d)
target="https://github.com/${repo}/tree/main/catalog-info.yaml"
ids=$(curl -sk -H "Authorization: Bearer $tok" "$devhub/api/catalog/locations" \
  | python3 -c 'import sys,json; t=sys.argv[1]; print("\n".join(l["data"]["id"] for l in json.load(sys.stdin) if l["data"]["target"]==t))' "$target")
for id in $ids; do
  curl -sk -o /dev/null -w "   location $id -> HTTP %{http_code}\n" -X DELETE -H "Authorization: Bearer $tok" "$devhub/api/catalog/locations/$id"
done
[ -n "$ids" ] || echo "   (no location registered for $target; already unregistered)"

case "$repo_mode" in
  --keep-repo) ;;
  --delete-repo) echo "== $name: deleting repository $repo"; gh repo delete "$repo" --yes || echo "   (gh could not delete it)";;
  *) echo "== $name: archiving repository $repo (the record stays)"; gh repo archive "$repo" --yes || echo "   (gh could not archive it)";;
esac
echo "== done; the namespace finishes terminating in the background"
