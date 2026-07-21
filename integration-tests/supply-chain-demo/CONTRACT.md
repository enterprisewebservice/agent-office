# ops-metrics — service contract (the developer agent's definition of done)

This is the specification `forge-dev` builds against. The acceptance test in
`acceptance/test_ops_metrics.py` enforces it mechanically; **the card is done when the test
exits 0 against the live service** (plus the supply-chain gates: green Konflux build, image in
Quay, ArgoCD-synced deployment, gateway registration present).

## What the service is

`ops-metrics` aggregates the existing **orders-api**
(`http://orders-api.agent-office.svc:8080`, override via env `ORDERS_API_URL`) into the answers
an operations manager needs weekly. It holds **no state** and **no credentials** — it reads
orders-api in-cluster and computes.

**Time semantics (critical):** all "now"-relative math uses the **`as_of` anchor returned by
orders-api `GET /healthz`** — never the wall clock. This keeps every answer (and this contract's
expected values) deterministic forever.

## Surfaces

One process, port **8080** (env `PORT`), serving BOTH:

1. **MCP** (streamable-HTTP at `/mcp` — same transport as projectboard-mcp) with tools:
   - `metrics_weekly_summary(weeks: int = 1)`
   - `metrics_stuck_orders(threshold_days: int = 7)`
   - `metrics_top_products(period_days: int = 30, n: int = 5)`
   Tool results are the same JSON objects as the REST mirrors below.
   *(Names as surfaced through the gateway: register with `spec.prefix: metrics_` and name the
   backend tools `weekly_summary` / `stuck_orders` / `top_products`.)*
2. **REST mirrors** (what the acceptance test drives):
   - `GET /healthz` → `{"status":"ok","service":"ops-metrics","as_of":"<orders-api as_of>"}`
   - `GET /v1/summary?weeks=1`
   - `GET /v1/stuck?threshold_days=7`
   - `GET /v1/top-products?period_days=30&n=5`

## Definitions (Morgan's business rules)

- **Weekly summary** (`weeks=1`): orders with `ordered_at` in the window
  `[as_of - weeks*7 days, as_of]` →
  `{"window_days": 7*weeks, "orders": <count>, "revenue": <sum of total, 2dp>,
    "by_status": {"processing": n, "shipped": n, "delivered": n, "cancelled": n, "returned": n}}`
- **Stuck orders** (`threshold_days=7`): `status == "processing"` AND
  `(as_of - updated_at) > threshold_days` →
  `{"threshold_days": 7, "count": <n>, "ids": [<order ids>]}` (ids in any order)
- **Top products** (`period_days=30, n=5`): over orders with `ordered_at` in
  `[as_of - period_days, as_of]`, group by `sku`, sum `qty` (units) and `total` (revenue),
  rank by **revenue desc**, ties by units desc then sku asc →
  `{"period_days": 30, "products": [{"sku","product","units","revenue"} x n]}`
- Money values rounded to **2 decimal places**.

## Acceptance

```bash
python3 integration-tests/supply-chain-demo/acceptance/test_ops_metrics.py <BASE_URL> \
  [path/to/fixtures.json]   # default: manifests/supply-chain-demo/orders-api/hack/fixtures.json
```

The fixtures were computed independently by the orders-api data generator
(`hack/generate_orders.py`) — the service must reproduce them exactly:
`as_of = 2026-07-01T12:00:00Z`, weekly summary (156 orders / 187285.00 revenue), 73 stuck
orders (exact id set), top-5 products by revenue.

## Non-goals (v1)

No auth of its own (the MCP gateway governs access), no persistence, no writes to orders-api,
no pagination. Keep it ~100–200 lines; correctness over cleverness.
