# runtab-support-mcp

Read-only tools for the Runtab help desk agent (`runtab_account`, `runtab_link`,
`runtab_activity`, `runtab_release`, `runtab_knowledge`). Calls the Runtab
backend's `/internal/support/*` routes in `claude-code-agent` with the backend's
`CCS_API_KEY`, mirrored into `agent-office` by an ExternalSecret. Manifests and
the in-cluster image build live in `cluster/runtab-help/`.
