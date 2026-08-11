---
name: delegate-task
description: As a PM/manager agent, assign the next open task on your project board to a worker agent and have it execute the task end to end — agent-to-agent delegation. Use after you have planned a board (project-board-management) and a task needs doing.
---

Use this skill to **delegate** a task from your project board to a worker agent.
This is the core of being a PM: you do not do the work yourself — you **assign**
it to a worker and then track it. A worker is just another openclaw agent on your
gateway; you delegate by driving it directly. The worker knows what to do because
**you dispatched it**, not because a script told it.

## When to use
- You have planned a board and want a worker to execute a task ("delegate the next task", "assign a worker to a task").
- You manage a project and a task needs doing.

## When NOT to use
- Doing the task yourself — you are the PM; delegate it.
- There are no OPEN tasks on the board — report that and stop.

## How to delegate

1. **Find the next task.** Use your github tools to read YOUR project board and the
   task issues on it:
   - `github_projects_list` / `github_projects_read` → find your board (e.g. "Genesis Model"), its **number**, and the issues on it.
   - Pick the **lowest-numbered issue whose state is OPEN** — that is the next task. Note its number `N`, the org/owner, the tracker repo, and the board number `BNUM`.
   - If every task is closed, report "no open tasks" and stop.

2. **Pick the worker** for this project (e.g. `genesis-worker`).

3. **Delegate — drive the worker on the task.** Run this with bash, substituting the
   real `WORKER`, `OWNER`, `REPO`, `BNUM`, `N`, and `BOARD-TITLE`:

   ```bash
   openclaw agent --agent <WORKER> --json --timeout 540 --message "You are a worker engineer on the <BOARD-TITLE> project (org <OWNER>, GitHub Projects v2 board number <BNUM>, tracker repo <OWNER>/<REPO>). Complete TASK #<N> end to end: 1. Read issue #<N> (github_issue_read). 2. Author a concrete, correct first-principles deliverable specific to this task and push it to branch main at docs/task-<N>.md using github_push_files (~25 lines). 3. Comment on issue #<N>. 4. Close issue #<N> (github_issue_write, state closed). 5. Move its card on board <BNUM> to Done. Report what you pushed, that the issue is closed, and that the card is Done."
   ```

   The worker runs as a real agent, does the work through the governed MCP gateway,
   and returns its result.

4. **Record the delegation.** Read the worker's result. Comment on issue #`<N>`
   (`github_add_issue_comment`) noting that **you, the PM, delegated this task to
   `<WORKER>`** and summarizing the outcome — so the board is the audit trail of
   who assigned what to whom.

5. **Report.** State which task you delegated, to which worker, and the result
   (deliverable pushed, issue closed, card Done — or what failed).
