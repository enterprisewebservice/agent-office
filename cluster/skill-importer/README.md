# Skill catalog importer

Tekton pipelines that pull SKILL.md-format skills from upstream
repos (openshift/agentic-skills, anthropics/skills, future:
community catalogs), package each via `skillctl`, and push to
Quay as OCI artifacts.

This is v1.6.0 step #2 — the first piece in the catalog architecture
that lets agents discover skills dynamically instead of having them
bound at design time. Pushed images are queried by the operator's
`/catalog/skills` endpoint (v1.6.0 step #3) and surfaced to agents via
an MCP discovery server (v1.6.0 step #4).

## One-time setup

### 1. Quay push secret

The pipeline pushes via skillctl, which reads docker auth from a
docker config json. Create the secret once:

```sh
# Use a Quay robot account scoped to write the destination namespace.
# (Or the personal account if you don't have robot accounts yet.)
oc create secret docker-registry quay-push-secret \
  --docker-server=quay-quay-quay-test.apps.salamander.aimlworkbench.com \
  --docker-username=<robot-or-user> \
  --docker-password=<token> \
  -n agent-office
```

### 2. ArgoCD app (managed by `cluster/skill-importer-app.yaml`)

ArgoCD syncs this directory automatically. The Pipeline resource lands
in `agent-office`; you can verify with:

```sh
oc get pipeline -n agent-office import-rh-agentic-skills
```

## Triggering an import

### Manual (today)

```sh
oc create -n agent-office -f cluster/skill-importer/manual-pipelinerun.yaml
oc get pipelinerun -n agent-office -l agentoffice.ai/source-tier=rh-official -w
```

Each `oc create` produces a fresh PipelineRun (they're immutable).
Watch the logs:

```sh
PR=$(oc get pipelinerun -n agent-office \
  -l agentoffice.ai/source-tier=rh-official \
  --sort-by=.metadata.creationTimestamp \
  -o jsonpath='{.items[-1:].metadata.name}')
oc logs -n agent-office $PR -c step-build-and-push -f
```

After success, verify the pushed images:

```sh
# List skills in the destination Quay namespace.
curl -sH "Authorization: Bearer $QUAY_API_TOKEN" \
  "https://quay-quay-quay-test.apps.salamander.aimlworkbench.com/api/v1/repository?namespace=deanpeterson&starts_with=agent-office-skill-" \
  | jq '.repositories[] | {name, last_modified}'
```

### Scheduled (later)

For nightly auto-refresh, add a Kubernetes CronJob that templates a
PipelineRun spec from `manual-pipelinerun.yaml`. Defer until the
import is stable.

## Adding a new upstream source

1. Copy `import-rh-agentic-skills-pipeline.yaml` to e.g.
   `import-anthropic-skills-pipeline.yaml`.
2. Change the Pipeline `metadata.name` and the default `source-repo-url`
   / `source-tier` params.
3. Add the new pipeline filename to `kustomization.yaml`.
4. Copy `manual-pipelinerun.yaml` to a sibling that targets the new
   pipeline.
5. Commit + push; ArgoCD syncs the new Pipeline; trigger a manual run.

## Wire format the importer produces

Each pushed image is a `skillctl`-built OCI artifact at:

```
<registry>/<namespace>/<image-prefix><skill-name>:<tag>
```

With OCI annotations describing provenance:

| Annotation | Set to | Used by |
|---|---|---|
| `agentoffice.ai/skill-tier` | `rh-official` / `anthropic-official` / `community` / `customer-authored` | Operator catalog filtering, binders plugin display |
| `agentoffice.ai/source-repo` | The git URL the skill was imported from | Provenance audit, "Open Source" links in binders |
| `agentoffice.ai/source-revision` | The git revision (commit SHA or branch) | Same |
| `agentoffice.ai/imported-at` | ISO-8601 UTC timestamp | Catalog "last imported" display |

`skillctl` itself adds the standard `skillimage.dev` annotations
(skill name, description, version) so any other `skillctl`-aware
consumer can browse the image as well.

## Troubleshooting

**`skillctl push failed: unauthorized`** — the `quay-push-secret`
isn't readable by the pipeline ServiceAccount, OR the robot account
doesn't have write permission on the destination Quay namespace.
Verify with:

```sh
oc auth can-i get secret/quay-push-secret -n agent-office \
  --as=system:serviceaccount:agent-office:pipeline
```

**Pipeline can't pull `ghcr.io/redhat-et/skillctl:latest`** — should
be reachable by default (public image). If the cluster has a strict
egress policy, allow `ghcr.io`.

**No skills found** — the source repo's layout doesn't put SKILL.md
at the root of each skill folder. Check:

```sh
oc logs -n agent-office <pipelinerun-name>-build-and-push-skills-pod \
  -c step-build-and-push | head -20
```
