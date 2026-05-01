# `cluster/` — bootstrap manifests for cluster-wide infrastructure

Manifests in this directory configure platform components that live OUTSIDE
the agent-office namespace (e.g. Argo CD Image Updater config in
`openshift-gitops`). They are NOT synced by the main
`openshift-gitops/agent-office` Application — that one targets the
`agent-office` namespace and is bounded to product workloads.

Each subdirectory is owned by its own ArgoCD Application that targets
`openshift-gitops` and does ServerSideApply so the platform Operators it
configures can co-own resources without conflict.

## Subdirectories

### `imageupdater/`

Configures Argo CD Image Updater on Red Hat OpenShift GitOps:

- `argocd-image-updater-config.yaml` — the `argocd-image-updater-config`
  ConfigMap with `data.registries.conf` describing the cluster Quay. The
  OpenShift GitOps operator creates this ConfigMap empty when
  `spec.imageUpdater.enabled: true` is set on the ArgoCD CR; per the
  operator's source code it explicitly does NOT reconcile the data block,
  so user-managed contents are stable.

- `agent-office-imageupdater.yaml` — the `ImageUpdater` CR for the
  `agent-office` Application, using `useAnnotations: true` to defer to the
  Application's existing `argocd-image-updater.argoproj.io/*` annotations.

## Bootstrap

Apply each subdirectory's ArgoCD Application once. Subsequent changes to
files in the subdirectory are picked up automatically by the running
Application.

```bash
oc apply -f cluster/imageupdater-app.yaml
```

## Secrets — out of scope for this directory

Two cluster Secrets that Image Updater depends on are intentionally NOT in
git, because they hold credentials in plaintext at rest in YAML:

| Secret | What it holds | How to recreate |
|---|---|---|
| `openshift-gitops/argocd-image-updater-quay` | Quay robot pull secret | `oc create secret docker-registry argocd-image-updater-quay -n openshift-gitops --docker-server=<host> --docker-username=<robot> --docker-password=<pw>` |
| `openshift-gitops/agent-office-git-creds` | GitHub App ID + installation ID + private key for git write-back | `oc create secret generic agent-office-git-creds -n openshift-gitops --from-literal=githubAppID=<id> --from-literal=githubAppInstallationID=<install-id> --from-file=githubAppPrivateKey=<pem>` |

Long-term, these belong behind ExternalSecrets Operator + Vault (the
Konflux production pattern) so the manifest in git becomes an
`ExternalSecret` referencing a Vault path. Adding that is a separate
follow-up.
