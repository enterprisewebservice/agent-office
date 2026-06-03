# Genesis Demo — Video Script (Deep Dive, ~14–16 min)

**Audience:** mixed / conference — lead with the wow, then show how it works.
**Format:** live screen recording + voiceover, on a real OpenShift cluster, in a **visible** browser (never headless).
**The one-sentence arc:** A web form becomes an AI agent; the agent plans a project, does the work on a real kanban board, trains a machine-learning model on OpenShift AI, and chats with you in Mattermost — never holding a credential — and one command undoes all of it. Underneath it's plain **platform engineering**: a Developer Hub plugin, our own CRDs + an operator, and GitOps. **The demo *is* the integration-test suite.**

---

## Recording strategy — read this first

**1. Slow Playwright down so the platform-engineering story is watchable.** The creation flow ran too fast to narrate. Two new knobs (already wired in):
- `SLOWMO=700` — milliseconds between every action; paces the whole wizard.
- `DEMO=1` (+ optional `DEMO_DWELL_MS=12000`) — **pauses on the Compose step**, the binder with the **Knowledge Bases / Skills / MCP servers** tabs, so you can talk over it.

```
cd integration-tests/ui
SLOWMO=700 DEMO=1 KEEP_AGENT=1 npx playwright test create-kb.spec.ts --headed --reporter=line
```

**2. For the hero plugin moment, consider driving it by hand.** You're proud of this plugin — own the pace. Open the wizard yourself (`/create/templates/default/openclaw-agent`), click the **Knowledge Bases**, **Skills**, and **MCP servers** tabs one at a time, and narrate each. Use the paced Playwright run for repeatability and for the parts you don't narrate.

**3. The agent "thinking" beats are slow** (PM planning ≈ 8–15 min; worker ≈ 10 min; training ≈ 5 min) — you can't film them live. **Run the whole thing once before recording** (`teardown` → paced Playwright create → `genesis-e2e` pipeline) so every artifact is standing, then **narrate over the finished screens** (the populated board, the Done cards, the OpenShift AI run, the chat). Film **live** only: the creation, the binder, the chat reply, and the teardown.

- **I (Claude) can drive every live part for you while you record.** Just say go.

**Tabs to pre-open and log into:**
1. **Red Hat Developer Hub** — the agent creation wizard
2. **A terminal** — for `oc get`, the pipeline, and teardown
3. **GitHub** — `enterprisewebservice` org → the `*-agent-gitops` repos, the "Genesis Model" board + the `genesis-tracker` repo
4. **ArgoCD** (OpenShift GitOps) — the agent Applications + the `agent-office-agents` ApplicationSet
5. **OpenShift AI dashboard** — Data Science Pipelines → Runs (`agent-office` project), **and MLflow** (app-launcher → MLflow → Experiments → genesis-model → run `genesis-gd` → `loss`) for the loss curve
6. **Mattermost** — the `agents` team
7. *(optional)* **OpenShift console** — Deployments (gateway, `github-mcp-server`) + the `AgentWorkstation` / `KnowledgeBase` custom resources

---

## THE SCRIPT

### 0:00 — Cold open (the hook)

**SHOW:** A 5-second tease cut — the GitHub board with cards on **Done**, the OpenShift AI training run flipping green with `learned_w ≈ 2.0 / learned_b ≈ 1.0`, a Mattermost reply popping in — then a title card: *"Governed Agent Platform — on OpenShift."*

**SAY:**
> "What if anyone on your team could stand up an AI agent from a web form — and that agent could plan a project, do the work on a real kanban board, *train a machine-learning model*, and talk to you in chat… without ever holding a password or a token… and you could undo every bit of it with one command? That's what you're about to see — live, on a real OpenShift cluster. And underneath the wow, it's just good platform engineering. Let me show you both."

---

### 0:30 — Why a platform

**SHOW:** Brief — the OpenShift console home, or a title slide: "Agents need a platform to stand on."

**SAY:**
> "Anyone can get an agent to call an API in a notebook. The hard part is everything *around* the call: who is this agent, what is it allowed to touch, where did its credentials come from, can you prove what it did, and can you take it all back. That's not a model problem — it's a *platform* problem. Everything here runs on OpenShift Platform Plus, Red Hat's developer tooling, and OpenShift AI. Watch what the platform makes both self-service *and* safe."

---

### 1:30 — Act 1 · A form becomes an agent  *(LIVE, slowed — this is the plugin showcase)*

