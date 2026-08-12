#!/usr/bin/env bash
# demo-status.sh — can I run the spreadsheet demo right now?
#
# One command, no Claude required. Every line is PASS or FAIL against a
# fact on the cluster. Anything that FAILs prints the exact command that
# fixes it, so you never have to open the runbook to get unstuck.
#
#   ./cluster/demo-status.sh
set -uo pipefail
export KUBECONFIG=${KUBECONFIG:-~/.kube/config}
NS=agent-office
APEX=apps.salamander.aimlworkbench.com
ok=0; bad=0; warn=0
p() { printf "  \033[32mPASS\033[0m  %s\n" "$1"; ok=$((ok+1)); }
f() { printf "  \033[31mFAIL\033[0m  %s\n" "$1"; bad=$((bad+1)); }
w() { printf "  \033[33mNOTE\033[0m  %s\n" "$1"; warn=$((warn+1)); }
fix(){ printf "        \033[2m-> %s\033[0m\n" "$1"; }

echo
echo "THE STORY  (nothing here is faked -- these three numbers are the demo)"
# Morgan's spreadsheet has live COUNTIFS/SUMIFS and NO cached values, so it
# only shows its numbers once Excel recomputes. The fixtures were generated
# independently by the orders-api data generator. If these two ever drift,
# Act 5's "look, the same 156" lands on a lie -- so check, don't assume.
XLSX="$(dirname "$0")/../../genesis-demo-recording/assets/Morgan-Monday-Ops.xlsx"
FIX="$(dirname "$0")/../manifests/supply-chain-demo/orders-api/hack/fixtures.json"
if [ -f "$XLSX" ] && [ -f "$FIX" ]; then
  res=$(python3 - "$XLSX" "$FIX" <<'PY' 2>/dev/null
import zipfile, re, json, sys
z = zipfile.ZipFile(sys.argv[1])
raw = z.read('xl/worksheets/sheet1.xml').decode()
rows = []
for rm in re.finditer(r'<row r="(\d+)"[^>]*>(.*?)</row>', raw, re.S):
    cells = {}
    for cm in re.finditer(r'<c r="([A-Z]+)\d+"([^>]*)>(.*?)</c>', rm.group(2), re.S):
        inner = cm.group(3)
        t = re.search(r'<is><t[^>]*>(.*?)</t>', inner, re.S)
        v = re.search(r'<v>(.*?)</v>', inner, re.S)
        cells[cm.group(1)] = t.group(1) if t else (v.group(1) if v else '')
    rows.append(cells)
data = rows[1:]
B2 = 46204.5                      # as_of anchor, Excel serial = 2026-07-01T12:00Z
def num(x):
    try: return float(x)
    except: return None
wk = [r for r in data if num(r.get('K')) is not None and B2-7 <= num(r['K']) <= B2]
rev = sum(num(r.get('H')) or 0 for r in wk if r.get('I') not in ('cancelled','returned'))
stuck = [r for r in data if r.get('I') == 'processing'
         and num(r.get('L')) is not None and num(r['L']) < B2-7]
fx = json.load(open(sys.argv[2]))
want = (fx['weekly_summary']['orders'], fx['weekly_summary']['revenue'], fx['stuck_orders']['count'])
got  = (len(wk), round(rev, 2), len(stuck))
print("%s|%d orders, $%s, %d stuck" % ("OK" if got == want else "DRIFT", got[0], format(got[1], ',.2f'), got[2]))
PY
)
  case "$res" in
    OK*)    p "spreadsheet == seeded truth: ${res#*|}" ;;
    DRIFT*) f "spreadsheet DRIFTED from fixtures: ${res#*|}"
            fix "Act 5's callback is wrong -- regenerate the workbook before demoing" ;;
    *)      w "could not recompute the workbook (is python3 present?)" ;;
  esac
else
  w "workbook or fixtures not found locally -- clone genesis-demo-recording next to agent-office"
