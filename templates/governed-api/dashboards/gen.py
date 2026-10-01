#!/usr/bin/env python3
"""Generates the per-API Perses dashboards of the Governed REST API template.

    python3 gen.py skeleton            -> ../skeleton/gitops/dashboard-*.yaml (scaffolder placeholders)
    python3 gen.py render <name> <displayName> <gold> <silver> <bronze> [outdir]
                                       -> rendered files for one existing API (same content the template
                                          would have produced; used to add the dashboards to an older repo)

Four dashboards, all fed by the gateway (Envoy request metrics), the policy engine (Limitador counters with
the TelemetryPolicy's user_id/plan/consumer labels), Authorino (auth check duration) and the state metrics
(Gateway API status, GitOps application, deployment). The application exports nothing.
"""
import os, sys, yaml

HERE = os.path.dirname(os.path.abspath(__file__))


class V(dict):
    """values: scaffolder placeholders by default."""
    def __getattr__(self, k):
        return self.get(k, "${{ values.%s }}" % k)


def panel(name, kind, queries, description=None, **spec):
    p = {"kind": "Panel", "spec": {"display": {"name": name}, "plugin": {"kind": kind, "spec": spec},
                                   "queries": [{"kind": "TimeSeriesQuery", "spec": {"plugin": {"kind": "PrometheusTimeSeriesQuery", "spec": {
                                       "datasource": {"kind": "PrometheusDatasource", "name": DS}, "query": q, **({"seriesNameFormat": s} if s else {})}}}}
                                               for q, s in queries]}}
    if description:
        p["spec"]["display"]["description"] = description
    return p


def stat(name, query, unit="decimal", description=None, thresholds=None, decimals=None):
    if decimals is None and unit == "decimal":
        decimals = 0   # counts come from increase(), which extrapolates fractions; show whole requests
    spec = {"calculation": "last", "format": {"unit": unit, **({"decimalPlaces": decimals} if decimals is not None else {})}}
    if thresholds:
        spec["thresholds"] = thresholds
    return panel(name, "StatChart", [(query, None)], description, **spec)


def ts(name, queries, unit=None, description=None, stack=False):
    spec = {"legend": {"position": "bottom"}}
    if unit:
        spec["yAxis"] = {"format": {"unit": unit}}
    if stack:
        spec["visual"] = {"stack": "all", "areaOpacity": 0.6}
    return panel(name, "TimeSeriesChart", queries, description, **spec)


def bar(name, query, series, description=None, unit="decimal"):
    return panel(name, "BarChart", [(query, series)], description, calculation="last", format={"unit": unit}, sort="desc", mode="value")


def gauge(name, query, maximum, description=None):
    # percent-mode thresholds: no arithmetic on the allowance, which is a scaffolder placeholder in the skeleton
    thr = {"mode": "percent", "steps": [{"value": 70, "color": "#f0ab00"}, {"value": 90, "color": "#c9190b"}]}
    return panel(name, "GaugeChart", [(query, None)], description, calculation="last", format={"unit": "decimal", "decimalPlaces": 0}, max=maximum, thresholds=thr)


def table(name, query, description=None):
    return panel(name, "Table", [(query, None)], description, density="compact")


def grid(title, items):
    return {"kind": "Grid", "spec": {"display": {"title": title, "collapse": {"open": True}}, "items": items}}


def item(x, y, w, h, ref):
    return {"x": x, "y": y, "width": w, "height": h, "content": {"$ref": "#/spec/panels/%s" % ref}}


def variable(name, label, label_name, matchers):
    """A dropdown fed by the label values of one or more metrics; 'All' (= .*, so series without the label and the
    gateway's 'unknown' for unauthenticated calls still count) and multi-select. Use in queries as label=~"$name"."""
    return {"kind": "ListVariable", "spec": {"name": name, "display": {"name": label, "hidden": False}, "allowAllValue": True, "allowMultiple": True,
            "customAllValue": ".*", "defaultValue": "$__all", "plugin": {"kind": "PrometheusLabelValuesVariable", "spec": {"datasource": {"kind": "PrometheusDatasource", "name": DS},
            "labelName": label_name, "matchers": matchers if isinstance(matchers, list) else [matchers]}}}}