**SHOW:**
- The **visible Chromium** window (paced run, `SLOWMO=700 DEMO=1`). The Developer Hub scaffolder wizard fills in: name `genesis-pm`, **Genesis PM**, role **pm**, the planning directive. Move deliberately.
- **Stop on the Compose step — the binder plugin.** This is the moment to linger. Click the **Knowledge Bases** tab, then **Skills**, then **MCP servers**. Let each one sit on screen.
- Then the second agent run (`genesis-worker`), where on the binder you check **"create a new knowledge base"** and give it the first-principles topic.

**SAY:**
> "We start with an empty roster, and a form in Red Hat Developer Hub. Name, role, a directive — this is the *Genesis PM*, our planner.
>
> Now watch this screen, because this is a plugin we built, and it's the heart of the platform. When you compose an agent here, you're not writing config — you're picking *capabilities*. This first tab, **Knowledge Bases**: the wikis the agent will learn from. This tab, **Skills**: reusable, governed skills the platform *auto-discovers* and offers you — the agent doesn't install anything; the platform supplies the menu. And this tab, **MCP servers**: the governed tools the agent is allowed to call — GitHub, and others — each one brokered, none of them wide open. That's platform engineering in one screen: a paved road on top, guardrails underneath.
>
> I'll create the worker the same way — and this time I check 'create a new knowledge base' and hand it a topic: the first principles of building a model from scratch. Two agents, born from a form."

---

### 4:00 — Act 2 · How the platform makes it real  *(the platform-engineering segment)*

**SHOW (three quick beats — terminal, then GitHub, then ArgoCD):**
1. **Terminal:** `oc get crd | grep agentoffice` (our custom types), then `oc get agentworkstation` and `oc get knowledgebase`, then `oc get agentworkstation genesis-pm -o yaml` — point at `spec.role`, `spec.knowledgeBaseRefs`, the skills, the gateway. Optionally `oc get pods -n agent-office | grep operator`.
2. **GitHub:** the `genesis-pm-agent-gitops` repo the form just published — show the YAML; this is the agent's *desired state* in Git.
3. **ArgoCD / OpenShift GitOps:** the `genesis-pm-agent` Application syncing that repo (and the `agent-office-agents` ApplicationSet that generated it).

**SAY:**
> "So what did that form actually create? Not a script — a **Kubernetes resource**. We extended Kubernetes with our own types: an **AgentWorkstation**, a **KnowledgeBase**. Here's the Genesis PM as a custom resource — its role, its knowledge bases, its skills, the gateway it joins. Plain, declarative YAML.
>
> And there's an **operator** we wrote, watching for these. The moment one appears, it reconciles reality to match: it stands up the agent's runtime, registers it on the gateway, creates its Mattermost user, mounts its knowledge base. That's the operator pattern — the same way OpenShift runs everything — pointed at *agents*.
>
> But notice the form didn't *do* any of that imperatively. It **wrote the agent's desired state into a Git repo.** ArgoCD watches that repo and syncs it to the cluster; the operator makes it real. Git is the source of truth. Want to change the agent? Change the YAML. Want it gone? **Delete the resource — and everything it created unwinds.** Declarative, in Git, reversible by deleting the resource. That discipline is what turns a pile of agent scripts into an *operable fleet.*"

---

### 6:30 — Act 3 · The PM agent plans the work

**SHOW:** Terminal `oc create -f integration-tests/genesis-demo/run/board-run.yaml` (or already run). Then **GitHub → "Genesis Model" board**: 6 cards in Backlog; click into a couple of issues.

**SAY:**
> "Now the PM agent works. One goal in — build the smallest honest predictive model someone could learn from — and it decomposes that into a plan: a real GitHub Projects board with six task cards it wrote itself. Define the model, write the loss, implement gradient descent, evaluate. Real issues, real repo. It planned this."

**Governance beat:**
> "And it filed those issues *as itself*, through the governed gateway — it never held a GitHub token. Kuadrant brokers every tool call; the credential is a rotating GitHub App identity managed by External Secrets and Vault. The agent gets to act; it never gets to keep the keys."

---

### 8:00 — Act 4 · The worker does the work

**SHOW:** Terminal `work-run.yaml` (or already run). GitHub: a card slides **Backlog → Done**; the issue **closes**; open the repo → the new file `docs/task-1.md`.

**SAY:**
> "Different agent, different role — the Worker, not the planner. It picks the first open card, reads the task, writes a real deliverable grounded in the knowledge base we seeded, pushes it to the repo, comments, closes the issue, and moves the card to Done. Two agents, two identities, two roles — separation of duties, like a real team."

---

### 9:30 — Act 5 · Training a real model on OpenShift AI  *(the flagship)*