fi

echo
echo "THE WORLD THAT ALREADY EXISTS  (pre-demo scenery -- must be up)"
hz=$(curl -s --max-time 15 "https://orders-api-$NS.$APEX/healthz" 2>/dev/null)
case "$hz" in
  *'"orders": 2000'*|*'"orders":2000'*) p "orders-api live, 2000 seeded orders, as_of $(echo "$hz" | sed -n 's/.*"as_of": *"\([^"]*\)".*/\1/p')" ;;
  "") f "orders-api unreachable"; fix "oc get deploy orders-api -n $NS" ;;
  *)  f "orders-api answered but not with 2000 orders: $hz" ;;
esac
if oc get skill weekly-ops-report -n $NS >/dev/null 2>&1; then
  p "weekly-ops-report skill published (Morgan authors this live in Act 3)"
else
  f "weekly-ops-report skill missing -- Act 5 has nothing to run"
  fix "oc apply -f cluster/skills/  (or author it live via the Dev Hub skill template)"
fi
np=$(oc get pipelines.tekton.dev -n $NS --no-headers 2>/dev/null | grep -c 'supply-chain')
if [ "${np:-0}" -ge 2 ]; then
  p "Tekton beats installed (supply-chain-e2e + teardown)"
else
  f "supply-chain pipelines missing -- prep and the reveal both need them"
  fix "oc apply -k integration-tests/supply-chain-demo/beats"
fi

echo
echo "THE CAST  (agents -- forge-dev is staff, ops-reporter is a demo beat)"
# A silent agent looks identical to a thinking one on camera. Two causes:
# an expired Codex credential, or a model the gateway's route cannot serve.
# Both are invisible until you ask, so ask.
GWP=$(oc get pods -n $NS --no-headers 2>/dev/null | grep research-gateway | grep Running | awk '{print $1}' | head -1)
if [ -z "$GWP" ]; then
  f "no Running research-gateway pod -- no agent can answer"
  fix "oc rollout status deploy/research-gateway -n $NS"
else
  lane=$(oc exec -n $NS "$GWP" -c openclaw -- node -e 'const c=require("/home/node/.openclaw/openclaw.json");
console.log(JSON.stringify(Object.keys(c.models.providers))+" "+(c.models.providers.openai?.apiKey===undefined?"nokey":"KEY"))' 2>/dev/null)
  case "$lane" in
    '["openai"] nokey') p "billing lane clean: subscription only, no per-token API key" ;;
    *KEY)               f "an OpenAI apiKey is present -- turns are billing per-token, not the subscription"
                        fix "check the gateway's spec.modelAuth; the Codex OAuth profile should be the only path" ;;
    *)                  f "provider set is $lane -- want exactly [\"openai\"]; a legacy openai-codex block kills every turn silently" ;;
  esac
fi
ph=$(oc get agentworkstation forge-dev -n $NS -o jsonpath='{.status.phase}' 2>/dev/null)
if [ "$ph" = "Running" ]; then
  p "forge-dev Running (platform staff -- never created on camera)"
else
  f "forge-dev is ${ph:-ABSENT} -- prep step 2 has no agent to drive"
  fix "oc apply -f cluster/supply-chain-demo/forge-dev.yaml"
fi
rp=$(oc get agentworkstation ops-reporter -n $NS -o jsonpath='{.status.phase}' 2>/dev/null)
if [ "$rp" = "Running" ]; then
  p "ops-reporter Running (Act 4 already done -- show it exists, or delete to re-demo live)"
else
  w "ops-reporter absent -- CORRECT if you are creating it live in Act 4 (that is the beat)"
fi

echo
echo "ACT 2's RECEIPTS  (produced by the agent during prep -- absent = prep has not run)"
if gh repo view enterprisewebservice/ops-metrics --json name >/dev/null 2>&1; then
  created=$(gh repo view enterprisewebservice/ops-metrics --json createdAt -q .createdAt 2>/dev/null)
  p "repo enterprisewebservice/ops-metrics exists (created $created)"
