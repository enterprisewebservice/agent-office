Use this skill to turn a project objective into a **managed GitHub kanban board** — create the board, break the objective into well-scoped tasks, file them as issues, place them on the board, and move cards across columns as work progresses. Everything here goes through the **governed MCP gateway**: you never see a raw GitHub credential; you just call the tools.

## When to use

- The user (or a PM/intake flow) hands you a project goal and wants it tracked on a board ("stand up a kanban for X with the initial tasks").
- You need to add, prioritize, or move tasks on an existing Projects v2 board.
- You're the PM agent decomposing an intake request into trackable work.

## When NOT to use

- A single throwaway task with no tracking need — just open one issue with `github_issue_write`.
- Anything outside GitHub Projects v2 (this is GraphQL Projects v2, org- or user-owned, not classic repo project boards).

## The governed tools you have

Board lifecycle (this platform's `projectboard-mcp` server — fills the gap the stock GitHub MCP server can't do):
- `projectboard_create_project_board(owner, title, owner_type="org")` → creates a Projects v2 board. Returns `{id, number, title, url}`. `number` is the `project_number` the `github_projects_*` tools take; `id` is the node ID to delete it.
- `projectboard_delete_project_board(project_id)` → deletes the board (use for teardown/cleanup).

Tasks + board items (stock `github-mcp-server`):
- `github_issue_write(method="create", owner, repo, title, body, labels?)` → create an issue (a task). `method="update"` to edit/close it.
- `github_projects_write(method="add_project_item", owner, project_number, item_type="issue", item_owner, item_repo, issue_number)` → put an issue onto the board.
- `github_projects_write(method="update_project_item", owner, project_number, item_id, updated_field={...})` → set a field on a card — this is how you MOVE a card across kanban columns (set the **Status** single-select).
- `github_projects_write(method="create_project_status_update", owner, project_number, body, status=ON_TRACK|AT_RISK|OFF_TRACK|COMPLETE)` → post a board-level status update.
- `github_projects_get` / `github_projects_list` → read a board, its items, and its **fields** (you need this to discover the Status field + its option IDs before moving a card).

## Procedure

### 1. Create the board
Call `projectboard_create_project_board(owner=<org>, title=<clear board title>, owner_type="org")`. Keep the returned `number` (project_number) and `id`. A fresh Projects v2 board ships with a default **Status** single-select field: `Todo`, `In Progress`, `Done` — those are your columns.

### 2. Decompose the objective into MEANINGFUL tasks
A good board is not a dump of vague headings. Break the goal into tasks that are:
- **Actionable** — starts with a verb, one clear outcome ("Add ESO ExternalSecret for the wiki token", not "secrets").
- **Right-sized** — a few hours to ~a day each; split anything bigger.
- **Independent where possible** — note hard dependencies in the body.
- **Verifiable** — the body says how you'll know it's done (acceptance criteria).
Aim for a coherent first slice (~5–10 tasks), not an exhaustive backlog. Order them by dependency/priority.

### 3. File each task as an issue
For each task: `github_issue_write(method="create", owner=<org>, repo=<repo>, title=<task title>, body=<context + acceptance criteria>, labels=[...])`. Capture each returned `issue_number`. Use a real repo the project lives in (or a dedicated tracking repo).

### 4. Place tasks on the board
For each issue: `github_projects_write(method="add_project_item", owner=<org>, project_number=<number>, item_type="issue", item_owner=<org>, item_repo=<repo>, issue_number=<n>)`. Capture each returned `item_id`.

### 5. Set initial columns (Status)
New items land with empty Status. To put a card in a column you must set its Status option, and Projects v2 wants the field ID + the **option ID**, not the label:
1. `github_projects_get` the board to read its fields; find the single-select named `Status` and the option IDs for `Todo` / `In Progress` / `Done`.
2. `github_projects_write(method="update_project_item", owner, project_number, item_id, updated_field={"id": <Status field id>, "value": <option id>})`.
Put everything in `Todo` to start; move the first task(s) you'll tackle to `In Progress`.

### 6. Moving a card as work progresses
Same as step 5 — `update_project_item` with the Status field and the new option ID (e.g. `Done` when the task's issue is closed). When you finish a task, also `github_issue_write(method="update", ..., state="closed")` so the issue and the card agree.

### 7. Post a status update (optional but nice)
`github_projects_write(method="create_project_status_update", owner, project_number, body="<1–2 lines on where the board stands>", status=ON_TRACK)`.

## Structuring a board that reads well
- **Columns**: stick to `Todo → In Progress → Done` unless the user asks for more. Don't invent columns you won't maintain.
- **WIP discipline**: only the task(s) actively being worked belong in `In Progress`.
- **Titles are the interface**: a stranger should understand the plan from the column + titles alone.
- **Link the work**: when a task produces a PR, reference the issue (`Closes #n`) so closing the PR closes the issue.

## Cleanup / idempotency
If you created a board for a test or a throwaway demo, tear it down with `projectboard_delete_project_board(project_id=<id>)` (deleting the board removes its items; close any issues you opened). For real projects, leave the board — it's the durable artifact.
