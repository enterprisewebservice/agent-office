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

## The spanning model (added 6 Nov 2026, swapped 8 Nov 2026)

`llminferenceservice-qwen3-coder.yaml`: Qwen3-Coder-30B-A3B-Instruct-FP8, a 30B
Mixture-of-Experts coding model (3.3B active, 31 GB in FP8) across two nodes with
`parallelism: {data: 2, dataLocal: 1, expert: true, tensor: 1}`. KServe renders a
LeaderWorkerSet (`<name>-kserve-mn`, pods `-0` and `-0-1`), one GPU each; each
rank holds the attention and shared layers plus half of the 128 routed experts.
All-to-all runs over TCP (`VLLM_ALL2ALL_BACKEND=naive`, NCCL on the pod
network), per the OpenShift AI 3.4 llm-d guide, section 8.7. Published through
MaaS like qwen3-8b (`maas-qwen3-coder.yaml`). Tool calling is on
(`--enable-auto-tool-choice --tool-call-parser qwen3_xml`, context 32K) so an IDE
can use it in agent mode; every stream carries a usage chunk
(`--enable-force-include-usage`) so the Connectivity Link metering filter
releases streams at once. It replaced DeepSeek-Coder-V2-Lite (16B, bf16), which
has no tool-call format. Qwen3 8B went from three replicas to one to free the
two cards.

## Start and stop the spanning model (11 Nov 2026)

The model is parked between demos so its two GPUs are free. The switch is one
annotation in `llminferenceservice-qwen3-coder.yaml`:

- `serving.kserve.io/stop: "true"`: the OpenShift AI controller deletes the
  LeaderWorkerSet, the route, the scheduler and the inference pool, and keeps the
  LLMInferenceService (conditions read `Stopped`). Requests to the model fail.
- `serving.kserve.io/stop: "false"`: everything is recreated.

Commit, push, and OpenShift GitOps applies it (application `agent-office-llm-d-demo`).
Change it in Git only: the application self-heals, so a change made on the cluster
is put back to what Git says.

Before a demo, start it the day before:

- Two GPU nodes must have their card free (`oc describe node <node> | grep nvidia.com/gpu`).
- Ready takes about 3 minutes when both nodes still hold the 31 GB model image
  (measured 11 Nov 2026 on `d8-43-ae-5b-c9-9a` and `ec-0d-9a-2e-71-28`). A node
  that has dropped the image, or a different node, pulls it first: about 20
  minutes per node (first pulls, 7 Nov 2026).
- Check: `oc get llmisvc qwen3-coder-30b-a3b -n llm-d-demo` shows Ready True,
  then run `./demo.sh`.

The LeaderWorkerSet controller comes from the Red Hat Leader Worker Set Operator
(`cluster/leader-worker-set`, namespace `openshift-lws-operator`). If the model
stays pending, check `oc get leaderworkersetoperator cluster` for Available True.

## Model images (7 Nov 2026)

Both models are ModelCar images in the cluster Quay, built in-cluster by
`build/modelcar-build.yaml` (one TaskRun per model under `build/run/`, run with
`oc create -f`) and loaded with `model.uri: oci://…` (KServe adds a `modelcar`
sidecar; no download, the node's image cache serves restarts). Registered in the
OpenShift AI model registry (`register-models.sh`). A model reaches Quay in two
steps: the fetch Job (`models-fetch-job.yaml`) downloads it to the CephFS volume
(`models-pvc.yaml`), the TaskRun packages and pushes it. vLLM runs with its
defaults, CUDA graphs on; streamed calls ask for the usage chunk (see `demo.sh`).
