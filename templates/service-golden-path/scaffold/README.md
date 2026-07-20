# __SVC__

Scaffolded from the agent-office **service golden path**. Everything needed to ride the
production supply chain is already here:

- `.tekton/on-push.yaml` — Konflux docker-build (pinned bundle) fires on every push to main;
  image + SBOM + provenance land in Quay as `__SVC__:main`.
- `gitops/` — deployment/service/HTTPRoute/MCPServerRegistration; the
  `applicationset-managed` marker means ArgoCD adopts and syncs this directory automatically.
- `app/server.py` — streamable-HTTP MCP stub (port 8080). Replace with the real service;
  keep the transport, port, and `/healthz`.

Definition of done for the real implementation lives in the platform repo:
`integration-tests/supply-chain-demo/CONTRACT.md`.
