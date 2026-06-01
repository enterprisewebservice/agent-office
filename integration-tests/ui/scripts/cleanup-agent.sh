#!/usr/bin/env bash
# Idempotent teardown for an agent created by the openclaw-agent scaffolder.
# Removes EVERYTHING the create flow makes, so the UI test leaves NO trace:
#   - GitHub repos      <name>-agent-gitops  (+ <name>-wiki when a KB was made)
#   - ArgoCD Application <name>-agent
#   - AgentWorkstation   <name>   (+ KnowledgeBase <name>-wiki)
#   - Backstage catalog Location for the gitops repo
#
# ORDER MATTERS. The repos are deleted FIRST so the agent-office
# ApplicationSet stops generating the app — otherwise it (or a last ArgoCD
# auto-sync) re-creates the AgentWorkstation while we're deleting it. Then
# each cluster resource is deleted AND WAITED ON, force-clearing a stuck
# finalizer, so the script never returns while a remnant is still resurrecting.
#
# Usage: cleanup-agent.sh <name> [namespace] [ghOwner]
set -uo pipefail
NAME="${1:?agent name required}"
NS="${2:-agent-office}"
OWNER="${3:-enterprisewebservice}"
REPO="${NAME}-agent-gitops"
WIKI_REPO="${NAME}-wiki"   # createNewKnowledgeBase publishes this + a KB CR named the same
echo "=== cleanup-agent: $NAME (ns=$NS owner=$OWNER) ==="

# delete a namespaced resource and wait for it to be GONE; if a finalizer
# wedges it, clear the finalizer and re-delete.  del_wait <kind> <name> <ns>
del_wait() {
  local kind="$1" name="$2" ns="$3" i
  oc get "$kind" "$name" -n "$ns" >/dev/null 2>&1 || return 0
  oc delete "$kind" "$name" -n "$ns" --ignore-not-found --wait=false >/dev/null 2>&1
  for i in $(seq 1 20); do
    oc get "$kind" "$name" -n "$ns" >/dev/null 2>&1 || { echo "  $kind/$name: gone"; return 0; }
    sleep 3
  done
  oc patch "$kind" "$name" -n "$ns" --type=merge -p '{"metadata":{"finalizers":[]}}' >/dev/null 2>&1
  oc delete "$kind" "$name" -n "$ns" --ignore-not-found --wait=false >/dev/null 2>&1
  echo "  $kind/$name: force-removed (finalizer cleared)"
}

# 1. GitHub repos FIRST — removes the ApplicationSet's source so it stops
#    (re)generating the ArgoCD app while we delete cluster resources.
appId=$(oc get secret -n agent-office agent-office-github-app -o jsonpath='{.data.appId}' | base64 -d)
instId=$(oc get secret -n agent-office agent-office-github-app -o jsonpath='{.data.installationId}' | base64 -d)
oc get secret -n agent-office agent-office-github-app -o jsonpath='{.data.privateKey}' | base64 -d > /tmp/ca_gh.pem
b64url(){ openssl base64 -A | tr '+/' '-_' | tr -d '='; }
now=$(date +%s)
hh=$(printf '{"alg":"RS256","typ":"JWT"}' | b64url)
pp=$(printf '{"iat":%d,"exp":%d,"iss":"%s"}' $((now-60)) $((now+300)) "$appId" | b64url)
ss=$(printf '%s.%s' "$hh" "$pp" | openssl dgst -sha256 -sign /tmp/ca_gh.pem -binary | b64url)
TOK=$(curl -s -X POST -H "Authorization: Bearer $hh.$pp.$ss" -H "Accept: application/vnd.github+json" "https://api.github.com/app/installations/$instId/access_tokens" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("token",""))')
rm -f /tmp/ca_gh.pem
if [ -n "$TOK" ]; then
  for r in "$REPO" "$WIKI_REPO"; do
    code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE -H "Authorization: Bearer $TOK" "https://api.github.com/repos/$OWNER/$r")
    case "$code" in
      204) echo "  repo $OWNER/$r: deleted" ;;
      404) echo "  repo $OWNER/$r: already absent" ;;
      403) echo "  repo $OWNER/$r: 403 (App lacks delete_repo) — delete manually" ;;
      *)   echo "  repo $OWNER/$r: delete http=$code" ;;
    esac
  done
fi

# 2. ArgoCD Application — stop it managing (and re-syncing) the resources.
del_wait applications.argoproj.io "${NAME}-agent" openshift-gitops

# 3. AgentWorkstation (+ KnowledgeBase) — wait so the v1.6.3 finalizer
#    finishes de-registering / detaching before we return.
del_wait agentworkstation "$NAME" "$NS"
del_wait knowledgebase "$WIKI_REPO" "$NS"

# 4. Backstage catalog Location — catalog:register creates one that deleting
#    the repo does NOT remove; without this a re-run hits "already exists".
RTOK=$(oc get secret agent-office-rhdh-token -n rhdh-test -o jsonpath='{.data.token}' 2>/dev/null | base64 -d)
RHDH="${RHDH_BASE_URL:-https://v1-developer-hub-rhdh-test.apps.salamander.aimlworkbench.com}"
if [ -n "${RTOK:-}" ]; then
  curl -sk -H "Authorization: Bearer $RTOK" "$RHDH/api/catalog/locations" 2>/dev/null \
    | REPO="$REPO" python3 -c 'import sys,json,os
repo=os.environ["REPO"]
try: data=json.load(sys.stdin)
except Exception: data=[]
for x in data:
    d=x.get("data",x); t=d.get("target","")
    if repo in t: print(d.get("id",""))' 2>/dev/null | while read -r lid; do
      [ -n "$lid" ] && curl -sk -o /dev/null -w "  catalog location $lid: http %{http_code}\n" -X DELETE -H "Authorization: Bearer $RTOK" "$RHDH/api/catalog/locations/$lid"
    done
fi
echo "=== cleanup-agent done: $NAME ==="
