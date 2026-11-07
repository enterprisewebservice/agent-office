# llm-d demo

Distributed Inference with llm-d on OpenShift AI 3.4: `RedHatAI/Qwen3-8B-quantized.w4a16`
(a Red Hat validated, 4-bit quantized model) served by three vLLM replicas on three commodity
GPU nodes, with the llm-d inference scheduler routing by prefix cache and queue depth.

- Endpoint: `https://ai-inference.apps.salamander.aimlworkbench.com/llm-d-demo/qwen3-8b/v1`
  (read `oc get llmisvc qwen3-8b -n llm-d-demo -o jsonpath='{.status.url}'` for the exact URL).
- Auth is on by default. Token: `oc create token llm-user -n llm-d-demo --duration=1h`.
- Watch the scheduler pick replicas: `oc logs -n llm-d-demo deploy/qwen3-8b-kserve-router-scheduler -f`
  (name may differ; `oc get deploy -n llm-d-demo`).
- Qwen3 thinks by default; add `"chat_template_kwargs": {"enable_thinking": false}` to a request
  for short answers.

Argo Application: `cluster/llm-d-demo-app.yaml` (apply once by hand, then Git rules).

## The spanning model (added 6 Nov 2026)

`llminferenceservice-deepseek.yaml`: DeepSeek-Coder-V2-Lite-Instruct, a 16B
Mixture-of-Experts model (31 GB in bf16) across two nodes with
`parallelism: {data: 2, dataLocal: 1, expert: true, tensor: 1}`. KServe renders a
LeaderWorkerSet (`<name>-kserve-mn`, pods `-0` and `-0-1`), one GPU each; each
rank holds the attention and shared layers plus half of the 64 routed experts.
All-to-all runs over TCP (`VLLM_ALL2ALL_BACKEND=naive`, NCCL on the pod
network), per the OpenShift AI 3.4 llm-d guide, section 8.7. Published through
MaaS like qwen3-8b (`maas-deepseek.yaml`). Qwen3 8B went from three replicas to
one to free the two cards.

## Model images (7 Nov 2026)

Both models are ModelCar images in the cluster Quay, built in-cluster by
`build/modelcar-build.yaml` (one TaskRun per model under `build/run/`, run with
`oc create -f`) and loaded with `model.uri: oci://…` (KServe adds a `modelcar`
sidecar; no download, the node's image cache serves restarts). Registered in the
OpenShift AI model registry (`register-models.sh`). The shared CephFS volume and
fetch jobs that preceded the images are gone. vLLM runs with its defaults, CUDA
graphs on; streamed calls ask for the usage chunk (see `demo.sh`).