**SHOW:** Terminal `train-run.yaml` (or already run). Board: a training card moves **Backlog → In Progress → Done**. Then **OpenShift AI dashboard → Data Science Pipelines → Runs** (in the `agent-office` project) → the **genesis-model** run:
- the **graph** — `generate_data → train_gd → evaluate`, all green = **SUCCEEDED**;
- click **train_gd → Metrics**: `final_train_loss`, `learned_w ≈ 2.0`, `learned_b ≈ 1.0` (in the **Experiments** view these are *sortable columns* across runs);
- click **evaluate → Metrics**: `test_mse`, `learned_ok = 1`;
- *(the "watch it learn" shot)* open **train_gd → Logs** and scroll: `epoch 0 loss=8.9… → epoch 299 loss=0.2…`, with `w` crawling 0 → 2 and `b` → 1.

> 🎯 **The hero shot — the live loss curve in MLflow.** Open MLflow (OpenShift console app-launcher → **MLflow**, or the `data-science-gateway` `/mlflow` route) → **Experiments → genesis-model → the `genesis-gd` run → `loss`**: the loss falls 13 → 0.2 over 300 steps, with `w` climbing to 2.0 and `b` to 1.0, plotted as a real chart. The agent's training logged it there every epoch — token + the `X-MLFLOW-WORKSPACE` header, the documented multi-tenant way. The Data Science Pipelines run above is the *proof it's real* (green = the hard gate passed); MLflow is the *picture*.

**SAY:**
> "This is the moment. The worker now *trains a machine-learning model* on OpenShift AI, using a skill it carries that registers and runs a pipeline on Data Science Pipelines. The model is the simplest honest one — a line, `y = 2x + 1`, learned from noisy data by gradient descent we wrote by hand, no magic library.
>
> And here's the proof: the evaluation step is rigged to *fail* unless the model recovers the true law — slope two, intercept one. So a green run doesn't mean 'it ran' — it means *the model actually learned the truth.* And it's not just a number — the agent logged the whole descent to MLflow, so here's the **loss curve**, falling epoch by epoch as `w` climbs to two and `b` to one; and the run is green — SUCCEEDED, which (because the pipeline is rigged to *fail* unless it recovers the truth) provably means it learned. An agent trained and verified a model on the platform, and tracked the whole thing on the board."

---

### 11:30 — Act 6 · Chat with your agents  *(LIVE)*

**SHOW:** **Mattermost → `agents` team → `#genesis-pm`**. Type a question; show the **"…is typing"** indicator, then a reply from **@genesis-pm** with a **green presence dot** (a real user, not a bot).

**SAY:**
> "These aren't faceless services — they're teammates. The operator gave each agent its own Mattermost user and channel automatically. So I just… talk to it. I ask, it's typing, it answers — as itself, with its own presence. A bridge in the cluster routes the message to the real agent and back. Collaborate with your agents in the tools you already use."

---

### 12:30 — The reveal · This *is* the test suite

**SHOW:** OpenShift Pipelines: the **`genesis-e2e`** pipeline — a green DAG, board → work → train → chat → operator-autoprovision.

**SAY:**
> "Now the part for the engineers. Everything you just watched isn't a demo script — it's our **integration test suite**, running in-cluster on Tekton. Each beat is a pipeline task that asserts a real outcome: the board really has six items, the deliverable really got pushed, the training run really recovered the parameters, the card really moved to Done, the agent really replied. The demo and the test are the same artifact. If the wow works, the tests pass — and if the tests pass, the wow is real. That's how we keep ourselves honest."

---

### 14:00 — Act 7 · One command to undo it all  *(declarative, reversible)*

**SHOW:** Terminal `oc create -f integration-tests/genesis-demo/run/teardown-run.yaml` — logs scrolling. Cut to: the board gone, issues closed, Mattermost users deactivated + channels archived, the agents removed.

**SAY:**
> "Remember declarative and reversible? Here it is. One command deletes the resources, and the operator unwinds everything it built — the agents de-register, their Mattermost presence is archived, the training runs are cleaned up, the board and issues go. No orphans, nothing left holding a credential. Then I can run the entire thing again from scratch — which is exactly what makes it a test."

---

### 15:00 — Outro

**SHOW:** Recap montage — form → binder tabs → CRD/YAML → board → the green training run (`w 2.0 / b 1.0`) → chat → clean slate. End card with the three platform names.

**SAY:**
> "So: a web form became an agent. Underneath, it's a Developer Hub plugin, our own custom resources and an operator, and GitOps doing the work — declarative, attributable, reversible. The agent planned, worked, trained a model that provably learned, and talked to us. That's what a platform buys you. OpenShift Platform Plus, Red Hat's developer tooling, and OpenShift AI — the ground these agents stand on. Thanks for watching."

