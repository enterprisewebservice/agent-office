# ${{ values.displayName }}

Created with the **Governed REST API** template in Developer Hub by `${{ values.createdBy }}`.
Owner: `${{ values.owner }}`. Lifecycle: `${{ values.lifecycle }}`.

| What | Where |
|---|---|
| Endpoint | `https://api-${{ values.name }}.${{ values.appsDomain }}${{ values.basePath }}` (API key as `Authorization: Bearer <key>`) |
| Contract | [`openapi.yaml`](openapi.yaml), rendered in Developer Hub on the API's **Definition** tab |
| Keys and plans | Developer Hub → API products → **${{ values.displayName }}** → request a key (gold ${{ values.goldDaily }}/day, silver ${{ values.silverDaily }}/day, bronze ${{ values.bronzeDaily }}/day) |
| Dashboard | OpenShift console → Observe → Dashboards (Perses) → project `${{ values.dashboardsNamespace }}` → **${{ values.displayName }}** |
| Traces | OpenShift console → Observe → Traces, service `${{ values.name }}-api` |
| Access log | OpenShift console → Observe → Logs, `{kubernetes_namespace_name="${{ values.gatewayNamespace }}", kubernetes_container_name="istio-proxy"} \| json \| line_format "{{.message}}" \| json \| authority="api-${{ values.name }}.${{ values.appsDomain }}"` |

## What is in this repository

Everything the API needs on the cluster. OpenShift GitOps syncs it into the
namespace `api-${{ values.name }}` within a minute of a merge to `main`.

| File | Purpose |
|---|---|
| `openapi.yaml` | The contract. Mounted into the backend as a ConfigMap. |
| `gitops/namespace.yaml` | The API's own namespace, with a resource quota and default container sizes. |
| `gitops/backend.yaml` | The backend: ${{ "a mock server generated from the contract (Prism)" if values.backendKind == "mock" else "the container image " + values.image }}. |
| `gitops/httproute.yaml` | The API's route on the shared gateway `${{ values.gatewayNamespace }}/${{ values.gatewayName }}`. |
| `gitops/route.yaml` | The public hostname (TLS at the cluster edge). |
| `gitops/authpolicy.yaml` | Who may call: keys issued through the catalog for this product. Writes the consumer identity and plan into the gateway's access log. |
| `gitops/planpolicy.yaml` | How much: the gold, silver and bronze daily limits, enforced at the gateway. |
| `gitops/apiproduct.yaml` | The product consumers request keys for. Requests and approvals are recorded as objects on the cluster. |
| `gitops/instrumentation.yaml` | Tracing agent injection (OpenTelemetry), no code changes. |
| `gitops/dashboard.yaml` | The owner's dashboard, as code (Perses). |

Change any of them in a pull request. The merge is the approval; the commit history is the audit trail.

## Removing the API

Delete the GitOps application `${{ values.name }}-api` (project `governed-apis`) and the namespace `api-${{ values.name }}`; unregister the component in Developer Hub; archive this repository.

## Dashboards

Five Perses dashboards in the console (Observe → Dashboards), all as code in `gitops/`: `dashboard.yaml` (traffic, decisions, latency),
`dashboard-consumers.yaml` (who is calling, on which plan, allowance used today; per-consumer labels come from the gateway's
TelemetryPolicy), `dashboard-decisions.yaml` (the funnel every request goes through), `dashboard-cost.yaml` (what the key check
adds next to the end-to-end latency) and `dashboard-posture.yaml` (route attached, policies enforced, GitOps in sync, backend up).
