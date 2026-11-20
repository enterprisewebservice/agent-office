# Demo agents retired on 19 Nov 2026

Dean kept the two newsdesks (nl2sql.ai, upstreambeat.ai) and the two help desks (Runtab, Hands-On Mode) and retired
the demo agents. These manifests are no longer applied; they stay here as the way back.

| Retired | What it was | Removed with it |
|---|---|---|
| `research-gateway` (`research-gateway.yaml`) | Shared gateway of the research and genesis personas, `forge-dev`, and the Suggest step of the hire form | Its volume with every persona's sessions; ExternalSecret `research-gateway-codex-credentials` |
| `forge-dev` (`forge-dev.yaml`) | Developer agent of the supply-chain demo, on `research-gateway` | GitHub repo `forge-dev-agent-gitops`, Argo CD application, catalog entry |
| `monday-ops-reporter` and `supply-chain-ops-gateway` (`supply-chain-ops-gateway.yaml`, `ops-reporter.yaml`) | Morgan's reporting agent and the gateway Suggest founded for it | GitHub repo `monday-ops-reporter-agent-gitops`, Argo CD application, catalog entry, ExternalSecret `supply-chain-ops-gateway-codex-credentials` |

Git bundles of the two deleted GitHub repos are on Dean's Mac in `~/redhat/agent-backups-20261119/`.
The HavenIQ case worker was retired the same day in `enterprisewebservice/haveniq-support`.

## Bringing `research-gateway` back

1. Add its entry to `cluster/secrets/codex-gateway-credentials.yaml` again (copy a block; names
   `research-gateway-codex-credentials`, Vault key `codex/research-gateway`) and push.
2. `oc apply -f cluster/_removed/2026-11-19-demo-agents/research-gateway.yaml` (bring its image and model up to what
   the kept gateways run first; the file still names what ran on 19 Nov 2026).
3. Sign it in: Developer Hub, Codex Subscription Auth card, Re-authenticate on the `research-gateway` row.
4. `oc apply -f cluster/_removed/2026-11-19-demo-agents/forge-dev.yaml` for the supply-chain demo.

## What still points at `research-gateway`

- The operator's Suggest settings (`AGENT_RECOMMENDER_*` in `cluster/operator/subscription.yaml`). With the gateway
  absent, Suggest answers from keyword scoring.
- The default gateway of the hire templates `openclaw-agent`, `openclaw-agent-genesis` and `karpathy-research-agent`
  in `tssc-dev-multi-ci`. A hire that joins `research-gateway` waits until the gateway exists.
- KnowledgeBase `agent-platform-capabilities` (`cluster/skills/agent-platform-capabilities.yaml`). It and its 1 Gi
  volume were left in place and report `GatewayNotFound`.
- `cluster/demo-prep.sh` and `cluster/demo-status.sh` stop with a pointer to this file.
