# 10 — Run it yourself

The notes are the *why*. Here's the *do* — watch a model actually learn, on the
real platform, in three ways from easiest to fullest.

## A. On your laptop (60 seconds, no cluster)
The model code stands alone. From `integration-tests/genesis-demo/pipeline/`:
```bash
pip install numpy
python -c "import pipeline"   # or paste train_gd's body into a REPL
```
Better: read [[06 - The training loop, line by line]] with the file open. Every
printed `epoch … loss … w … b` line is `w` crawling 0 → 2 and the loss falling.

## B. On OpenShift AI — the real run (the demo's payoff)
`pipeline/pipeline.py` is a **Kubeflow Pipelines (KFP v2)** pipeline:
`generate_data → train_gd → evaluate`. It runs on the `agent-office` **Data
Science Pipelines** server (DSPA). The `genesis-train` beat compiles + uploads +
runs it and asserts it learned:
```bash
oc create -f integration-tests/genesis-demo/run/train-run.yaml      # runs on the DSPA
```
Then open the **OpenShift AI dashboard → Experiments → Runs → `genesis-model`**.
You're watching the same five beats from [[06 - The training loop, line by line]], now as a real, reproducible run.

> [!success] What to look for in the Experiments UI
> Each component logs **Metrics** that become sortable columns:
> - `final_train_loss` — falls toward the noise floor (~0.25 here, = the
>   variance the noise put in; the model can't, and shouldn't, beat the noise).
> - `learned_w` → **≈ 2.0**, `learned_b` → **≈ 1.0** — the recovered law of the
>   universe ([[02 - The data and the hidden truth]]).
> - `test_mse` — error on points it never trained on ([[07 - Did it actually learn]]).
> - `learned_ok` → **1** — the single pass/fail flag: it recovered the truth.

## C. Let the agents do it (the governed-agent story)
The Genesis agent team treats "build the model" as real work:
- `genesis-pm` decomposes it into first-principles tasks on a GitHub kanban
  (each task ≈ one note in this vault).
- `genesis-worker` runs the pipeline, reads `learned_ok` from the run, and
  reports back.
- You can **chat with them in Mattermost** (`#genesis-pm`, `#genesis-worker`)
  and ask them to explain any step — they read *this very KB* to answer.

> [!tip] The point of the whole demo
> You don't just *read* how a predictive model is built from first principles —
> you watch a governed agent **build one, train it, and prove it learned**, with
> every step recorded and auditable. The math in these notes and the numbers in
> the Experiments UI are the same thing, seen from two sides.

→ Back to [[Genesis — First Principles of a Predictive Model|the index]]
