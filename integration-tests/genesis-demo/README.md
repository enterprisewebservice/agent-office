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
Tekton Tasks in `beats/`; one-shot run manifests in `run/`.
Apply once: `oc apply -k beats`.

| Beat | Shows | State |
|---|---|---|
| `genesis-train` | Run the Genesis Model DSP pipeline on OpenShift AI → watch the loss fall + `learned_w → 2`, `learned_b → 1` in the Experiments UI. Asserts `learned_ok=1`. | ⬜ next, codex-independent |
| `genesis-team` | dedicated `genesis-pm` + `genesis-worker` agents created via the real scaffolder (board skill + Genesis KB) | ⬜ planned |
| **`genesis-board`** | **PM agent** creates the "Genesis Model" GitHub **kanban** board and decomposes the goal into 6 first-principles task issues. Idempotent (reuses an existing board). | ✅ proven on-cluster |
| **`genesis-work`** | **Worker agent** (distinct from the PM — role separation) pulls task N → authors a real deliverable (`docs/task-N.md`) → comments → closes the issue → moves the card to **Done**. | ✅ proven on-cluster |
| `genesis-kb` | the first-principles KB, curated by the agents | ⬜ planned |

Run examples:
```
oc create -f run/board-run.yaml                                   # PM plans the board
tkn task start genesis-work -p task-number=3 -s aoit-runner -n agent-office --showlog
```
Both currently drive the SHARED research-gateway agents (`pm-agent` as PM,
`redhat-ai-researcher` as worker) — proving role separation today; the
`genesis-team` beat will swap in dedicated `genesis-pm`/`genesis-worker`.

### The kanban board view (important)
GitHub's GraphQL API **cannot author a project view or set its layout** — board
views exist only in the UI. The single supported API path to a board-layout
view is `copyProjectV2`, which copies a project *including its views* (this is
how GitHub's own project-template feature works). So the platform keeps ONE
protected template project — **"Kanban Template — DO NOT DELETE"** (org
`enterprisewebservice`) — and `projectboard-mcp` `create_project_board`
**copies it** (resolved by title) for every new board. Deleting that template
makes new boards silently fall back to a flat table view. Do not delete it.

## Teardown — separate + on demand
`genesis-teardown` (`beats/genesis-teardown.yaml`) is its OWN Task. It is never
automatic and is not wired into any pipeline. Default: delete the board + close
all issues (reversible). Opt-in `delete-repo=true` also removes the tracker
repo. It never touches agents (the beats reuse shared production agents).
```
oc create -f run/teardown-run.yaml                                # board + issues
tkn task start genesis-teardown -p delete-repo=true -s aoit-runner -n agent-office --showlog
```

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
