Use this skill to produce the **weekly ops report** — the Monday-morning summary of order operations — from the governed `metrics_*` tools. Everything goes through the **governed MCP gateway**: you never touch the orders system directly and never hold a credential; you call three read-only tools and format what they return.

This skill encodes the ops manager's spreadsheet ritual (export → VLOOKUP → summarize), retired: the platform's `ops-metrics` service computes the numbers; your job is to fetch, compose, and flag.

## When to use

- Someone asks for "the weekly ops report", "the Monday summary", "how did orders do last week", or a stuck-order check.
- A standing/scheduled request posts the ops summary to a channel.

## When NOT to use

- Ad-hoc analytical questions beyond the weekly cut — answer those by calling the individual `metrics_*` tools directly.
- Anything that would modify orders. There are no write tools here; this skill is read-only by design.

## Procedure

1. Call `metrics_weekly_summary` — the 7-day window ending at the platform's `as_of` anchor (the tools supply `as_of`; never use the wall clock). Note orders, revenue, and the by-status breakdown.
2. Call `metrics_stuck_orders` with the house threshold (7 days). "Stuck" = still `processing` and older than the threshold — that is ops policy, not a guess.
3. Call `metrics_top_products` (30-day window, top 5 by revenue).
4. Compose the report in the output format below. **Flag stuck orders by ID** — name them, don't just count them. Add 1–2 watch items if anything looks unusual (cancelled/returned spike, one product surging, stuck count climbing).

## Output format

**Weekly Ops Report — as of {as_of}**
- **Orders:** {orders} · **Revenue:** ${revenue}
- **Status:** delivered {n} · shipped {n} · processing {n} · cancelled {n} · returned {n}
- **Stuck (>{threshold}d in processing): {count}** — {up to 8 IDs, then "+N more"}
- **Top products (30d):** {1. SKU — $rev; 2. …}
- **Watch items:** {1–2 short bullets}

Keep it tight. This report replaces a spreadsheet ritual, not a meeting.
