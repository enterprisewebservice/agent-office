#!/usr/bin/env bash
# Live demo for the llm-d deployment published through Models-as-a-Service:
# catalog entry, API key, 401 without it, prefix-cache stickiness, spread across GPU nodes.
# Usage: ./demo.sh   (oc logged in to salamander as a model-admins member; curl, python3)
# Note: on Connectivity Link 1.4.3 the token-metering filter returns an empty body for
# non-streaming JSON answers from vLLM (Kuadrant/wasm-shim#443), so every call streams.
set -eu
# (no pipefail: the gateway ends SSE streams without the last chunk marker, curl exits 18 with a complete body)
NS=llm-d-demo
GW=https://maas.apps.salamander.aimlworkbench.com
URL=$GW/llm-d-demo/qwen3-8b/v1
MODEL=RedHatAI/Qwen3-8B-quantized.w4a16

counts() {
  for p in $(oc get pods -n $NS -l kserve.io/component=workload -o jsonpath='{.items[*].metadata.name}'); do
    node=$(oc get pod -n $NS "$p" -o jsonpath='{.spec.nodeName}')
    gpu=$(oc get node "$node" -o jsonpath='{.metadata.labels.nvidia\.com/gpu\.product}')
    n=$(oc exec -n $NS "$p" -c main -- curl -sk https://localhost:8000/metrics 2>/dev/null | awk '/^vllm:request_success_total/ {s+=$2} END {print s+0}')
    printf "  %-36s %-20s %-28s %s requests\n" "$p" "$node" "$gpu" "$n"
  done
}
ask() {  # ask "<prompt>"  (streams, prints the joined answer)
  curl -sk -N "$URL/chat/completions" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
    -d "{\"model\":\"$MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"$1\"}],\"max_tokens\":40,\"stream\":true,\"chat_template_kwargs\":{\"enable_thinking\":false}}" 2>/dev/null \
    | python3 -c '
import sys,json
out=[]
for line in sys.stdin:
    line=line.strip()
    if not line.startswith("data:") or line.endswith("[DONE]"): continue
    try: out.append(json.loads(line[5:])["choices"][0]["delta"].get("content") or "")
    except Exception: pass
print("   ", "".join(out).replace("\n"," ").strip()[:110])'
}

echo "1. The deployment: one LLMInferenceService, N vLLM replicas, one scheduler"
oc get llminferenceservice -n $NS
oc get pods -n $NS -o wide | awk '{print "  "$1, $2, $3, $7}'
echo
echo "2. The model sits in the Models-as-a-Service catalog next to the external ones"
OCT=$(oc whoami -t)
curl -sk "$GW/maas-api/v1/models" -H "Authorization: Bearer $OCT" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("   ", [m["id"] for m in d.get("data",d)])'
echo
echo "3. No key: the gateway answers 401"
curl -sk -o /dev/null -w "   HTTP %{http_code}\n" "$URL/models"
echo
echo "4. Mint a MaaS API key for yourself (same flow as for Claude or GPT here)"
KEY=$(curl -sk -X POST "$GW/maas-api/v1/api-keys" -H "Authorization: Bearer $OCT" -H "Content-Type: application/json" -d '{"name":"llm-d-demo","expiration":"2h"}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["key"])')
echo "   key minted (sk-oai-..., not shown)"
echo
echo "5. Requests served so far, per replica"
counts
echo
echo "6. Same prompt five times: the prefix-cache scorer keeps it on one replica"
for i in 1 2 3 4 5; do ask "In one sentence, what does a building management system do?"; done
counts
echo
echo "7. Twelve different prompts at once: the queue scorer spreads them"
topics=(chillers "fire alarms" "access control" "HVAC setpoints" "energy metering" "elevator maintenance" "indoor air quality" "lighting schedules" "boiler safety" "BACnet" "digital twins" "predictive maintenance")
for t in "${topics[@]}"; do ask "One sentence on $t in commercial buildings." & done; wait
counts
