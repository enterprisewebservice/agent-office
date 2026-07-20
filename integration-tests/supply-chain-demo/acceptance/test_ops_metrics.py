#!/usr/bin/env python3
"""Acceptance test for ops-metrics (see ../CONTRACT.md). Stdlib only.

Usage: test_ops_metrics.py <BASE_URL> [FIXTURES_JSON]
Exit 0 = contract satisfied. Every check prints PASS/FAIL; failures list expected vs got.
"""
import json, sys, os, urllib.request

def get(base, path):
    with urllib.request.urlopen(base.rstrip("/") + path, timeout=30) as r:
        return json.loads(r.read())

def money(x):
    return round(float(x) + 1e-9, 2)

def main():
    if len(sys.argv) < 2:
        print(__doc__); return 2
    base = sys.argv[1]
    fx_path = sys.argv[2] if len(sys.argv) > 2 else os.path.join(
        os.path.dirname(__file__), "..", "..", "..",
        "manifests", "supply-chain-demo", "orders-api", "hack", "fixtures.json")
    fx = json.load(open(fx_path))
    failures = []

    def check(name, got, want):
        ok = got == want
        print(f"{'PASS' if ok else 'FAIL'}  {name}" + ("" if ok else f"\n      want: {want}\n      got:  {got}"))
        if not ok:
            failures.append(name)

    def section(name, fn):
        try:
            fn()
        except Exception as e:
            print(f"FAIL  {name} — endpoint error: {e}")
            failures.append(name)

    def s1():
        h = get(base, "/healthz")
        check("healthz.status", h.get("status"), "ok")
        check("healthz.as_of == orders-api anchor", h.get("as_of"), fx["as_of"])

    def s2():
        s = get(base, "/v1/summary?weeks=1")
        want = fx["weekly_summary"]
        check("summary.window_days", s.get("window_days"), 7)
        check("summary.orders", s.get("orders"), want["orders"])
        check("summary.revenue", money(s.get("revenue", -1)), money(want["revenue"]))
        check("summary.by_status", s.get("by_status"), want["by_status"])

    def s3():
        st = get(base, f"/v1/stuck?threshold_days={fx['stuck_threshold_days']}")
        check("stuck.threshold_days", st.get("threshold_days"), fx["stuck_threshold_days"])
        check("stuck.count", st.get("count"), fx["stuck_orders"]["count"])
        check("stuck.ids (set)", sorted(st.get("ids", [])), sorted(fx["stuck_orders"]["ids"]))
        check("stuck.count == len(ids)", st.get("count"), len(st.get("ids", [])))

    def s4():
        tp = get(base, "/v1/top-products?period_days=30&n=5")
        check("top.period_days", tp.get("period_days"), 30)
        got = [{"sku": p.get("sku"), "product": p.get("product"),
                "units": p.get("units"), "revenue": money(p.get("revenue", -1))}
               for p in tp.get("products", [])]
        want = [{**p, "revenue": money(p["revenue"])} for p in fx["top_products"]]
        check("top.products", got, want)

    section("healthz", s1); section("summary", s2); section("stuck", s3); section("top-products", s4)

    print(f"\n{'ACCEPTED — contract satisfied' if not failures else 'REJECTED — ' + str(len(failures)) + ' failure(s): ' + ', '.join(failures)}")
    return 0 if not failures else 1

if __name__ == "__main__":
    sys.exit(main())
