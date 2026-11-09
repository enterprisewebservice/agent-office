#!/usr/bin/env bash
# Idempotent teardown for an agent created by the openclaw-agent scaffolder.
# Removes EVERYTHING the create flow makes, so the UI test leaves NO trace:
#   - GitHub repos      <name>-agent-gitops  (+ <name>-wiki when a KB was made)
#   - ArgoCD Application <name>-agent
#   - AgentWorkstation   <name>   (+ KnowledgeBase <name>-wiki)
#   - Backstage catalog Location for the gitops repo
#   - the agent's DEDICATED AgentGateway (<name>-gateway, or whatever its
#     gatewayRef names) when no other AgentWorkstation still runs on it
#
# WHY THE GATEWAY STEP (9 Nov 2026): the operator never owns a gateway —
# a gateway is a declarative object several agents may share, so the
# AgentWorkstation finalizer only de-registers the agent. The ApplicationSet
# keeps resources on Application deletion (preserveResourcesOnDeletion) and
# its Applications carry no resources finalizer, so neither deleting the repo
# nor deleting the Application removes anything. A scaffolded "dedicated"
# agent declares its own AgentGateway next to the AgentWorkstation; after the
# workstation is gone that gateway (with its pod, PVC, service, secret and
# config) is a remnant unless this script deletes it.
#
# Repos live on GitHub by default. For an agent published to Gitea (the
# per-user orgs), set GITEA_API=https://<gitea>/api/v1 and pass the org as
# ghOwner; the token comes from GITEA_TOKEN or, failing that, the secret
# openshift-gitops/agent-office-gitea-scm. DRY_RUN=1 prints every decision
# and deletes nothing.
#
# ORDER MATTERS. The repos are deleted FIRST so the agent-office
# ApplicationSet stops generating the app — otherwise it (or a last ArgoCD
# auto-sync) re-creates the AgentWorkstation while we're deleting it. Then
# each cluster resource is deleted AND WAITED ON, force-clearing a stuck
# finalizer, so the script never returns while a remnant is still resurrecting.
#
# Usage: [DRY_RUN=1] [GITEA_API=...] cleanup-agent.sh <name> [namespace] [ghOwner|giteaOrg]
set -uo pipefail
NAME="${1:?agent name required}"
NS="${2:-agent-office}"
OWNER="${3:-enterprisewebservice}"
REPO="${NAME}-agent-gitops"
WIKI_REPO="${NAME}-wiki"   # createNewKnowledgeBase publishes this + a KB CR named the same
DRY_RUN="${DRY_RUN:-}"
GITEA_API="${GITEA_API:-}"
echo "=== cleanup-agent: $NAME (ns=$NS owner=$OWNER${GITEA_API:+ gitea=$GITEA_API}${DRY_RUN:+ DRY RUN}) ==="

# The gateway this agent runs on, read BEFORE the workstation is deleted;
# falls back to the scaffolder's dedicated name when the workstation is
# already gone (a half-finished earlier teardown).
GW=$(oc get agentworkstation "$NAME" -n "$NS" -o jsonpath='{.spec.runtime.shared.gatewayRef}' 2>/dev/null || true)
[ -n "$GW" ] || GW="${NAME}-gateway"

# gateway_in_use <gateway> <ns>: succeeds when another AgentWorkstation in
# the namespace still points at it (then it is shared and must stay).
gateway_in_use() {
  oc get agentworkstation -n "$2" -o json 2>/dev/null \
    | GW="$1" SELF="$NAME" python3 -c 'import sys,json,os
gw=os.environ["GW"]; me=os.environ["SELF"]
items=json.load(sys.stdin).get("items",[])
others=[i["metadata"]["name"] for i in items if i["metadata"]["name"]!=me
        and ((i.get("spec",{}).get("runtime") or {}).get("shared") or {}).get("gatewayRef")==gw]
print(",".join(others)); sys.exit(0 if others else 1)'
}

