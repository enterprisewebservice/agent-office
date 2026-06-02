#!/usr/bin/env bash
# Seed an agent's wiki repo with the genesis-first-principles Obsidian vault.
#
# The openclaw-agent "create new knowledge base" flow publishes a <name>-wiki
# repo with only a scaffolder STUB (README/mkdocs/catalog-info) and a
# KnowledgeBase CR that gitMirrors that repo onto the gateway. That stub is NOT
# the first-principles teaching content. This script pushes the REAL vault
# (integration-tests/genesis-demo/kb/genesis-first-principles — 12 linked notes:
# data -> hypothesis -> loss -> gradient descent -> evaluation, grounded line for
# line in pipeline.py) into that repo, so the KB gitMirror makes the agent teach
# from it. Idempotent: re-runs only commit when the vault content changed.
#
# Usage: seed-genesis-kb.sh [agent-name=genesis-worker] [owner=enterprisewebservice]
set -uo pipefail
NAME="${1:-genesis-worker}"
OWNER="${2:-enterprisewebservice}"
REPO="${NAME}-wiki"
HERE="$(cd "$(dirname "$0")" && pwd)"
VAULT="$HERE/../../genesis-demo/kb/genesis-first-principles"
[ -d "$VAULT" ] || { echo "seed-genesis-kb: vault not found at $VAULT"; exit 1; }

# mint a GitHub App installation token (same App the platform uses everywhere)
appId=$(oc get secret -n agent-office agent-office-github-app -o jsonpath='{.data.appId}' | base64 -d)
instId=$(oc get secret -n agent-office agent-office-github-app -o jsonpath='{.data.installationId}' | base64 -d)
oc get secret -n agent-office agent-office-github-app -o jsonpath='{.data.privateKey}' | base64 -d > /tmp/seedkb_gh.pem
b64url(){ openssl base64 -A | tr '+/' '-_' | tr -d '='; }
now=$(date +%s)
hh=$(printf '{"alg":"RS256","typ":"JWT"}' | b64url)
pp=$(printf '{"iat":%d,"exp":%d,"iss":"%s"}' $((now-60)) $((now+300)) "$appId" | b64url)
ss=$(printf '%s.%s' "$hh" "$pp" | openssl dgst -sha256 -sign /tmp/seedkb_gh.pem -binary | b64url)
TOK=$(curl -s -X POST -H "Authorization: Bearer $hh.$pp.$ss" -H "Accept: application/vnd.github+json" "https://api.github.com/app/installations/$instId/access_tokens" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("token",""))')
rm -f /tmp/seedkb_gh.pem
[ -n "$TOK" ] || { echo "seed-genesis-kb: could not mint GitHub App token"; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
if ! git clone -q "https://x-access-token:${TOK}@github.com/${OWNER}/${REPO}" "$TMP/$REPO" 2>/dev/null; then
  echo "seed-genesis-kb: could not clone ${OWNER}/${REPO} — run create-kb first (it publishes the wiki repo)"; exit 1
fi
# copy the vault content (notes + .obsidian) in alongside the scaffolder files
cp -R "$VAULT"/. "$TMP/$REPO"/
cd "$TMP/$REPO"
git -c user.email=agents@agent-office.ai -c user.name=genesis-kb-seed add -A
if git -c user.email=agents@agent-office.ai -c user.name=genesis-kb-seed commit -q -m "seed genesis-first-principles vault into the agent's KnowledgeBase"; then
  git push -q "https://x-access-token:${TOK}@github.com/${OWNER}/${REPO}" HEAD:main \
    && echo "seed-genesis-kb: ✓ pushed genesis-first-principles vault into ${OWNER}/${REPO}"
else
  echo "seed-genesis-kb: vault already present in ${OWNER}/${REPO} (no change)"
fi

# nudge the KnowledgeBase to gitMirror now instead of waiting for the cadence
oc annotate knowledgebase "${REPO}" -n agent-office "agentoffice.ai/sync=$(date +%s)" --overwrite >/dev/null 2>&1 \
  && echo "seed-genesis-kb: triggered KnowledgeBase ${REPO} sync"
