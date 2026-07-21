Use this skill to produce **a headless verification artifact for the skill-authoring template** using the governed tools listed below. Everything goes through the **governed MCP gateway**: you never touch backing systems directly and never hold a credential; you call the named tools and work with what they return.

## When to use

- Never; this is a probe created by the platform test harness.

## When NOT to use

- Always.
- Anything that would modify backing systems this skill only reads from.

## Procedure

1. Exist.
2. Be reviewed in a PR.
3. Be closed unmerged.

## Output format

None.

## Governed tools this skill calls

- `metrics_weekly_summary`

