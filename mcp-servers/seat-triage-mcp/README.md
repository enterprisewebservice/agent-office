# seat-triage-mcp

Read-only tools that let the Hands-On Mode help desk agent look at one
attendee's workshop seat. Registered on the platform's MCP gateway
(`cluster/help-desk/`, prefix `seat_`), consumed by the `handsonmode-help`
AgentWorkstation through the governed gateway like any other tool.

| tool | what it returns |
|---|---|
| `seat_overview(handle)` | seat record, namespaces, workstations, gateways, skills, registrations, pods, pipeline runs, GitOps apps, warnings |
| `seat_progress(handle)` | module-by-module status with evidence and the mistakes those observations usually mean |
| `seat_events(handle, minutes)` | Warning events in the workspace namespace |
| `seat_logs(handle, target, lines)` | redacted log tail of a pod, or the failed step of `pipelinerun:<name>` |
| `seat_gitea(handle, repo, what)` | the seat's Gitea org: repos, commits, pull requests, the workstation YAML |
| `workshop_guide(module, find)` | the guide text for a module, optionally only paragraphs containing a phrase |

Guardrails: a handle must exist in the hub's `factory-seats` ConfigMap; only
`<handle>-agent-workspace` / `showroom-<handle>` are read; Secrets are never
read; token-shaped strings are redacted from every response.

Build in-cluster: `oc create -f cluster/help-desk/build/run/taskrun.yaml`
(after pushing this directory), then bump the image tag in
`cluster/help-desk/seat-triage-deployment.yaml`.
