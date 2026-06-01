#!/usr/bin/env bash
# Assert a "create new KB" agent actually created + populated its KB:
#   - the <name>-wiki GitHub repo is published AND seeded (README.md)
#   - the KnowledgeBase CR <name>-wiki is applied (by ArgoCD)
#   - (best-effort) its PVC binds
# Usage: assert-kb.sh <name> [namespace] [ghOwner]
set -uo pipefail
NAME="${1:?agent name required}"
NS="${2:-agent-office}"
OWNER="${3:-enterprisewebservice}"
KB="${NAME}-wiki"

# mint a short-lived GitHub App token (for the repo check)
appId=$(oc get secret -n agent-office agent-office-github-app -o jsonpath='{.data.appId}' | base64 -d)
instId=$(oc get secret -n agent-office agent-office-github-app -o jsonpath='{.data.installationId}' | base64 -d)
oc get secret -n agent-office agent-office-github-app -o jsonpath='{.data.privateKey}' | base64 -d > /tmp/akb.pem
b64url(){ openssl base64 -A | tr '+/' '-_' | tr -d '='; }
now=$(date +%s)
hh=$(printf '{"alg":"RS256","typ":"JWT"}' | b64url)
pp=$(printf '{"iat":%d,"exp":%d,"iss":"%s"}' $((now-60)) $((now+300)) "$appId" | b64url)
ss=$(printf '%s.%s' "$hh" "$pp" | openssl dgst -sha256 -sign /tmp/akb.pem -binary | b64url)
TOK=$(curl -s -X POST -H "Authorization: Bearer $hh.$pp.$ss" -H "Accept: application/vnd.github+json" "https://api.github.com/app/installations/$instId/access_tokens" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("token",""))')
rm -f /tmp/akb.pem

echo "=== assert wiki repo $OWNER/$KB is published + seeded ==="
ok=""
for i in $(seq 1 8); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOK" "https://api.github.com/repos/$OWNER/$KB/contents/README.md")
  if [ "$code" = "200" ]; then ok=1; break; fi
  echo "  [$i] $KB/README.md not present yet (http=$code)…"; sleep 5
done
[ -n "$ok" ] && echo "  ✓ KB populated: $OWNER/$KB seeded with README.md" || { echo "FAIL: wiki repo $KB not seeded"; exit 1; }

echo "=== assert KnowledgeBase CR $KB applied (ArgoCD sync) ==="
kbok=""
for i in $(seq 1 36); do
  if oc get knowledgebase "$KB" -n "$NS" >/dev/null 2>&1; then kbok=1; break; fi
  echo "  [$i] waiting for ArgoCD to apply KnowledgeBase $KB…"; sleep 5
done
[ -n "$kbok" ] && echo "  ✓ KB created: KnowledgeBase/$KB exists" || { echo "FAIL: KnowledgeBase CR $KB not applied"; exit 1; }

echo "=== best-effort: KB PVC ==="
PVC=$(oc get pvc -n "$NS" -l agentoffice.ai/knowledgebase="$KB" -o jsonpath='{.items[0].status.phase}' 2>/dev/null || true)
[ -z "$PVC" ] && PVC=$(oc get pvc "$KB" -n "$NS" -o jsonpath='{.status.phase}' 2>/dev/null || true)
echo "  PVC phase: ${PVC:-pending}"
echo "PASS — KB $KB created + populated."
