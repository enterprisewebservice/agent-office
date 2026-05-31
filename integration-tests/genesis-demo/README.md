# Genesis demo — the agent platform builds a first-principles model

A persistent, **incrementally-runnable** showcase (and integration test) where
the governed agent team stands up the smallest honest predictive model — a
linear model trained by hand-written gradient descent — on OpenShift AI,
tracks the work on a real GitHub kanban, and curates a first-principles KB.

This is distinct from the ephemeral 7-beat platform suite (`../pipeline/`,
auto-teardown). Here, **nothing is torn down until you run the teardown
explicitly** — so you can show each artifact live.

## Stable identity (so beats build on each other + teardown finds everything)
- agents: `genesis-pm`, `genesis-worker`
- board: GitHub Project "Genesis Model" (org `enterprisewebservice`)
- KB: `genesis-first-principles`
- tracker repo: `genesis-tracker`
- DSP: pipeline `genesis-model` on the `agent-office` DSPA

## Incremental beats (each runs independently and PERSISTS)
| Run | Shows | Codex? |
|---|---|---|
| `genesis-train` | Run the Genesis Model DSP pipeline on OpenShift AI → watch the loss fall + `learned_w → 2`, `learned_b → 1` in the Experiments UI. Asserts `learned_ok=1`. | **no** — runnable now |
| `genesis-team` | PM + worker agents created via the real scaffolder (board skill + Genesis KB) | create: no · run: yes |
| `genesis-board` | **PM agent** creates the "Genesis Model" GitHub Project and decomposes it into first-principles tasks | yes |
| `genesis-work` | **Worker agent** pulls a task → does real work (triggers the training run / writes a KB article) → moves the card `In Progress → Done` | yes |
| `genesis-kb` | the first-principles KB, curated by the agents | yes |

## Teardown — separate + on demand
`genesis-teardown` is its OWN pipeline. It is never automatic. Run it only when
you're done demoing; it idempotently removes the board, issues, agents, KB,
DSP runs, and repos.

## The model (`pipeline/pipeline.py`)
`ŷ = w·x + b`, MSE, hand-written gradient descent — the whole of ML, once,
readable top-to-bottom. Data has a KNOWN truth (`y = 2x + 1 + noise`) so
"learning" is concrete: the model recovers `w≈2, b≈1` from noisy examples.
Compile: `pip install -r pipeline/requirements.txt && python pipeline/pipeline.py`.

## Status
- ✅ `pipeline/pipeline.py` (+ compiled `pipeline.yaml`) — the model
- ⬜ `genesis-train` beat (DSPA upload + run + assert `learned_ok`) — next, codex-independent
- ⬜ first-principles KB seed content
- ⬜ `genesis-teardown` (independent)
- ⬜ LLM beats `genesis-board` / `genesis-work` (after Codex re-auth)
