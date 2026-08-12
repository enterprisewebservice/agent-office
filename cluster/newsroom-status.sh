#!/usr/bin/env bash
# newsroom-status.sh — is the nl2sql.ai newsroom actually working?
#
# One command, no Claude required. Every line is PASS or FAIL against a
# fact on the cluster, not against what someone said they shipped.
#
#   ./cluster/newsroom-status.sh
set -uo pipefail
export KUBECONFIG=${KUBECONFIG:-~/.kube/config}
ok=0; bad=0
p() { printf "  \033[32mPASS\033[0m  %s\n" "$1"; ok=$((ok+1)); }
f() { printf "  \033[31mFAIL\033[0m  %s\n" "$1"; bad=$((bad+1)); }
i() { printf "        %s\n" "$1"; }

echo
echo "OPERATOR"
CSV=$(oc get csv -n agent-office-operator --no-headers 2>/dev/null | grep agent-office | awk '{print $1" "$NF}')
case "$CSV" in
  *Succeeded) p "installed: $CSV" ;;
  "")         f "no agent-office CSV installed" ;;
  *)          f "CSV not Succeeded: $CSV" ;;
esac

echo
echo "AGENT PROMPTS REACHING THE RUNTIME"
# The Aug-10 bug: seeding failed with 'Argument list too long', so spec
# edits were accepted and silently never delivered. A stale SOUL.md is
# the tell — compare it against the CR that is supposed to produce it.
NG=$(oc get pods -n agent-office --no-headers 2>/dev/null | grep newsroom-gateway | grep Running | awk '{print $1}' | head -1)
if [ -z "$NG" ]; then
  f "no Running newsroom-gateway pod"
else
  # Compare the CR against what is on disk, BY SIZE. Two weaker checks
  # were tried and both lie: looking for a recent error in the log passes
  # whenever no reconcile has run lately, and matching the prompt's last
  # line passes when only the middle was edited. SOUL.md is a short
  # header plus the systemPrompt verbatim, so a size gap wider than the
  # header means the body on disk is not the body on the CR.
  for a in nl2sql-wire nl2sql-scout nl2sql-bench nl2sql-anchor; do
    crlen=$(oc get agentworkstation "$a" -n agent-office -o jsonpath='{.spec.systemPrompt}' 2>/dev/null | wc -c | tr -d ' ')
    livelen=$(oc exec -n agent-office "$NG" -c openclaw -- sh -c \
      "wc -c < /home/node/.openclaw/workspaces/$a/SOUL.md 2>/dev/null" 2>/dev/null | tr -d ' \r')
    mt=$(oc exec -n agent-office "$NG" -c openclaw -- sh -c \
      "stat -c %y /home/node/.openclaw/workspaces/$a/SOUL.md 2>/dev/null | cut -c1-16" 2>/dev/null | tr -d '\r')
    if [ -z "$crlen" ] || [ "$crlen" -lt 2 ]; then
      f "$a — no systemPrompt on the CR"
    elif [ -z "$livelen" ]; then
      f "$a — no SOUL.md in the workspace"
    else
      diff=$(( livelen - crlen )); [ "$diff" -lt 0 ] && diff=$(( -diff ))
      if [ "$diff" -le 200 ]; then
        p "$a — live prompt matches the CR (SOUL.md $mt, ${livelen}B)"
      else
        f "$a — SOUL.md is STALE ($mt): CR ${crlen}B vs disk ${livelen}B; edit never delivered"
      fi
    fi
  done
fi

echo
echo "SEARCH + BROWSER"
if [ -n "$NG" ]; then
  cfg=$(oc exec -n agent-office "$NG" -c openclaw -- sh -c 'cat /home/node/.openclaw/openclaw.json' 2>/dev/null)
  echo "$cfg" | grep -q '"provider": *"duckduckgo"' && p "web_search provider configured (duckduckgo)" \
    || f "no web_search provider — agents will report 'provider unavailable'"
  echo "$cfg" | grep -q '"alsoAllow"' && p "browser/canvas allowed to agents" \
    || f "browser NOT in tools.alsoAllow — agents get BROWSER_TOOL_MISSING"
  caps=$(oc exec -n agent-office "$NG" -c openclaw -- sh -c \
    'cd /home/node && COLUMNS=400 openclaw nodes describe --node fedora-black-zebra-36-newsroom --json 2>/dev/null' 2>/dev/null \
    | tr -d '\n' | grep -o '"caps": *\[[^]]*\]')
  case "$caps" in
    *browser*) p "browser node paired and capable: $caps" ;;
    *)         f "browser node has no capability (${caps:-not paired}) — check the VM is running" ;;
  esac
fi

echo
echo "OUTPUT (the only thing that really counts)"
PG=$(oc get pods -n nl2sql --no-headers 2>/dev/null | grep nl2sql-pg | awk '{print $1}' | head -1)
if [ -z "$PG" ]; then
  f "no nl2sql-pg pod"
else
  q() { oc exec -n nl2sql "$PG" -- bash -c "psql -U postgres -d nl2sql -t -A -c \"$1\"" 2>/dev/null | tr -d '\r'; }
  arts=$(q "select count(*) from articles where created_at > now() - interval '24 hours'")
  wires=$(q "select count(*) from wire_items where created_at > now() - interval '24 hours'")
  last=$(q "select coalesce(to_char(max(created_at),'MM-DD HH24:MI'),'never') from articles")
  [ "${arts:-0}" -gt 0 ] && p "articles in last 24h: $arts" || f "articles in last 24h: 0  (last ever: $last)"
  [ "${wires:-0}" -gt 0 ] && p "wire items in last 24h: $wires" || f "wire items in last 24h: 0"
  i "recent sweep: $(q "select left(detail,88) from agent_log where agent='wire' and action='shift.end' order by created_at desc limit 1")"
fi

echo
echo "SCHEDULES"
if [ -n "$NG" ]; then
  n=$(oc exec -n agent-office "$NG" -c openclaw -- sh -c 'cd /home/node && openclaw cron list 2>/dev/null' 2>/dev/null | grep -c 'newsroom-')
  [ "${n:-0}" -ge 4 ] && p "$n newsroom cron jobs registered" || f "only ${n:-0} cron jobs (expected 4)"
fi

echo
printf "  %d passing, %d failing\n\n" "$ok" "$bad"
[ "$bad" -eq 0 ] || exit 1
