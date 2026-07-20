#!/usr/bin/env python3
"""Deterministic seed data for orders-api (supply-chain demo scenery).

Generates:
  - orders.json          (compact; served by orders-api)
  - orders-data.yaml     (ConfigMap wrapping orders.json)
  - fixtures.json        (expected aggregates — the acceptance-test oracle for ops-metrics)

Everything is anchored to AS_OF (a fixed business date) so ages like "stuck > 7 days in
processing" are stable forever: the API computes ages against AS_OF, never the wall clock.
Re-running this script reproduces byte-identical output (seeded RNG).
"""
import json, random
from datetime import date, datetime, timedelta
from pathlib import Path

SEED = 42
AS_OF = datetime(2026, 7, 1, 12, 0, 0)          # the demo's "today"
DAYS_OF_HISTORY = 180
N_ORDERS = 2000
STUCK_DAYS = 7

random.seed(SEED)

PRODUCTS = [  # sku, name, unit_price
    ("SKU-1001", "Field Service Kit", 189.00),
    ("SKU-1002", "Depot Charging Dock", 349.00),
    ("SKU-1003", "Handheld Scanner X2", 429.00),
    ("SKU-1004", "Rugged Tablet 10in", 899.00),
    ("SKU-1005", "Spare Battery Pack", 59.00),
    ("SKU-1006", "Vehicle Mount", 129.00),
    ("SKU-1007", "Thermal Label Printer", 279.00),
    ("SKU-1008", "Label Rolls (24pk)", 42.00),
    ("SKU-1009", "Extended Warranty", 149.00),
    ("SKU-1010", "Deployment Service Day", 1200.00),
]
CUSTOMERS = [
    "Acme Logistics", "Bluewater Foods", "Cascade Medical", "Dunbar Retail Group",
    "Eastgate Manufacturing", "Fairview Utilities", "Granite Freight", "Harborline Stores",
    "Ironwood Construction", "Juniper Pharmacies", "Kestrel Airfreight", "Lakeshore Grocers",
    "Meridian Energy", "Northfield Dairy", "Overland Parcel", "Pinehurst Clinics",
]
REGIONS = ["NA-East", "NA-Central", "NA-West", "EMEA", "APAC"]
CARRIERS = ["FastFreight", "BlueParcel", "RoadRunner", "AirLink"]
# status mix: weights chosen so ~4% of all orders end up stuck-in-processing
STATUSES = ["delivered", "shipped", "processing", "cancelled", "returned"]


def pick_status(age_days: float) -> str:
    if age_days < 2:
        return random.choices(["processing", "shipped"], [0.7, 0.3])[0]
    if age_days < STUCK_DAYS:
        return random.choices(["processing", "shipped", "delivered", "cancelled"],
                              [0.25, 0.35, 0.35, 0.05])[0]
    return random.choices(STATUSES, [0.72, 0.12, 0.045, 0.065, 0.05])[0]


def main() -> None:
    out_dir = Path(__file__).resolve().parent.parent
    orders = []
    for i in range(N_ORDERS):
        age = random.random() ** 1.35 * DAYS_OF_HISTORY      # denser recent history
        ordered = AS_OF - timedelta(days=age)
        status = pick_status(age)
        sku, name, price = random.choice(PRODUCTS)
        qty = random.choices([1, 2, 3, 5, 10, 25], [0.42, 0.22, 0.14, 0.12, 0.07, 0.03])[0]
        if status == "processing":
            updated = ordered + timedelta(hours=random.uniform(1, 36))
        elif status in ("shipped", "delivered"):
            updated = ordered + timedelta(days=random.uniform(0.5, 6))
        else:                                                 # cancelled / returned
            updated = ordered + timedelta(days=random.uniform(0.2, 20))
        updated = min(updated, AS_OF - timedelta(hours=1))
        orders.append({
            "id": f"ORD-{2026 if ordered.year == 2026 else ordered.year}-{10000 + i}",
            "customer": random.choice(CUSTOMERS),
            "region": random.choice(REGIONS),
            "sku": sku,
            "product": name,
            "quantity": qty,
            "unit_price": price,
            "total": round(qty * price, 2),
            "status": status,
            "carrier": random.choice(CARRIERS) if status in ("shipped", "delivered") else None,
            "ordered_at": ordered.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "updated_at": updated.strftime("%Y-%m-%dT%H:%M:%SZ"),
        })
    orders.sort(key=lambda o: o["ordered_at"])

    payload = {"as_of": AS_OF.strftime("%Y-%m-%dT%H:%M:%SZ"), "orders": orders}
    blob = json.dumps(payload, separators=(",", ":"))
    (out_dir / "hack" / "orders.json").write_text(blob)

    # ---- ConfigMap wrapper -------------------------------------------------
    cm = [
        "apiVersion: v1",
        "kind: ConfigMap",
        "metadata:",
        "  name: orders-api-data",
        "  namespace: agent-office",
        "  labels:",
        "    app: orders-api",
        "    app.kubernetes.io/part-of: supply-chain-demo",
        "data:",
        "  orders.json: |",
        "    " + blob,
    ]
    (out_dir / "orders-data.yaml").write_text("\n".join(cm) + "\n")

    # ---- fixtures: the oracle ops-metrics acceptance tests assert against --
    def parse(ts): return datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ")
    week_ago = AS_OF - timedelta(days=7)
    weekly = [o for o in orders if parse(o["ordered_at"]) >= week_ago]
    stuck = [o for o in orders
             if o["status"] == "processing"
             and (AS_OF - parse(o["updated_at"])).total_seconds() > STUCK_DAYS * 86400]
    by_product = {}
    for o in weekly:
        if o["status"] not in ("cancelled", "returned"):
            p = by_product.setdefault(o["sku"], {"sku": o["sku"], "product": o["product"],
                                                 "units": 0, "revenue": 0.0})
            p["units"] += o["quantity"]
            p["revenue"] = round(p["revenue"] + o["total"], 2)
    top = sorted(by_product.values(), key=lambda p: -p["revenue"])[:5]
    fixtures = {
        "as_of": payload["as_of"],
        "stuck_threshold_days": STUCK_DAYS,
        "weekly_summary": {
            "orders": len(weekly),
            "revenue": round(sum(o["total"] for o in weekly
                                 if o["status"] not in ("cancelled", "returned")), 2),
            "by_status": {s: sum(1 for o in weekly if o["status"] == s) for s in STATUSES},
        },
        "stuck_orders": {"count": len(stuck), "ids": [o["id"] for o in stuck]},
        "top_products": top,
    }
    (out_dir / "hack" / "fixtures.json").write_text(json.dumps(fixtures, indent=2))

    print(f"orders={len(orders)}  weekly={len(weekly)}  stuck={len(stuck)}  "
          f"blob={len(blob)//1024}KiB  top1={top[0]['sku'] if top else '-'}")


if __name__ == "__main__":
    main()
