#!/usr/bin/env bash
# Poll a Backstage scaffolder task to completion. Exit 0=completed, 1=failed.
# Usage: wait-task.sh <taskId>
set -uo pipefail
TID="${1:?task id required}"
RTOK=$(oc get secret agent-office-rhdh-token -n rhdh-test -o jsonpath='{.data.token}' | base64 -d)
RHDH="${RHDH_BASE_URL:-https://v1-developer-hub-rhdh-test.apps.salamander.aimlworkbench.com}"
for i in $(seq 1 72); do
  st=$(curl -sk -H "Authorization: Bearer $RTOK" "$RHDH/api/scaffolder/v2/tasks/$TID" 2>/dev/null \
        | python3 -c 'import sys,json;print(json.load(sys.stdin).get("status",""))' 2>/dev/null)
  echo "  [$i] scaffolder task $TID: ${st:-?}"
  case "$st" in
    completed) exit 0 ;;
    failed|cancelled) exit 1 ;;
  esac
  sleep 5
done
echo "  timed out waiting for task $TID"
exit 2
