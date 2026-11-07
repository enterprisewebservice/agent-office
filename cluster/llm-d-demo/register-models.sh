#!/usr/bin/env bash
# Register the two served models in the OpenShift AI model registry
# (autoresearch-registry): a RegisteredModel, a version, and a model artifact
# whose URI is the ModelCar image in Quay. Idempotent: existing names are reused.
# Usage: ./register-models.sh   (oc logged in; the registry REST API takes the OpenShift token)
set -euo pipefail
REG=${REG:-https://autoresearch-registry-rhoai-model-registries.apps.salamander.aimlworkbench.com/api/model_registry/v1alpha3}
TOKEN=$(oc whoami -t)
QUAY=quay-quay-quay-test.apps.salamander.aimlworkbench.com/deanpeterson
api() { curl -sk -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" "$@"; }
jqget() { python3 -c "import json,sys; d=json.load(sys.stdin); print(${1})"; }

register() {  # name hf_id image format description
  local name=$1 hf=$2 image=$3 fmt=$4 desc=$5
  local rm_id
  rm_id=$(api "$REG/registered_models?pageSize=100" | jqget "next((m['id'] for m in d.get('items',[]) if m['name']=='$name'),'')")
  if [ -z "$rm_id" ]; then
    rm_id=$(api -X POST "$REG/registered_models" -d "{\"name\":\"$name\",\"description\":\"$desc\",\"state\":\"LIVE\",\"customProperties\":{\"hf_id\":{\"metadataType\":\"MetadataStringValue\",\"string_value\":\"$hf\"},\"kind\":{\"metadataType\":\"MetadataStringValue\",\"string_value\":\"served-model\"},\"serving\":{\"metadataType\":\"MetadataStringValue\",\"string_value\":\"llm-d on salamander, namespace llm-d-demo\"}}}" | jqget "d['id']")
    echo "registered model $name id=$rm_id"
  else
    echo "registered model $name exists id=$rm_id"
  fi
  local v_id
  v_id=$(api "$REG/registered_models/$rm_id/versions?pageSize=100" | jqget "next((v['id'] for v in d.get('items',[]) if v['name']=='v1'),'')")
  if [ -z "$v_id" ]; then
    v_id=$(api -X POST "$REG/model_versions" -d "{\"name\":\"v1\",\"registeredModelId\":\"$rm_id\",\"description\":\"Weights from Hugging Face ($hf), packaged as a ModelCar image in the cluster Quay on 6 Nov 2026.\",\"state\":\"LIVE\",\"customProperties\":{\"image\":{\"metadataType\":\"MetadataStringValue\",\"string_value\":\"$image\"}}}" | jqget "d['id']")
    echo "  version v1 id=$v_id"
  else
    echo "  version v1 exists id=$v_id"
  fi
  local a_id
  a_id=$(api "$REG/model_versions/$v_id/artifacts?pageSize=100" | jqget "next((a['id'] for a in d.get('items',[]) if a.get('name')=='$name-v1'),'')")
  if [ -z "$a_id" ]; then
    a_id=$(api -X POST "$REG/model_versions/$v_id/artifacts" -d "{\"artifactType\":\"model-artifact\",\"name\":\"$name-v1\",\"uri\":\"oci://$image\",\"modelFormatName\":\"$fmt\",\"modelFormatVersion\":\"1\",\"modelSourceKind\":\"hf\",\"modelSourceId\":\"$hf\",\"state\":\"LIVE\"}" | jqget "d.get('id','?')")
    echo "  artifact id=$a_id uri=oci://$image"
  else
    echo "  artifact exists id=$a_id"
  fi
}

register "DeepSeek-Coder-V2-Lite-Instruct" "deepseek-ai/DeepSeek-Coder-V2-Lite-Instruct" "$QUAY/deepseek-coder-v2-lite:v1" "safetensors" \
  "16B Mixture-of-Experts coding model, bf16, 31 GB. Served by llm-d across two GPU nodes (data parallel 2, expert parallel) and published through Models-as-a-Service."
register "Qwen3-8B-quantized.w4a16" "RedHatAI/Qwen3-8B-quantized.w4a16" "$QUAY/qwen3-8b:v1" "safetensors" \
  "Red Hat validated 4-bit quantized Qwen3 8B. Served by llm-d behind the inference scheduler and published through Models-as-a-Service."
