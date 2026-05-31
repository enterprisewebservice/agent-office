# projectboard-mcp — governed Projects-v2 create/delete

The upstream `github-mcp-server` (`--toolsets=all`) exposes only **item**
tools for Projects v2 (`github_projects_write`: add/update/delete items,
status updates). It **cannot create a board**. Projects-v2 creation is
GraphQL-only (`createProjectV2` / `deleteProjectV2`) — exactly the access
the GitHub App already has (the Projects-v2 spike, task #31).

This tiny server fills that one gap: two tools, `create_project_board` /
`delete_project_board`, registered on the **same Kuadrant MCP gateway**
as github-mcp-server, with the **same ESO-managed App token**. An agent
calls them like any governed MCP tool — no raw credentials — then uses the
existing `github_projects_*` tools to populate and manage the board.

```
agent → MCP gateway (/mcp, per-user auth)
          ├── github_*        → github-mcp-server   (issues, PRs, project ITEMS)
          └── projectboard_*  → projectboard-mcp     (CREATE / DELETE the board)   ← this server
                                     │ envFrom github-mcp-installation-token (GraphQL)
                                     ▼
                                api.github.com/graphql  (createProjectV2 / deleteProjectV2)
```

## Layout
- `server.py` — FastMCP streamable-HTTP server, the two tools.
- `Dockerfile`, `requirements.txt` — UBI9 Python build.
- `../../cluster/projectboard-mcp/` — Deployment, Service, HTTPRoute,
  MCPServerRegistration (`toolPrefix: projectboard_`), kustomization.
- `../../cluster/projectboard-mcp/build/` — in-cluster Tekton build.

## Increment 1 execution (this server live + tested)
1. **Commit + push** the source (so the in-cluster build can clone it).
2. **Build** the image in-cluster:
   `oc create -f cluster/projectboard-mcp/build/run/taskrun.yaml` →
   pushes `…/deanpeterson/projectboard-mcp:v0.0.1` to the cluster Quay.
   (verify the `pipeline` SA can run buildah; link `quay-push-secret` if needed.)
3. **Deploy + register**: `oc apply -k cluster/projectboard-mcp/`
   (or let ArgoCD sync). Confirm the MCPServerRegistration goes Ready and
   the gateway's tools/list now includes `projectboard_create_project_board`.
4. **Test** (deterministic): MCP-probe the gateway →
   `projectboard_create_project_board(owner=enterprisewebservice, title=…)`
   → verify via GraphQL the board exists → `projectboard_delete_project_board`
   → verify gone. Wire this as `beat-projectboard-create` in the suite.
   - PREREQ: the App needs `organization_projects: write` for org-owned
     boards. If create returns a permissions error, extend the App.

## Roadmap (the capstone demo)
- **Increment 1** (this): governed create-board capability + deterministic beat.
- **Increment 2**: PM agent gets a project-management **skill** (SKILL.md
  teaching `projectboard_*` + `github_projects_*`) + a **KB** on structuring
  a kanban. Given a goal, the PM agent plans + creates a meaningful board + tasks.
- **Increment 3**: a worker agent picks a task off the board, completes it
  (file/PR), and moves the card to Done (`github_projects_write update_project_item`).
- **Increment 4**: the demo-able beat orchestrating 1–3, watchable in Dev
  Hub, idempotent teardown (board + issues + agents).
