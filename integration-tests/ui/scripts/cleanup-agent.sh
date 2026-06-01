#!/usr/bin/env bash
# Idempotent teardown for an agent created by the openclaw-agent scaffolder.
# Removes EVERYTHING the create flow makes, so the UI test leaves no trace:
#   - ArgoCD Application  <name>-agent   (cascade → AgentWorkstation + AgentGateway)
#   - AgentWorkstation    <name>         (direct, in case the app is already gone)
#   - GitHub repo         <ghOwner>/<name>-agent-gitops
#
# Usage: cleanup-agent.sh <name> [namespace] [ghOwner]
set -uo pipefail
NAME="${1:?agent name required}"
NS="${2:-agent-office}"
OWNER="${3:-enterprisewebservice}"
REPO="${NAME}-agent-gitops"
WIKI_REPO="${NAME}-wiki"   # createNewKnowledgeBase publishes this + a KB CR named the same
echo "=== cleanup-agent: $NAME (ns=$NS owner=$OWNER) ==="

# 1. ArgoCD Application — cascade removes the AW + AgentGateway it manages.
oc delete applications.argoproj.io -n openshift-gitops "${NAME}-agent" --ignore-not-found --wait=false 2>/dev/null \
  && echo "  argo app ${NAME}-agent: delete requested"

# 2. AgentWorkstation directly (covers app-absent / no-cascade). The v1.6.3
#    finalizer de-registers it from its gateway on the way out.
if oc get agentworkstation "$NAME" -n "$NS" >/dev/null 2>&1; then
  oc delete agentworkstation "$NAME" -n "$NS" --ignore-not-found --wait=false 2>/dev/null
  echo "  agentworkstation $NAME: delete requested"
fi

# 2a. KnowledgeBase CR (only when the agent was created WITH a new KB). The
#     CR is named <name>-wiki; deleting it triggers the operator's PVC +
#     gateway-detach cleanup.
if oc get knowledgebase "$WIKI_REPO" -n "$NS" >/dev/null 2>&1; then
  oc delete knowledgebase "$WIKI_REPO" -n "$NS" --ignore-not-found --wait=false 2>/dev/null
  echo "  knowledgebase $WIKI_REPO: delete requested"
fi

# 2b. Backstage catalog Location — the scaffolder's catalog:register creates
#     one; deleting the repo/AW does NOT remove it, so without this a re-run
#     hits "addLocation already exists". Find any Location targeting this
#     agent's gitops repo and delete it.
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

# 3. GitHub gitops repo — mint a short-lived App token and DELETE it.
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
echo "=== cleanup-agent done: $NAME ==="
