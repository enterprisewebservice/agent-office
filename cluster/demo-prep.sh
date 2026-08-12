#!/usr/bin/env bash
# demo-prep.sh — make the spreadsheet demo real, the night before.
#
# Act 2 is show-and-tell of artifacts an agent ALREADY produced. The build
# genuinely takes ~13 minutes; it cannot happen on camera. This script makes
# the agent do that work tonight so tomorrow you walk through receipts.
#
# Nothing here is faked or hand-built -- the agent does every bit of it. Run
# it fresh, so the timestamps are from last night rather than last month.
#
#   ./cluster/demo-prep.sh            # full prep
#   ./cluster/demo-prep.sh --no-e2e   # skip the 45-min e2e reveal run
#
# Then re-run ./cluster/demo-status.sh until it says READY TO DEMO.
set -uo pipefail
export KUBECONFIG=${KUBECONFIG:-~/.kube/config}
NS=agent-office
REPO=enterprisewebservice/ops-metrics
TRACKER=enterprisewebservice/supply-chain-tracker
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$HERE")"
DO_E2E=1
[ "${1:-}" = "--no-e2e" ] && DO_E2E=0

say()  { printf "\n\033[1m== %s\033[0m\n" "$1"; }
info() { printf "   %s\n" "$1"; }
die()  { printf "\n\033[31mSTOPPED\033[0m %s\n\n" "$1"; exit 1; }

command -v gh >/dev/null 2>&1 || die "gh not found -- prep needs it to reset the card."
gh auth status >/dev/null 2>&1 || die "gh is not authenticated. Run: gh auth login"
oc whoami >/dev/null 2>&1     || die "not logged in to the cluster. Run: oc login"

say "1/5  Installing the demo's automation (Tasks, Pipelines, RBAC)"
# Must land BEFORE the teardown run below: that run references
# pipelineRef: supply-chain-teardown, which does not exist until this applies.
oc apply -k "$ROOT/integration-tests/supply-chain-demo/beats" >/dev/null 2>&1 \
  && info "beats applied" || die "could not apply beats -- check the path and your permissions"

say "2/5  Wiping the previous run's output"
# Deleting the GitHub repo is what makes ArgoCD prune the app, Deployment,
# Service, Route and MCPServerRegistration -- the ApplicationSet generates
# from that repo. orders-api, the skill and the agents deliberately survive.
if gh repo view "$REPO" --json name >/dev/null 2>&1; then
  oc create -f "$ROOT/integration-tests/supply-chain-demo/run/teardown-run.yaml" >/dev/null 2>&1
  info "teardown started -- waiting for it to finish (building over a pruning app makes ArgoCD fight itself)"
  for i in $(seq 1 60); do
    pr=$(oc get pipelinerun -n $NS -l tekton.dev/pipeline=supply-chain-teardown \
         --sort-by=.metadata.creationTimestamp --no-headers 2>/dev/null | tail -1 | awk '{print $2}')
    [ "$pr" = "True" ] && break
    sleep 20
  done
  info "teardown done"
else
  info "no ops-metrics repo -- already clean, skipping"
fi

say "3/5  Reopening card #1 so the agent has something to pick up"
state=$(gh issue view 1 -R "$TRACKER" --json state -q .state 2>/dev/null)
if [ "$state" = "CLOSED" ]; then
  gh issue reopen 1 -R "$TRACKER" >/dev/null 2>&1 && info "card #1 reopened"
else
  info "card #1 already $state"
fi

say "4/5  Making sure forge-dev exists and its brain answers"
if ! oc get agentworkstation forge-dev -n $NS >/dev/null 2>&1; then
  oc apply -f "$HERE/supply-chain-demo/forge-dev.yaml" >/dev/null 2>&1 && info "forge-dev created"
  oc rollout status deploy/research-gateway -n $NS --timeout=300s >/dev/null 2>&1
  sleep 20
else
  info "forge-dev already present"
fi
GW=$(oc get pods -n $NS --no-headers 2>/dev/null | grep research-gateway | grep Running | awk '{print $1}' | head -1)
[ -n "$GW" ] || die "no Running research-gateway pod."
# A silent agent is indistinguishable from a thinking one on camera. Prove a
# turn returns BEFORE spending 13 minutes on a build that would die quietly.
info "asking forge-dev to reply..."
ans=$(oc exec -n $NS "$GW" -c openclaw -- sh -c \
      'cd /home/node && openclaw agent --agent forge-dev -m "reply with OK" --timeout 180' 2>/dev/null | tr -d '\r')
case "$ans" in
  *OK*) info "forge-dev answers" ;;
  *)    die "forge-dev did not answer. Codex credential expired, or the model cannot resolve.
        Re-auth in Dev Hub (Codex Re-auth card), then re-run. Do NOT start the build until it replies." ;;
esac

say "5/5  Driving forge-dev to build ops-metrics  (~13 min -- hands off)"
info "Paste-once semantics: re-prompting mid-run spawns a second attempt that"
info "races the first over the same repo name. Let it work."
DIRECTIVE='You are forge-dev. Execute issue #1 of enterprisewebservice/supply-chain-tracker end to end with your governed github tools, autonomously. Read integration-tests/supply-chain-demo/CONTRACT.md and the acceptance test in the enterprisewebservice/agent-office repo; fetch every file under templates/service-golden-path/scaffold/ (recurse app/, gitops/, .tekton/, tests/); render __SVC__ -> ops-metrics and __SVC_PREFIX__ -> metrics_. Implement app/server.py per the contract (FastMCP streamable-http, PORT 8080; tools weekly_summary, stuck_orders, top_products; REST mirrors /healthz /v1/summary /v1/stuck /v1/top-products; ORDERS_API_URL default http://orders-api.agent-office.svc.cluster.local:8080; as_of from orders-api /healthz; money 2dp). CRITICAL: create repo enterprisewebservice/ops-metrics (public, main) and push ALL files in ONE first commit including .tekton/on-push.yaml. Poll the commit checks until the build is green; fix and re-push if it fails. Then comment receipts on issue #1 and close it. Reply here with repo URL, final SHA, and build result.'
oc exec -n $NS "$GW" -c openclaw -- sh -c \
  "cd /home/node && openclaw agent --agent forge-dev -m \"$DIRECTIVE\" --timeout 1800" 2>&1 | tail -6

if [ "$DO_E2E" -eq 1 ]; then
  say "Bonus  Kicking off a fresh e2e run for the reveal (~45 min, unattended)"
  oc create -f "$ROOT/integration-tests/supply-chain-demo/run/e2e-run.yaml" >/dev/null 2>&1 \
    && info "e2e started -- let it go green overnight; this is the artifact you point at, never run live" \
    || info "could not start the e2e run (not fatal -- the reveal can use an older green run if you must)"
fi

say "Now verify"
info "./cluster/demo-status.sh    <- re-run until it says READY TO DEMO"
echo