else
  f "repo ops-metrics ABSENT -- Act 2 has no receipts to show"
  fix "run prep: paste the Act-2 directive into #forge-dev (~13 min), or ./cluster/demo-prep.sh"
fi
if oc get deploy ops-metrics -n $NS >/dev/null 2>&1; then
  rdy=$(oc get deploy ops-metrics -n $NS -o jsonpath='{.status.readyReplicas}' 2>/dev/null)
  [ "${rdy:-0}" -ge 1 ] && p "ops-metrics deployed and ready ($rdy replica)" \
                        || f "ops-metrics Deployment exists but 0 ready"
else
  f "ops-metrics not deployed -- ArgoCD has nothing to sync yet"
fi
if oc get mcpserverregistration ops-metrics -n $NS >/dev/null 2>&1; then
  p "metrics_ tools registered behind the governed gateway (Act 5 can resolve them)"
else
  f "no MCPServerRegistration for ops-metrics -- Act 5 WILL fail, tools will not resolve"
  fix "this is the half people miss: Deployment alone is not enough"
fi
# Teardown deletes the repo but does NOT prune PipelineRuns, so this list
# keeps runs from every previous demo. Green is not enough -- a three-week-old
# run pointed at on camera undercuts "this just happened". Check green AND age.
kr=$(oc get pipelinerun -n default-tenant -l appstudio.openshift.io/component=ops-metrics \
     --sort-by=.metadata.creationTimestamp --no-headers 2>/dev/null | tail -1)
if [ -n "$kr" ]; then
  krname=$(echo "$kr" | awk '{print $1}')
  krok=$(echo "$kr"   | awk '{print $2}')
  krage=$(oc get pipelinerun "$krname" -n default-tenant \
          -o jsonpath='{.metadata.creationTimestamp}' 2>/dev/null)
  fresh=$(python3 -c "
import datetime,sys
try:
    t=datetime.datetime.fromisoformat('$krage'.replace('Z','+00:00'))
    h=(datetime.datetime.now(datetime.timezone.utc)-t).total_seconds()/3600
    print('%.0f' % h)
except Exception: print('999')" 2>/dev/null)
  if [ "$krok" != "True" ]; then
    f "newest Konflux run is not green: $krname"
  elif [ "${fresh:-999}" -gt 24 ]; then
    f "newest Konflux run is green but ${fresh}h STALE: $krname"
    fix "that is a PREVIOUS demo's run -- teardown never prunes these. Do not point at it on camera; run prep."
  else
    p "Konflux build green and fresh (${fresh}h): $krname"
  fi
else
  w "no Konflux run for ops-metrics yet (expected until prep runs)"
fi

echo
echo "THE CARD"
st=$(gh issue view 1 -R enterprisewebservice/supply-chain-tracker --json state -q .state 2>/dev/null)
case "$st" in
  OPEN)   p "card #1 OPEN -- forge-dev has something to pick up" ;;
  CLOSED) w "card #1 CLOSED -- fine AFTER prep (the agent closes it with receipts); reopen for a fresh run"
          fix "gh issue reopen 1 -R enterprisewebservice/supply-chain-tracker" ;;
  *)      f "cannot read card #1 -- is gh authenticated?"; fix "gh auth status" ;;
esac

echo
if [ "$bad" -eq 0 ]; then
  printf "  \033[32mREADY TO DEMO\033[0m  -- %d checks pass, %d notes\n\n" "$ok" "$warn"
else
  printf "  \033[31mNOT READY\033[0m  -- %d passing, %d failing, %d notes\n" "$ok" "$bad" "$warn"
  printf "  Fix the FAILs above (each prints its command), then re-run this.\n\n"
fi
[ "$bad" -eq 0 ] || exit 1
