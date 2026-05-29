# Governed Agent Platform — Demo Storyboard & Integration Suite

This file is the **single definition** of two things at once:

1. **The wow-factor demo** — the narrated arc that shows why the Governed
   Agent Platform matters.
2. **The integration test suite** — each demo beat is a Tekton task that
   *proves the beat works*. The suite running green **is** the demo working.

> The thesis (same as the sales deck): we sold microservices by selling the
> platform they needed to stand on. Agents are no different. **Agents need a
> platform to stand on — OpenShift Platform Plus + RHADS + RHOAI is it.**
> Every beat below is a thing that is *hard or unsafe* without that platform
> and *self-service + governed* with it.

## How you watch it

The suite runs as **one Tekton Pipeline** (`agent-office-integration-tests`).
Each beat is a Task; the DAG lighting up green narrates the demo. You watch it
in **Dev Hub → the `agent-office-integration-tests` Component → CI tab**
(RHDH Tekton plugin), with live per-task logs. A `finally` task tears down
everything the run created, so it is safe to replay on demand.

- **Run it:** `oc create -f integration-tests/run/pipelinerun.yaml`
  (creates a fresh `PipelineRun`; nothing on anyone's laptop).
- **Watch it:** Dev Hub CI tab, or OpenShift Console → Pipelines.
- **Teardown:** automatic (`finally`); a run leaves no orphaned namespace,
  agent, or GitHub repo behind.

## Ephemerality contract

Every beat that creates cluster state does so in a per-run ephemeral namespace
`agent-office-it-<run-id>` (with its own image-volume SCC RoleBinding, since
that SCC is namespace-scoped). Beats that touch **external** systems (GitHub
repos in the scaffold beat, a GitHub Issue in the MCP beat) record what they
created and delete it in teardown. Anything that can't be auto-cleaned is
logged loudly — no silent leftovers.

---

## The arc — 4 acts, 8 beats, 3 peaks

Rising arc with three peaks: **compose → real work → autoresearch.**

| # | Beat | The "wow" | What you see | Proven by (test) | Peak |
|---|------|-----------|--------------|------------------|------|
| **Act 1 — Self-service, governed creation** |
| 1 | **Compose** | Anyone builds a governed agent in minutes — pick KBs, see auto-discovered skills, toggle tools — no YAML, no ticket | Dev Hub create wizard with the AgentComposer binder; selections become the agent's spec | `beat-1-compose` — scaffolder API creates the agent; assert gitops repo + catalog entity carry the composed `knowledgeBaseRefs` / `mcpServers` | ⛰ 1 |
| 2 | **Materialize** | Submit → it's all in git, synced by Argo, reconciled by the operator | gitops repo + ArgoCD app + catalog Component appear; gateway pod goes Ready | `beat-2-materialize` — operator reconciles the AW → gateway Deployment Ready | |
| **Act 2 — The guardrails (why an enterprise says yes)** |
| 3 | **Zero standing creds** | The agent holds no durable secret and runs least-privilege | Secrets are ESO-projected from Vault (rotating); pod runs under the constrained `agent-office-imagevol` SCC; skills mounted read-only via image-volume | `beat-3-guardrails` — assert no plaintext creds in spec; SCC annotation on pod; image-volume mounted read-only | |
| 4 | **Open-standard skills** | Skills are an open catalog the agent discovers at runtime, not hard-wired | `skillSrc=image`; workspace populated from `/skills-catalog/skills`; SKILL.md folders | `beat-4-skills` — operator branch returns `image`; workspace skill set == catalog | |
| **Act 3 — Real autonomous work (the payoff)** |
| 5 | **Work through the gateway** | An agent does real, attributable work through a governed tool gateway | PM agent files a GitHub Issue / Projects v2 card via the Kuadrant MCP Gateway, as the App identity — never holds the token | `beat-5-mcp` — drive the agent to create an Issue through the gateway; assert it exists + authored by the App; delete it in teardown | ⛰ 2 |
| 6 | **The flagship** | A self-improving research loop runs continuously on the platform | Karpathy QLoRA round: deterministic searcher + strategist agent; experiment surfaces in RHOAI; wiki KB grows | `beat-6-autoresearch` — start an AutoResearchProject; assert a round runs + an RHOAI experiment/run appears | ⛰ 3 |
| **Act 4 — Ongoing governance + reversibility** |
| 7 | **Audit** | Every change to an agent is a reviewable PR, not a console click | Edit the agent from its Dev Hub page (binder card) → a PR opens against its gitops repo | `beat-7-audit` — call the binder Save path; assert a PR is opened | |
| 8 | **Teardown** | Reversible by deletion — no orphans, ever | Delete the resources → namespace, agent, gateway, repos all gone | `finally` teardown task — assert the ephemeral namespace + created externals are gone | |

---

## Beat → chosen test areas (nothing lost from the original scope)

The four areas picked for v1 map across the beats:

- **Core operator reconcile** → Beats 2, 3, 4
- **KB attach + MCP wiring** → Beats 4, 5
- **HTTP endpoints** (the wizard/card depend on) → Beats 1, 7 (plugin-facing)
- **Full template scaffold e2e** → Beats 1, 2

## Pipeline shape (extensible by design)

```
agent-office-integration-tests (Pipeline)
├─ setup            → create ephemeral ns + image-volume SCC RoleBinding
├─ beat-1-compose         ┐
├─ beat-2-materialize     │  Act 1
├─ beat-3-guardrails      ┐
├─ beat-4-skills          │  Act 2
├─ beat-5-mcp             ┐
├─ beat-6-autoresearch    │  Act 3
├─ beat-7-audit           │  Act 4
└─ finally: teardown → delete ns + any external repos/issues created
```

**Adding a beat later** = add one Task referenced from the Pipeline + a row in
the table above. The CI tab picks it up automatically on the next run.

## Status

- [ ] Phase 0 — enable K8s + Tekton plugins; CI tab visible
- [ ] Phase 1 — Pipeline + SA/RBAC + first green beat (HTTP endpoints)
- [ ] Phase 2 — Act 1+2 beats
- [ ] Phase 3 — Act 3+4 beats