def consumer_vars(ns, lim_plain):
    """The Consumer and Plan dropdowns every per-API dashboard carries (values from the gateway's request metrics and
    the policy engine's counters; the gateway writes 'unknown' on a 401, which is not a consumer)."""
    return [variable("user_id", "Consumer", "user_id", ['istio_requests_total{destination_service_namespace="%s", user_id!~"unknown|"}' % ns, 'authorized_calls{%s, user_id!=""}' % lim_plain]),
            variable("plan", "Plan", "plan", ['istio_requests_total{destination_service_namespace="%s", plan!~"unknown|"}' % ns, 'authorized_calls{%s, plan!=""}' % lim_plain])]


def dashboard(v, suffix, title, description, panels, layouts, variables=None):
    cfg = {"display": {"name": "%s: %s" % (v.displayName, title), "description": description}, "duration": "1h", "refreshInterval": "30s"}
    if variables:
        cfg["variables"] = variables
    cfg.update({"panels": panels, "layouts": layouts})
    return {"apiVersion": "perses.dev/v1alpha2", "kind": "PersesDashboard",
            "metadata": {"name": "%s-api-%s" % (v.name, suffix), "namespace": v.dashboardsNamespace, "labels": {"governed-api/name": v.name}},
            "spec": {"config": cfg}}


OK_RED = {"steps": [{"value": 0, "color": "#c9190b"}, {"value": 1, "color": "#3e8635"}]}


