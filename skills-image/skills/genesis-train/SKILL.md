Use this skill to **train the Genesis first-principles model on OpenShift AI** and report whether it learned. The model is `genesis-model` — linear regression `ŷ = w·x + b` learned by hand-written gradient descent — already registered on the agent-office Data Science Pipelines server (DSPA). You submit a run and wait; the training itself runs as Argo-orchestrated pods the DSPA launches (`generate_data → train_gd → evaluate`). The `evaluate` step HARD-FAILS the run unless the model recovers the universe's true parameters (`w≈2, b≈1`), so a **SUCCEEDED run provably means it learned** — no metric scraping needed.

## When to use

- A task (e.g. a kanban card on the "Genesis Model" board) asks you to **train the model**, **build/train the predictive model**, or **run it on OpenShift AI**.
- The user asks you to "train the Genesis model" or "show that it learns / recovers w=2, b=1".

## When NOT to use

- Explaining the *theory* of how the model learns — that's the `genesis-first-principles` wiki, not a training run.
- Any model other than `genesis-model`.

## How to run it

Save this script and run it with `bash`. It uses the gateway pod's ServiceAccount token (already authorized for the DSP API) and the in-cluster DSPA service:

```bash
set -euo pipefail
DSP="https://ds-pipeline-dspa.agent-office.svc.cluster.local:8443"
TOK=$(cat /var/run/secrets/kubernetes.io/serviceaccount/token)
jf(){ python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('$1','') if isinstance(d,dict) else '')"; }
api(){ local m="$1" p="$2" d="${3:-}" o c b
  local a=(-sk --connect-timeout 10 -H "Authorization: Bearer $TOK" -w $'\n%{http_code}')
  [ "$m" != GET ] && a+=(-X "$m"); [ -n "$d" ] && a+=(-H 'Content-Type: application/json' --data "$d")
  o=$(curl "${a[@]}" "$DSP$p"); c=${o##*$'\n'}; b=${o%$'\n'*}
  case "$c" in 2[0-9][0-9]) printf '%s' "$b";; *) echo "DSP $m $p -> HTTP $c: $(printf '%s' "$b"|head -c200)">&2; return 1;; esac; }

PID=$(api GET "/apis/v2beta1/pipelines?page_size=200" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(next((p["pipeline_id"] for p in d.get("pipelines",[]) if p.get("display_name")=="genesis-model"),""))')
[ -n "$PID" ] || { echo "genesis-model pipeline is not registered on the DSPA"; exit 1; }
EID=$(api GET "/apis/v2beta1/experiments?page_size=200" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(next((e["experiment_id"] for e in d.get("experiments",[]) if e.get("display_name")=="genesis-model"),""))')
[ -n "$EID" ] || EID=$(api POST "/apis/v2beta1/experiments" '{"display_name":"genesis-model","description":"Genesis first-principles model runs"}' | jf experiment_id)
TS=$(date +%Y%m%d-%H%M%S)
BODY=$(EID="$EID" PID="$PID" TS="$TS" python3 -c 'import os,json;print(json.dumps({"display_name":"genesis-train-"+os.environ["TS"],"experiment_id":os.environ["EID"],"pipeline_version_reference":{"pipeline_id":os.environ["PID"]},"runtime_config":{"parameters":{"n":200,"true_w":2.0,"true_b":1.0,"noise":0.5,"seed":7,"epochs":300,"lr":0.05}}}))')
RID=$(api POST "/apis/v2beta1/runs" "$BODY" | jf run_id)
[ -n "$RID" ] || { echo "could not submit run"; exit 1; }
echo "submitted run genesis-train-$TS (id=$RID); training on the DSPA…"
for i in $(seq 1 60); do
  ST=$(api GET "/apis/v2beta1/runs/$RID" | jf state); echo "  [$i] $ST"
  case "$ST" in
    SUCCEEDED) echo "RESULT: SUCCEEDED — the model LEARNED (recovered the true w≈2, b≈1 within tolerance)."; echo "View: OpenShift AI → Experiments and runs → genesis-model → run genesis-train-$TS."; exit 0;;
    FAILED|SKIPPED|CANCELED|ERROR) echo "RESULT: $ST — the model did NOT recover the truth (or the pipeline errored)."; exit 1;;
  esac
  sleep 12
done
echo "RESULT: timed out waiting for the run"; exit 1
```

## How to report back

State plainly whether it **learned**. If the run SUCCEEDED, say the Genesis model trained on OpenShift AI and recovered the universe's true slope and intercept (`w≈2, b≈1`) from noisy data — that's gradient descent working — and point the user to **Experiments and runs → genesis-model** in the OpenShift AI dashboard to see the loss fall and the `learned_w` / `learned_b` metrics. If it FAILED, say so and share the last state.

## If you're a worker on a kanban board

Treat training as the deliverable for your task: move the card to **In Progress** before you start (`project-board-management`), run the training, then comment the RESULT on the issue and move the card to **Done** only if it SUCCEEDED.
