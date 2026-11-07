#!/usr/bin/env bash
# Live demo for the llm-d deployment: shows auth, prefix-cache stickiness and spread across GPU nodes.
# Usage: ./demo.sh            (needs oc logged in to salamander and curl)
set -euo pipefail
NS=llm-d-demo
URL=https://ai-inference.apps.salamander.aimlworkbench.com/llm-d-demo/qwen3-8b/v1
MODEL=RedHatAI/Qwen3-8B-quantized.w4a16

counts() {
  for p in $(oc get pods -n $NS -l kserve.io/component=workload -o jsonpath='{.items[*].metadata.name}'); do
    node=$(oc get pod -n $NS "$p" -o jsonpath='{.spec.nodeName}')
    gpu=$(oc get node "$node" -o jsonpath='{.metadata.labels.nvidia\.com/gpu\.product}')
    n=$(oc exec -n $NS "$p" -c main -- curl -sk https://localhost:8000/metrics 2>/dev/null | awk '/^vllm:request_success_total/ {s+=$2} END {print s+0}')
    printf "  %-36s %-20s %-28s %s requests\n" "$p" "$node" "$gpu" "$n"
  done
}
ask() {  # ask "<prompt>"
  curl -sk "$URL/chat/completions" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"model\":\"$MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"$1\"}],\"max_tokens\":48,\"chat_template_kwargs\":{\"enable_thinking\":false}}" \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); print("   ", d["choices"][0]["message"]["content"].strip().replace("\n"," ")[:110])'
}

echo "1. The deployment: one LLMInferenceService, N vLLM replicas, one scheduler"
oc get llminferenceservice -n $NS
oc get pods -n $NS -o wide | awk '{print "  "$1, $2, $3, $7}'
echo
echo "2. No token: the gateway answers 401"
curl -sk -o /dev/null -w "   HTTP %{http_code}\n" "$URL/models"
echo
echo "3. With a token minted for the llm-user service account"
TOKEN=$(oc create token llm-user -n $NS --duration=1h)
curl -sk "$URL/models" -H "Authorization: Bearer $TOKEN" | python3 -c 'import json,sys; print("   models:", [m["id"] for m in json.load(sys.stdin)["data"]])'
echo
echo "4. Requests served so far, per replica"
counts
echo
echo "5. Same prompt five times: the prefix-cache scorer keeps it on one replica"
for i in 1 2 3 4 5; do ask "In one sentence, what does a building management system do?"; done
counts
echo
echo "6. Twelve different prompts at once: the queue scorer spreads them"
topics=(chillers "fire alarms" "access control" "HVAC setpoints" "energy metering" "elevator maintenance" "indoor air quality" "lighting schedules" "boiler safety" "BACnet" "digital twins" "predictive maintenance")
for t in "${topics[@]}"; do ask "One sentence on $t in commercial buildings." & done; wait
counts
