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
| **`genesis-train` (skill)** | **The worker agent trains the model.** Given a kanban task, `genesis-worker` uses its **`genesis-train` skill** to submit the `genesis-model` pipeline to the OpenShift AI **DSPA** (runs on **Argo**, not Tekton), waits, and reports it learned (recovered `w≈2, b≈1`). `evaluate` HARD-FAILS unless it recovers the truth, so a SUCCEEDED run provably means it learned. The worker moves the card **In Progress → Done** as it works. The skill ships in the Quay **skills image** (`spec.skillsImage`, operator ≥ v1.7.5). | ✅ proven on-cluster |
| `genesis-team` | dedicated `genesis-pm` + `genesis-worker` agents created via the real scaffolder (board skill + Genesis KB) | ⬜ planned |
| **`genesis-board`** | **PM agent** creates the "Genesis Model" GitHub **kanban** board and decomposes the goal into 6 first-principles task issues. Idempotent (reuses an existing board). | ✅ proven on-cluster |
| **`genesis-work`** | **Worker agent** (distinct from the PM — role separation) pulls task N → authors a real deliverable (`docs/task-N.md`) → comments → closes the issue → moves the card to **Done**. | ✅ proven on-cluster |
| **`genesis-mattermost`** | **Chat with the agent in Mattermost** — against the operator-provisioned user `@<agent>` (own name, green presence dot) in `#<agent>`: post a question and the in-cluster `mm-bridge` drives the REAL agent to reply AS itself, with a live "…is typing" indicator. The wow moment: DM/chat your agents like teammates. | ✅ proven on-cluster |
| **`mm-operator-autoprovision`** | **Operator auto-provision** — create an AgentWorkstation and the operator (≥ v1.7.1) auto-creates the Mattermost user + channel; delete it and the finalizer deactivates the user + archives the channel. Idempotent: re-create the agent and its channel is restored. | ✅ proven on-cluster |
| **`genesis-first-principles` (KB)** | The **first-principles Obsidian vault** (`kb/genesis-first-principles/`) — 12 linked notes teaching how a predictive model is built from scratch (`ŷ = w·x + b`, MSE, gradient descent, recovering `w=2, b=1`), grounded line-for-line in `pipeline.py`. Open the folder as an Obsidian vault (graph view + LaTeX). Wires to the agents as a KnowledgeBase so they teach from it. | ✅ readable now |

Run examples:
```
oc create -f run/board-run.yaml                                   # PM plans the board
tkn task start genesis-work -p task-number=3 -s aoit-runner -n agent-office --showlog
```
Both drive the **dedicated** `genesis-pm` / `genesis-worker` agents (created
via the Dev Hub UI E2E and persisted with `KEEP_AGENT=1`, registered on
research-gateway). Create/persist them once:
```
cd ../ui
KEEP_AGENT=1 npm test -- create-agent                         # genesis-pm
AGENT_NAME=genesis-worker DISPLAY_NAME="Genesis Worker" ROLE=worker KEEP_AGENT=1 npm test -- create-agent
```
(Pass `-p pm-agent=pm-agent` / `-p worker-agent=redhat-ai-researcher` to fall
back to the shared production agents.)

### Wow factor — talk to your agents in Mattermost
Self-hosted Mattermost (`cluster/mattermost/`) gives every agent its own
**user account** (own name — a real user shows the green presence dot, which
Mattermost won't render for *bot* accounts), **channel**, and **DM** — all by
API, no captcha, no limits (we pivoted here from Discord, which captcha-walls
bot creation). The **operator itself** auto-provisions this presence the instant
an AgentWorkstation reconciles, and its finalizer tears it down on delete (see
`reconcileMattermost` / `cleanupMattermost`, ≥ v1.7.1). The in-cluster
**`mm-bridge`** then makes a provisioned agent actually *answer*: your message →
the real openclaw agent → a reply under the agent's own name, with a live
"…is typing" indicator and a lit green dot. So in the demo you don't just watch
agents work a board — you **chat with genesis-pm like a teammate** (and it
really does PM work).
```
oc create -f run/mattermost-run.yaml                  # verify the chat round-trip
oc create -f run/mm-operator-autoprovision-run.yaml   # verify operator auto-provision + teardown
# then log into Mattermost and message #genesis-pm
```

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