def build(v):
    ns = "api-%s" % v.name
    uf = 'user_id=~"$user_id", plan=~"$plan"'                      # the Consumer and Plan dropdowns
    lim_plain = 'limitador_namespace="%s/%s-api"' % (ns, v.name)
    lim = '%s, %s' % (lim_plain, uf)
    istio = 'destination_service_namespace="%s", %s' % (ns, uf)
    variables = consumer_vars(ns, lim_plain)
    out = {}

    # 1. consumers and plans (TelemetryPolicy labels on Limitador's counters)
    sel = lim
    panels = {
        "consumers": stat("Consumers seen in range", 'count(count by (user_id) (increase(authorized_calls{%s, user_id!=""}[$__range]) > 0)) or vector(0)' % sel,
                          description="Distinct user ids behind the keys that made at least one call within their plan (filtered by the dropdowns)"),
        "calls": stat("Calls within plan", 'sum(increase(authorized_calls{%s}[$__range])) or vector(0)' % sel),
        "refused": stat("Refused over plan (429)", 'sum(increase(limited_calls{%s}[$__range])) or vector(0)' % sel),
        "topPlan": stat("Busiest plan", 'topk(1, sum by (plan) (increase(authorized_calls{%s, plan!=""}[$__range])))' % sel, description="The plan with the most calls in range"),
        "byConsumer": bar("Calls per consumer and plan (range)", 'sum by (user_id, plan) (increase(authorized_calls{%s, user_id!=""}[$__range]))' % sel, "{{user_id}} · {{plan}}",
                          description="Counted by the policy engine per consumer: the TelemetryPolicy on the gateway labels every decision with the user id and the plan of the key"),
        "refusedByConsumer": bar("Refused over plan, per consumer (range)", 'sum by (user_id, plan) (increase(limited_calls{%s, user_id!=""}[$__range]))' % sel, "{{user_id}} · {{plan}}"),
        "rateByConsumer": ts("Calls per second by consumer", [('sum by (user_id, plan) (rate(authorized_calls{%s, user_id!=""}[5m]))' % sel, "{{user_id}} · {{plan}}")], "requests/sec"),
        "refusedRate": ts("Refusals per second by consumer (429)", [('sum by (user_id, plan) (rate(limited_calls{%s, user_id!=""}[5m]))' % sel, "{{user_id}} · {{plan}}")], "requests/sec"),
        "gold": gauge("Gold plan: calls today of %s" % v.goldDaily, 'sum(increase(authorized_calls{%s, plan="gold"}[24h])) or vector(0)' % lim, int(v.goldDaily) if str(v.goldDaily).isdigit() else v.goldDaily,
                      description="The limit applies per consumer: pick one in the Consumer dropdown for an exact gauge; All adds the consumers up"),
        "silver": gauge("Silver plan: calls today of %s" % v.silverDaily, 'sum(increase(authorized_calls{%s, plan="silver"}[24h])) or vector(0)' % lim, int(v.silverDaily) if str(v.silverDaily).isdigit() else v.silverDaily),
        "bronze": gauge("Bronze plan: calls today of %s" % v.bronzeDaily, 'sum(increase(authorized_calls{%s, plan="bronze"}[24h])) or vector(0)' % lim, int(v.bronzeDaily) if str(v.bronzeDaily).isdigit() else v.bronzeDaily),
        "ledger": table("Consumer ledger (range)", 'sum by (user_id, plan, consumer) (increase(authorized_calls{%s, user_id!=""}[$__range]))' % sel,
                        description="user id, plan and the consumer's namespace, with the calls counted within plan"),
    }
    layouts = [grid("Who is calling", [item(0, 0, 6, 4, "consumers"), item(6, 0, 6, 4, "calls"), item(12, 0, 6, 4, "refused"), item(18, 0, 6, 4, "topPlan")]),
               grid("Per consumer", [item(0, 0, 12, 8, "byConsumer"), item(12, 0, 12, 8, "refusedByConsumer"), item(0, 8, 12, 8, "rateByConsumer"), item(12, 8, 12, 8, "refusedRate")]),
               grid("Plan allowances today", [item(0, 0, 8, 6, "gold"), item(8, 0, 8, 6, "silver"), item(16, 0, 8, 6, "bronze"), item(0, 6, 24, 8, "ledger")])]
    out["consumers"] = dashboard(v, "consumers", "consumers and plans", "Who is calling this API, on which plan, and how much of today's allowance is used; pick a consumer or a plan at the top. From the policy engine's counters, labelled by the gateway's TelemetryPolicy", panels, layouts, variables)

    # 2. policy decisions: the funnel every request goes through
    total = 'sum(increase(istio_requests_total{%s}[$__range]))' % istio
    panels = {
        "received": stat("Received at the gateway", "%s or vector(0)" % total),
        "authenticated": stat("Passed the key check", 'sum(increase(istio_requests_total{%s, response_code!~"401|403"}[$__range])) or vector(0)' % istio, description="Authorino found a valid key (AuthPolicy)"),
        "withinPlan": stat("Within the plan", 'sum(increase(istio_requests_total{%s, response_code!~"401|403|429"}[$__range])) or vector(0)' % istio, description="Limitador counted the call inside the consumer's daily allowance (PlanPolicy)"),
        "served": stat("Served by the application", 'sum(increase(istio_requests_total{%s, response_code=~"2.."}[$__range])) or vector(0)' % istio),
        "stoppedAuth": stat("Stopped: no or bad key (401/403)", 'sum(increase(istio_requests_total{%s, response_code=~"401|403"}[$__range])) or vector(0)' % istio),
        "stoppedPlan": stat("Stopped: over the plan (429)", 'sum(increase(istio_requests_total{%s, response_code="429"}[$__range])) or vector(0)' % istio),
        "appErrors": stat("Application errors (5xx)", 'sum(increase(istio_requests_total{%s, response_code=~"5.."}[$__range])) or vector(0)' % istio),
        "enforcedShare": stat("Share decided by the gateway", '100 * (sum(increase(istio_requests_total{%s, response_code=~"401|403|429"}[$__range])) or vector(0)) / clamp_min(%s, 1)' % (istio, total), unit="percent", decimals=1,
                              description="Requests that never reached the application because a policy stopped them"),
        "outcomes": ts("Outcomes per second", [('sum(rate(istio_requests_total{%s, response_code=~"2.."}[5m]))' % istio, "served (2xx)"),
                                                 ('sum(rate(istio_requests_total{%s, response_code=~"401|403"}[5m]))' % istio, "stopped: key (401/403)"),
                                                 ('sum(rate(istio_requests_total{%s, response_code="429"}[5m]))' % istio, "stopped: plan (429)"),
                                                 ('sum(rate(istio_requests_total{%s, response_code=~"5.."}[5m]))' % istio, "application error (5xx)")], "requests/sec", stack=True,
                       description="Stacked: what happened to every request, as the gateway reported it"),
        "engine": ts("The policy engine's own count", [('sum(rate(authorized_calls{%s}[5m])) or vector(0)' % lim, "within plan"), ('sum(rate(limited_calls{%s}[5m])) or vector(0)' % lim, "over plan")], "requests/sec",
                     description="Limitador's counters for this API; they match the gateway's 429s"),
        "byPath": bar("Decisions by path (range)", 'sum by (request_url_path, response_code) (increase(istio_requests_total{%s}[$__range]))' % istio, "{{request_url_path}} → {{response_code}}"),
    }
    layouts = [grid("The funnel", [item(0, 0, 6, 4, "received"), item(6, 0, 6, 4, "authenticated"), item(12, 0, 6, 4, "withinPlan"), item(18, 0, 6, 4, "served")]),
               grid("Stopped at the gateway", [item(0, 0, 6, 4, "stoppedAuth"), item(6, 0, 6, 4, "stoppedPlan"), item(12, 0, 6, 4, "appErrors"), item(18, 0, 6, 4, "enforcedShare")]),
               grid("Over time", [item(0, 0, 12, 8, "outcomes"), item(12, 0, 12, 8, "engine"), item(0, 8, 24, 8, "byPath")])]
    out["decisions"] = dashboard(v, "decisions", "policy decisions", "Every request as a funnel: received, key checked, plan checked, served; what the gateway stopped and why", panels, layouts, variables)

    # 3. the cost of governance: what the checks add to a request
    auth = 'auth_server_authconfig_duration_seconds_bucket{namespace="kuadrant-system"}'
    e2e = 'istio_request_duration_milliseconds_bucket{%s}' % istio
    panels = {
        "authP95": stat("Key check p95 (Authorino, all consumers)", 'histogram_quantile(0.95, sum by (le) (increase(%s[$__range]))) * 1000' % auth, unit="milliseconds", decimals=1,
                        description="Shared by every API on the gateway: validating the key and resolving the consumer and plan; interpolated inside Authorino's coarse buckets, so an upper bound"),
        "e2eP95": stat("End to end p95 at the gateway", 'histogram_quantile(0.95, sum by (le) (increase(%s[$__range])))' % e2e, unit="milliseconds", decimals=1, description="This API: from the gateway receiving the request to the last byte of the answer"),
        "e2eP50": stat("End to end p50", 'histogram_quantile(0.50, sum by (le) (increase(%s[$__range])))' % e2e, unit="milliseconds", decimals=1),
        "authP50": stat("Key check p50 (Authorino, all consumers)", 'histogram_quantile(0.50, sum by (le) (increase(%s[$__range]))) * 1000' % auth, unit="milliseconds", decimals=1,
                        description="Authorino's own histogram has 1 ms and 51 ms buckets, so percentiles are interpolated inside a bucket: read them as an upper bound"),
        "authSeries": ts("Key check duration (shared gateway, all consumers)", [('histogram_quantile(0.50, sum by (le) (rate(%s[5m]))) * 1000' % auth, "p50"), ('histogram_quantile(0.95, sum by (le) (rate(%s[5m]))) * 1000' % auth, "p95"), ('histogram_quantile(0.99, sum by (le) (rate(%s[5m]))) * 1000' % auth, "p99")], "milliseconds"),
        "e2eSeries": ts("End to end at the gateway (this API)", [('histogram_quantile(0.50, sum by (le) (rate(%s[5m])))' % e2e, "p50"), ('histogram_quantile(0.95, sum by (le) (rate(%s[5m])))' % e2e, "p95"), ('histogram_quantile(0.99, sum by (le) (rate(%s[5m])))' % e2e, "p99")], "milliseconds"),
        "byOutcome": ts("p95 by outcome", [('histogram_quantile(0.95, sum by (le) (rate(istio_request_duration_milliseconds_bucket{%s, response_code=~"2.."}[5m])))' % istio, "served (2xx)"),
                                            ('histogram_quantile(0.95, sum by (le) (rate(istio_request_duration_milliseconds_bucket{%s, response_code=~"401|403"}[5m])))' % istio, "stopped: key"),
                                            ('histogram_quantile(0.95, sum by (le) (rate(istio_request_duration_milliseconds_bucket{%s, response_code="429"}[5m])))' % istio, "stopped: plan")], "milliseconds",
                        description="A stopped request is answered by the gateway in the time of the check alone"),
        "authRate": ts("Key checks per second by result (shared gateway, all consumers)", [('sum by (status) (rate(auth_server_authconfig_response_status{namespace="kuadrant-system"}[5m]))', "{{status}}")], "requests/sec"),
    }
    layouts = [grid("What the checks cost", [item(0, 0, 6, 4, "authP50"), item(6, 0, 6, 4, "authP95"), item(12, 0, 6, 4, "e2eP50"), item(18, 0, 6, 4, "e2eP95")]),
               grid("Over time", [item(0, 0, 12, 8, "authSeries"), item(12, 0, 12, 8, "e2eSeries"), item(0, 8, 12, 8, "byOutcome"), item(12, 8, 12, 8, "authRate")])]
    out["cost"] = dashboard(v, "cost", "the cost of governance", "What the key check and the plan check add to a request, next to the end-to-end latency at the gateway", panels, layouts, variables)

    # 4. governance posture: is it governed right now
    panels = {
        "route": stat("Route attached to the gateway (API-wide)", 'max(gatewayapi_httproute_status_parent_info{exported_namespace="%s", name="%s-api", parent_name="%s"}) or vector(0)' % (ns, v.name, v.gatewayName), thresholds=OK_RED, decimals=0,
                      description="1 = the HTTPRoute is accepted by the shared gateway %s/%s" % (v.gatewayNamespace, v.gatewayName)),
        "auth": stat("Key policy enforced", 'max(gatewayapi_authpolicy_status{exported_namespace="%s", name="%s-api-auth", type="Enforced"}) or vector(0)' % (ns, v.name), thresholds=OK_RED, decimals=0, description="1 = the AuthPolicy is enforced on the route"),
        "plans": stat("Plan policy enforced", 'max(gatewayapi_ratelimitpolicy_status{exported_namespace="%s", name="%s-api-plans", type="Enforced"}) or vector(0)' % (ns, v.name), thresholds=OK_RED, decimals=0, description="1 = the rate limits generated from the PlanPolicy are enforced"),
        "gitops": stat("GitOps synced and healthy", 'max(argocd_app_info{name="%s-api", sync_status="Synced", health_status="Healthy"}) or vector(0)' % v.name, thresholds=OK_RED, decimals=0, description="1 = the cluster matches the repository"),
        "backend": stat("Backend replicas available", 'max(kube_deployment_status_replicas_available{namespace="%s", deployment="%s-api"}) or vector(0)' % (ns, v.name), thresholds=OK_RED, decimals=0),
        "listeners": stat("Routes on the shared gateway", 'sum(gatewayapi_gateway_status_listener_attached_routes{exported_namespace="%s", name="%s"}) or vector(0)' % (v.gatewayNamespace, v.gatewayName), decimals=0, description="All APIs attached to %s/%s" % (v.gatewayNamespace, v.gatewayName)),
        "keysActive": stat("Consumers with a working key (range)", 'count(count by (user_id) (increase(authorized_calls{%s, user_id!=""}[$__range]) > 0)) or vector(0)' % lim, decimals=0),
        "lastCall": stat("Calls in the last 5 minutes", 'sum(increase(istio_requests_total{%s}[5m])) or vector(0)' % istio, decimals=0),
        "history": ts("Posture over time", [('max(gatewayapi_authpolicy_status{exported_namespace="%s", name="%s-api-auth", type="Enforced"})' % (ns, v.name), "key policy enforced"),
                                             ('max(gatewayapi_ratelimitpolicy_status{exported_namespace="%s", name="%s-api-plans", type="Enforced"})' % (ns, v.name), "plan policy enforced"),
                                             ('max(argocd_app_info{name="%s-api", sync_status="Synced"})' % v.name, "gitops synced"),
                                             ('max(kube_deployment_status_replicas_available{namespace="%s", deployment="%s-api"})' % (ns, v.name), "backend replicas")],
                      description="Any dip is a moment the API was not fully governed or not fully up"),
        "policiesCluster": ts("Policies enforced on the cluster (all APIs)", [('sum by (kind) (kuadrant_policies_enforced{status="true"})', "{{kind}} enforced"), ('sum by (kind) (kuadrant_policies_enforced{status="false"})', "{{kind}} NOT enforced")]),
    }
    layouts = [grid("Right now", [item(0, 0, 6, 4, "route"), item(6, 0, 6, 4, "auth"), item(12, 0, 6, 4, "plans"), item(18, 0, 6, 4, "gitops")]),
               grid("Running", [item(0, 0, 6, 4, "backend"), item(6, 0, 6, 4, "listeners"), item(12, 0, 6, 4, "keysActive"), item(18, 0, 6, 4, "lastCall")]),
               grid("Over time", [item(0, 0, 12, 8, "history"), item(12, 0, 12, 8, "policiesCluster")])]
    out["posture"] = dashboard(v, "posture", "governance posture", "Is this API governed right now: route attached, key and plan policies enforced, GitOps in sync, backend up", panels, layouts, variables)
    return out


