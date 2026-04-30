# agent-office build pipeline

## How a commit becomes a deployed image

1. **You push to `main`** on `enterprisewebservice/agent-office`.
2. **GitHub App** ("agent-pipelines-as-code") delivers the push event to the cluster's Pipelines-as-Code controller.
3. **Pipelines-as-Code** matches the event against the [`Repository` CR](https://github.com/enterprisewebservice/agent-office) `default-tenant/agent-office` and reads `.tekton/agent-office-on-push.yaml`.
4. **A `PipelineRun` is created** in `default-tenant`. It uses the Konflux `pipeline-docker-build` bundle (digest-pinned), so the build matches what TSSC ships to customers — Buildah, SBOM generation, image-signing-ready.
5. **Image is pushed** to `quay-quay-quay-test.apps.salamander.aimlworkbench.com/deanpeterson/agent-office-server:on-push-<sha>`.
6. **TODO** — manifest-tag bump (so `manifests/rbac/agent-office-rbac.yaml` updates to the new image) is the next iteration. For now bump the tag manually + force-sync the `agent-office` ArgoCD Application.

## How auth works

- The cluster's PaC controller authenticates to GitHub as the `agent-pipelines-as-code` GitHub App (App ID stored in cluster Secret `openshift-pipelines/pipelines-as-code-secret`, key `github-application-id`).
- Webhook delivery flows through the App's installation, not a per-repo PAT-based webhook.
- This is the same pattern Konflux uses; migrating to Konflux SaaS later is a config change, not a re-platforming.

## The Repository CR

```yaml
apiVersion: pipelinesascode.tekton.dev/v1alpha1
kind: Repository
metadata:
  name: agent-office
  namespace: default-tenant
spec:
  url: https://github.com/enterprisewebservice/agent-office
```

No per-repo webhook secret needed — it's all global App-mode auth from `pipelines-as-code-secret`.

## Production hardening still to do

- Move `pipelines-as-code-secret` into Vault + ExternalSecret (Konflux pattern) instead of a plain cluster Secret.
- Restrict the GitHub App's repository scope from "all" to an explicit list.
- Wire ArgoCD Image Updater (or a `finally` Tekton task) to bump `manifests/` automatically.
- Re-enable `skip-checks=false` once Conforma/Enterprise-Contract policy is configured.