# delete a namespaced resource and wait for it to be GONE; if a finalizer
# wedges it, clear the finalizer and re-delete.  del_wait <kind> <name> <ns>
del_wait() {
  local kind="$1" name="$2" ns="$3" i
  oc get "$kind" "$name" -n "$ns" >/dev/null 2>&1 || { echo "  $kind/$name: already absent"; return 0; }
  if [ -n "$DRY_RUN" ]; then echo "  $kind/$name: would delete (dry run)"; return 0; fi
  oc delete "$kind" "$name" -n "$ns" --ignore-not-found --wait=false >/dev/null 2>&1
  for i in $(seq 1 20); do
    oc get "$kind" "$name" -n "$ns" >/dev/null 2>&1 || { echo "  $kind/$name: gone"; return 0; }
    sleep 3
  done
  oc patch "$kind" "$name" -n "$ns" --type=merge -p '{"metadata":{"finalizers":[]}}' >/dev/null 2>&1
  oc delete "$kind" "$name" -n "$ns" --ignore-not-found --wait=false >/dev/null 2>&1
  echo "  $kind/$name: force-removed (finalizer cleared)"
}

# 1. Repos FIRST — removes the ApplicationSet's source so it stops
#    (re)generating the ArgoCD app while we delete cluster resources.
if [ -n "$GITEA_API" ]; then
  GTOK="${GITEA_TOKEN:-$(oc get secret agent-office-gitea-scm -n openshift-gitops -o jsonpath='{.data.token}' 2>/dev/null | base64 -d)}"
  for r in "$REPO" "$WIKI_REPO"; do
    if [ -n "$DRY_RUN" ]; then
      code=$(curl -sk -o /dev/null -w '%{http_code}' "$GITEA_API/repos/$OWNER/$r")
      [ "$code" = 200 ] && echo "  repo $OWNER/$r: would delete (dry run)" || echo "  repo $OWNER/$r: already absent"
      continue
    fi
    code=$(curl -sk -o /dev/null -w '%{http_code}' -X DELETE -H "Authorization: token $GTOK" "$GITEA_API/repos/$OWNER/$r")
    case "$code" in
      204) echo "  repo $OWNER/$r: deleted" ;;
      404) echo "  repo $OWNER/$r: already absent" ;;
      403) echo "  repo $OWNER/$r: 403 (token may not delete in $OWNER) — delete manually" ;;
      *)   echo "  repo $OWNER/$r: delete http=$code" ;;
    esac
  done
else
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
    if [ -n "$DRY_RUN" ]; then echo "  repo $OWNER/$r: would delete (dry run)"; continue; fi
    code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE -H "Authorization: Bearer $TOK" "https://api.github.com/repos/$OWNER/$r")
    case "$code" in
      204) echo "  repo $OWNER/$r: deleted" ;;
      404) echo "  repo $OWNER/$r: already absent" ;;
      403) echo "  repo $OWNER/$r: 403 (App lacks delete_repo) — delete manually" ;;
      *)   echo "  repo $OWNER/$r: delete http=$code" ;;
    esac
  done
fi
fi

# 2. ArgoCD Application — stop it managing (and re-syncing) the resources.
#    The GitHub ApplicationSet names it <name>-agent; the Gitea one prefixes
#    the org: <org>-<name>-agent.
if [ -n "$GITEA_API" ]; then
  del_wait applications.argoproj.io "${OWNER}-${NAME}-agent" openshift-gitops
else
  del_wait applications.argoproj.io "${NAME}-agent" openshift-gitops
fi

# 3. AgentWorkstation (+ KnowledgeBase) — wait so the v1.6.3 finalizer
#    finishes de-registering / detaching before we return.
del_wait agentworkstation "$NAME" "$NS"
del_wait knowledgebase "$WIKI_REPO" "$NS"

# 3b. The agent's dedicated AgentGateway. Shared gateways stay: another
#     workstation in the namespace still runs on them.
if oc get agentgateway "$GW" -n "$NS" >/dev/null 2>&1; then
  if others=$(gateway_in_use "$GW" "$NS"); then
    echo "  agentgateway/$GW: kept (shared with $others)"
  else
    del_wait agentgateway "$GW" "$NS"
  fi
else
  echo "  agentgateway/$GW: already absent"
fi

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
      [ -n "$lid" ] || continue
      if [ -n "$DRY_RUN" ]; then echo "  catalog location $lid: would delete (dry run)"; continue; fi
      curl -sk -o /dev/null -w "  catalog location $lid: http %{http_code}\n" -X DELETE -H "Authorization: Bearer $RTOK" "$RHDH/api/catalog/locations/$lid"
    done
fi
echo "=== cleanup-agent done: $NAME ==="
