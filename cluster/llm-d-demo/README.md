# llm-d demo

Distributed Inference with llm-d on OpenShift AI 3.4: `RedHatAI/Qwen3-8B-quantized.w4a16`
(a Red Hat validated, 4-bit quantized model) served by two vLLM replicas on two commodity
GPU nodes, with the llm-d inference scheduler routing by prefix cache and queue depth.

- Endpoint: `https://ai-inference.apps.salamander.aimlworkbench.com/llm-d-demo/qwen3-8b/v1`
  (read `oc get llmisvc qwen3-8b -n llm-d-demo -o jsonpath='{.status.url}'` for the exact URL).
- Auth is on by default. Token: `oc create token llm-user -n llm-d-demo --duration=1h`.
- Watch the scheduler pick replicas: `oc logs -n llm-d-demo deploy/qwen3-8b-kserve-router-scheduler -f`
  (name may differ; `oc get deploy -n llm-d-demo`).
- Qwen3 thinks by default; add `"chat_template_kwargs": {"enable_thinking": false}` to a request
  for short answers.

Argo Application: `cluster/llm-d-demo-app.yaml` (apply once by hand, then Git rules).
