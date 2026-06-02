# Genesis demo — the agent platform builds a first-principles model

A persistent, **incrementally-runnable** showcase (and integration test) where
the governed agent team stands up the smallest honest predictive model — a
linear model trained by hand-written gradient descent — on OpenShift AI,
tracks the work on a real GitHub kanban, and teaches it from a first-principles KB.

This is distinct from the ephemeral 7-beat platform suite (`../pipeline/`,
auto-teardown). Here, **nothing is torn down until you run the teardown
explicitly** — so you can show each artifact live.

## Stable identity (so beats build on each other + teardown finds everything)
- agents: `genesis-pm`, `genesis-worker`
- board: GitHub Project "Genesis Model" (org `enterprisewebservice`)
- KB: `genesis-first-principles`
- tracker repo: `genesis-tracker`
- DSP: pipeline `genesis-model` on the `agent-office` DSPA

## How the team is orchestrated (PM → worker)
The model is **manager → worker**. The **PM agent** owns the project: it creates
the "Genesis Model" board and decomposes the goal into first-principles task
issues. It then **assigns** a worker agent to a task; the worker executes and
moves its card. The worker knows *what* to work on because the **PM dispatched
it** — not because a script told it. (The assignment step is being moved from
the demo harness onto the PM itself via a lightweight delegate skill, so it is
true agent-to-agent delegation.)

## Incremental beats (each runs independently and PERSISTS)
Tekton Tasks in `beats/`; one-shot run manifests in `run/`.
Apply once: `oc apply -k beats`. Listed in demo order.

| Beat | Shows | State |
|---|---|---|
| **`genesis-team`** | **Both agents created through the Dev Hub UI** (real Backstage scaffolder, Playwright-driven): `create-agent` → `genesis-pm` (planner); `create-kb` → `genesis-worker` (which also stands up its first-principles KB). Persisted with `KEEP_AGENT=1`, registered on research-gateway. | ✅ proven on-cluster |
| **`genesis-board`** | **PM agent** creates the "Genesis Model" GitHub **kanban** board and decomposes the goal into 6 first-principles task issues. Idempotent (reuses an existing board). | ✅ proven on-cluster |
| **`genesis-work`** | **Worker agent** (distinct from the PM — role separation) pulls a task → authors a real deliverable (`docs/task-N.md`) → comments → closes the issue → moves the card to **Done**. | ✅ proven on-cluster |
| **`genesis-train` (skill)** | **The worker trains the model — and stands up its own pipeline.** `genesis-worker` uses its **`genesis-train` skill** to train `genesis-model` on the OpenShift AI **DSPA** (Argo, not Tekton). The skill **registers the pipeline itself**: if the DSPA does not have `genesis-model`, it uploads the `pipeline.yaml` bundled inside the skill (**no human sets up the DSPA**), then submits a run and waits. `evaluate` HARD-FAILS unless the model recovers the truth (`w≈2, b≈1`), so a SUCCEEDED run **provably** means it learned. The worker moves the card **In Progress → Done**. Ships in the Quay **skills image `v0.0.3`** (`spec.skillsImage`, operator ≥ v1.7.5). | ✅ proven on-cluster |
| **`genesis-first-principles` (KB)** | The **first-principles Obsidian vault** (`kb/genesis-first-principles/`) — 12 linked notes teaching how a predictive model is built from scratch (`ŷ = w·x + b`, MSE, gradient descent, recovering `w=2, b=1`), grounded line-for-line in `pipeline.py`. Open the folder as an Obsidian vault (graph view + LaTeX). **Wired to the worker as a live KnowledgeBase**: `create-kb` pushes the vault into the agent's wiki repo, the KB gitMirrors it onto the gateway, and the worker reads it at `~/.openclaw/wiki/` — so it teaches from these notes, not a stub. Re-seeded every run (`../ui/scripts/seed-genesis-kb.sh`). | ✅ wired + readable |
| **`genesis-mattermost`** | **Chat with the agent in Mattermost** — against the operator-provisioned user `@<agent>` (own name, green presence dot) in `#<agent>`: post a question and the in-cluster `mm-bridge` drives the REAL agent to reply AS itself, with a live "…is typing" indicator. The wow moment: DM/chat your agents like teammates. | ✅ proven on-cluster |
| **`mm-operator-autoprovision`** | **Operator auto-provision** — create an AgentWorkstation and the operator (≥ v1.7.1) auto-creates the Mattermost user + channel; delete it and the finalizer deactivates the user + archives the channel. Idempotent: re-create the agent and its channel is restored. | ✅ proven on-cluster |

Run examples:
```
oc create -f run/board-run.yaml                                   # PM plans the board
tkn task start genesis-work -p task-number=3 -s aoit-runner -n agent-office --showlog
```
Both drive the **dedicated** `genesis-pm` / `genesis-worker` agents, created
through the **Dev Hub UI** (real Backstage scaffolder, Playwright-driven) and
persisted with `KEEP_AGENT=1`, registered on research-gateway. Create them once:
```
cd ../ui
KEEP_AGENT=1 npm test -- create-agent     # genesis-pm  (planner)
KEEP_AGENT=1 npm test -- create-kb        # genesis-worker (+ first-principles KB, seeded from the vault)
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
`genesis-teardown` (`beats/genesis-teardown.yaml`) is its OWN Task — never
automatic, not wired into any pipeline. It **wipes the tracker repo by default**
(`delete-repo=true`) so GitHub issue numbers reset each run (they are monotonic
per-repo — leaving the repo makes the work/train beats drift onto stale closed
issues). Removing an **agent** = delete its `<name>-agent-gitops` repo (the
`agent-office-agents` ApplicationSet then prunes the ArgoCD app → the operator
finalizer cleans its Mattermost user + channel); `../ui/scripts/cleanup-agent.sh`
does this idempotently. The board beat recreates the tracker fresh, so the whole
cycle is fully repeatable.
```
oc create -f run/teardown-run.yaml                               # board + issues + tracker repo (full reset)
tkn task start genesis-teardown -p delete-repo=false -s aoit-runner -n agent-office --showlog   # keep the tracker repo
```

## The model (`pipeline/pipeline.py`)
`ŷ = w·x + b`, MSE, hand-written gradient descent — the whole of ML, once,
readable top-to-bottom. Data has a KNOWN truth (`y = 2x + 1 + noise`) so
"learning" is concrete: the model recovers `w≈2, b≈1` from noisy examples.
Compile: `pip install -r pipeline/requirements.txt && python pipeline/pipeline.py`.
The compiled `pipeline.yaml` is **bundled into the `genesis-train` skill**, so the
worker registers it on the DSPA itself — no human pre-registration.

## Status
- ✅ `pipeline/pipeline.py` (+ compiled `pipeline.yaml`) — the model
- ✅ `genesis-team` — both agents created via the Dev Hub UI scaffolder (Playwright)
- ✅ LLM beats `genesis-board` / `genesis-work` — PM plans the board, worker delivers + moves cards
- ✅ `genesis-train` — the worker **self-registers** the DSPA pipeline + runs it; proven (run SUCCEEDED, recovered `w≈2, b≈1`)
- ✅ `genesis-first-principles` KB — seeded from the vault into the worker's KB (gitMirror) every `create-kb` run
- ✅ `genesis-teardown` — wipes board + tracker; agents removed via gitops-repo delete (repeatable reset)
- ⏳ **PM delegation** — PM *assigns* a worker to a task agent-to-agent, replacing the script-injected assignment (lighter PM-delegate skill, in progress)