HEADER = {
    "consumers": "# Who is calling: per-consumer counts from Limitador, labelled user_id/plan/consumer by the\n# TelemetryPolicy on the shared gateway (Technology Preview in Connectivity Link 1.4).\n",
    "decisions": "# The funnel every request goes through, from the gateway's own request metrics.\n",
    "cost": "# What the key check and the plan check add to a request (Authorino duration, gateway latency).\n",
    "posture": "# Is the API governed right now: Gateway API status metrics, GitOps application, deployment.\n",
}


def main():
    mode = sys.argv[1]
    if mode == "skeleton":
        v = V(); outdir = os.path.join(HERE, "..", "skeleton", "gitops"); DS_ = None
    else:
        name, display, gold, silver, bronze = sys.argv[2:7]
        outdir = sys.argv[7] if len(sys.argv) > 7 else "."
        v = V(name=name, displayName=display, goldDaily=gold, silverDaily=silver, bronzeDaily=bronze,
              dashboardsNamespace="openshift-cluster-observability-operator", gatewayName="api-gateway", gatewayNamespace="api-demo",
              datasourceName="accelerators-thanos-querier-datasource")
    global DS
    DS = v.datasourceName
    for key, d in build(v).items():
        path = os.path.join(outdir, "dashboard-%s.yaml" % key)
        text = yaml.safe_dump(d, sort_keys=False, width=1000, allow_unicode=True)
        # the gauge maximum must stay a number after the scaffolder renders it
        for k in ("goldDaily", "silverDaily", "bronzeDaily"):
            text = text.replace("max: '${{ values.%s }}'" % k, "max: ${{ values.%s }}" % k)
        with open(path, "w") as f:
            f.write(HEADER[key]); f.write(text)
        print(path)


if __name__ == "__main__":
    main()
