# OpenShift AI MLflow — experiment tracking for the genesis demo

The `genesis-train` pipeline streams its training curves (loss, w, b per epoch)
to the OpenShift AI MLflow tracking server, so the model is visibly learning in
**Experiments → genesis-model → run `genesis-gd` → `loss`**: loss falls 13 → 0.2
while `w` climbs to 2.0 and `b` to 1.0.

## What this directory provides (ArgoCD-synced into `agent-office`)

- **`mlflow.yaml`** — the `MLflow` tracking-server CR. PVC-backed (sqlite metadata
  + file artifacts on the volume); no external database or object store. The CR
  name must be `mlflow` (the operator enforces a per-namespace singleton).
- **`rolebindings.yaml`** — binds the DSPA pipeline-runner SA to the Red Hat
  `mlflow-operator-mlflow-{view,edit}` ClusterRoles (so training can log to the
  `agent-office` workspace), and the gateway `default` SA to `-view` (so agents
  can read their runs).

## Prerequisite (out-of-band — RHOAI owns the DataScienceCluster)

The MLflow component must be enabled on the cluster's DataScienceCluster. That
resource is created and owned by the Red Hat OpenShift AI operator (not in this
repo), so enabling MLflow is a one-time platform step:

```sh
oc patch datasciencecluster default-dsc --type merge \
  -p '{"spec":{"components":{"mlflowoperator":{"managementState":"Managed"}}}}'
```

This deploys the MLflow operator (the `mlflow.opendatahub.io` API + the
`mlflow-operator-mlflow-{view,edit}` ClusterRoles) into `redhat-ods-applications`.
Reverse with `"managementState":"Removed"`.

## How the pipeline authenticates (the documented RHOAI way)

The RHOAI MLflow server is multi-tenant. The training component (`train_gd` in
`integration-tests/genesis-demo/pipeline/pipeline.py`):

1. sends its pod ServiceAccount token as `Authorization: Bearer`
   (`MLFLOW_TRACKING_TOKEN`),
2. selects the workspace = namespace via the **`X-MLFLOW-WORKSPACE`** header —
   injected with an MLflow *request-header provider*, because the shipped 3.6
   client has no `mlflow.set_workspace()`,
3. and is authorized per-request by the RoleBindings here (SelfSubjectAccessReview
   against `mlflow.kubeflow.org/experiments` in this namespace).

Least-privilege is therefore just the namespace RBAC above — no shared secret.

## View

MLflow UI: the **MLflow** link in the OpenShift console app-launcher, or the
`data-science-gateway` route (`/mlflow`). Sign in with OpenShift; if the
experiment list looks empty, pick the **`agent-office`** workspace.
