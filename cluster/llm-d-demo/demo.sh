#!/usr/bin/env bash
# Live demo for the llm-d deployments published through Models-as-a-Service:
# catalog entries, API key, 401 without it, the scheduler in front of the small model,
# and one 16B Mixture-of-Experts model spanning two GPU nodes.
# Usage: ./demo.sh   (oc logged in to salamander as a model-admins member; curl, python3)
# Note: on Connectivity Link 1.4.3 the token-metering filter returns an empty body for
# non-streaming JSON answers from vLLM (Kuadrant/wasm-shim#443), so every call streams.
set -eu
# (no pipefail: the gateway ends SSE streams without the last chunk marker, curl exits 18 with a complete body)
NS=llm-d-demo
GW=https://maas.apps.salamander.aimlworkbench.com
URL=$GW/llm-d-demo/qwen3-8b/v1
MODEL=RedHatAI/Qwen3-8B-quantized.w4a16
URL2=$GW/llm-d-demo/deepseek-coder-v2-lite/v1
MODEL2=deepseek-ai/DeepSeek-Coder-V2-Lite-Instruct

counts() {
  for p in $(oc get pods -n $NS -l kserve.io/component=workload -o jsonpath='{.items[*].metadata.name}'); do
    node=$(oc get pod -n $NS "$p" -o jsonpath='{.spec.nodeName}')
    gpu=$(oc get node "$node" -o jsonpath='{.metadata.labels.nvidia\.com/gpu\.product}')
    n=$(oc exec -n $NS "$p" -c main -- curl -sk https://localhost:8000/metrics 2>/dev/null | awk '/^vllm:request_success_total/ {s+=$2} END {print s+0}')
    printf "  %-36s %-20s %-28s %s requests\n" "$p" "$node" "$gpu" "$n"
  done
}
ask() {  # ask "<prompt>" [url] [model] [max_tokens] [print_width]  (streams, prints the joined answer)
  local u=${2:-$URL} m=${3:-$MODEL} n=${4:-40} w=${5:-110}
  curl -sk -N "$u/chat/completions" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
    -d "{\"model\":\"$m\",\"messages\":[{\"role\":\"user\",\"content\":\"$1\"}],\"max_tokens\":$n,\"stream\":true,\"chat_template_kwargs\":{\"enable_thinking\":false}}" 2>/dev/null \
    | python3 -c '
import sys,json
out=[]
for line in sys.stdin:
    line=line.strip()
    if not line.startswith("data:") or line.endswith("[DONE]"): continue
    try: out.append(json.loads(line[5:])["choices"][0]["delta"].get("content") or "")
    except Exception: pass
print("   ", "".join(out).replace("\n"," ").strip()[:int(sys.argv[1])])' "$w"
}
gpumem() {  # GPU memory in use on each pod of the spanning model, from inside the pod
  for p in $(oc get pods -n $NS -o jsonpath='{.items[*].metadata.name}' | tr " " "\n" | grep "deepseek-coder-v2-lite-kserve-mn-0"); do
    node=$(oc get pod -n $NS "$p" -o jsonpath='{.spec.nodeName}')
    used=$(oc exec -n $NS "$p" -c main -- nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader 2>/dev/null)
    printf "  %-44s %-20s %s\n" "$p" "$node" "$used"
  done
}

echo "1. Two LLMInferenceServices: a small model behind a scheduler, and one 16B MoE model across two nodes"
oc get llminferenceservice -n $NS
oc get pods -n $NS -o wide | grep -v router-scheduler | awk '{print "  "$1, $2, $3, $7}'
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
echo "6. The spanning model: DeepSeek-Coder-V2-Lite, 31 GB in bf16, no single 24 GB card can hold it"
echo "   leader + worker, one GPU each, half the experts on each node:"
gpumem
ask "Write a Python function that returns the busiest hour from a list of (timestamp, kwh) tuples. Code only." "$URL2" "$MODEL2" 120 400
echo
echo "7. Same prompt five times to the small model: the prefix-cache scorer keeps it on one replica"
for i in 1 2 3 4 5; do ask "In one sentence, what does a building management system do?"; done
counts
echo
echo "8. Twelve different prompts at once: the queue scorer spreads them (needs more than one replica)"
topics=(chillers "fire alarms" "access control" "HVAC setpoints" "energy metering" "elevator maintenance" "indoor air quality" "lighting schedules" "boiler safety" "BACnet" "digital twins" "predictive maintenance")
for t in "${topics[@]}"; do ask "One sentence on $t in commercial buildings." & done; wait
counts