---

## Recording run-sheet (commands, in order)

**Pre-stage (before recording — leaves everything standing):**
```
# 0. clean slate
oc create -f integration-tests/genesis-demo/run/teardown-run.yaml

# 1. create the two agents in a VISIBLE, PACED browser (record live OR pre-run)
cd integration-tests/ui
SLOWMO=700 DEMO=1 KEEP_AGENT=1 npx playwright test create-agent.spec.ts --headed --reporter=line   # genesis-pm
SLOWMO=700 DEMO=1 KEEP_AGENT=1 npx playwright test create-kb.spec.ts    --headed --reporter=line   # genesis-worker + KB (lingers on the binder)

# 2. run the whole story as one pipeline (board -> work -> train -> chat -> operator)
oc create -f integration-tests/genesis-demo/run/e2e-run.yaml
```

**Platform-engineering beat (Act 2) — show what the form built:**
```
oc get crd | grep agentoffice                         # our custom types
oc get agentworkstation; oc get knowledgebase         # the instances
oc get agentworkstation genesis-pm -o yaml            # the desired state (role, KBs, skills, gateway)
# GitHub: open enterprisewebservice/genesis-pm-agent-gitops   (the YAML in Git)
# ArgoCD: open the genesis-pm-agent Application + the agent-office-agents ApplicationSet
```

**Run beats individually (better for narrating each):**
```
oc create -f integration-tests/genesis-demo/run/board-run.yaml     # PM plans the board
oc create -f integration-tests/genesis-demo/run/work-run.yaml      # worker does a task
oc create -f integration-tests/genesis-demo/run/train-run.yaml     # worker trains on OpenShift AI
oc create -f integration-tests/genesis-demo/run/mattermost-run.yaml  # chat verification
```

**On camera (live):** the two paced Playwright creations · the binder tabs · the Mattermost reply · the teardown:
```
oc create -f integration-tests/genesis-demo/run/teardown-run.yaml
```

---

## Optional on-screen captions (lower-thirds)

- "Created from a web form — no YAML, no kubectl"
- "Compose, don't configure — Knowledge Bases · Skills · MCP servers (a Developer Hub plugin we built)"
- "The form writes a Kubernetes resource — AgentWorkstation / KnowledgeBase (our CRDs)"
- "An operator reconciles it · ArgoCD syncs it from Git · delete the resource to undo it"
- "Acting as itself — never holds a token (Kuadrant MCP gateway + rotating GitHub App identity)"
- "Trained on OpenShift AI — green = the model provably learned (w≈2, b≈1)"
- "Its own Mattermost user + presence"
- "This demo *is* the integration test (Tekton, in-cluster)"
- "One command — fully reversible"

---

## Platform-engineering talking points (for Act 2 — keep these straight)

- **The plugin** (Developer Hub / Backstage field extension): self-service *composition* — Knowledge Bases, auto-discovered Skills, and governed MCP servers as tabs. Compose capabilities, don't hand-write config.
- **The CRDs** we introduced: **AgentWorkstation** (the agent: role, knowledge-base refs, skills, gateway) and **KnowledgeBase** (a wiki the agent learns from). Kubernetes-native — `oc get`, `oc explain`, RBAC, the works.
- **The operator** reconciles those CRs into reality: agent runtime, gateway registration, Mattermost user/channel, KB volume — and finalizers clean them up on delete.
- **GitOps:** the scaffolder publishes a `*-agent-gitops` repo (desired state); the `agent-office-agents` ApplicationSet generates an ArgoCD Application; ArgoCD syncs; the operator reconciles. **Reversible by deleting the resource / the repo.**
- The throughline: **declarative, in Git, reversible** — the same principle the whole platform is built on.

---

## Cast & exact names

- **genesis-pm** — PM / planner agent (role `pm`)
- **genesis-worker** — worker / executor agent (role `worker`) + knowledge base **genesis-first-principles**
- **Board:** "Genesis Model" (GitHub Projects v2, org `enterprisewebservice`) · tracker repo `genesis-tracker`
- **Model:** `y = 2x + 1 + noise`, hand-written gradient descent; evaluation hard-fails unless `w≈2, b≈1`
- **Platform pieces:** Developer Hub + the binder plugin (compose) · AgentWorkstation/KnowledgeBase CRDs + the operator (reconcile) · ArgoCD + ApplicationSet (GitOps) · Kuadrant MCP gateway + `github-mcp-server` + ESO/Vault (governed identity) · OpenShift AI / Data Science Pipelines (training) · Mattermost (chat) · Tekton (the e2e test)
