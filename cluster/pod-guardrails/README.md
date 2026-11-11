# `cluster/pod-guardrails/` — keep Jobs from piling up pods

Owned by the `pod-guardrails` Argo CD Application (`cluster/pod-guardrails-app.yaml`,
bootstrap once with `oc apply -f cluster/pod-guardrails-app.yaml`).

## Why

2026-09-29: a CronJob applied by hand in `openshift-devspaces` in February
(`sync-pull-secrets`, every 5 minutes, `concurrencyPolicy: Allow`, no
deadline, image `registry.redhat.io/openshift4/ose-cli:latest`) stopped
being able to pull its image on 2026-09-24 when Red Hat dropped that tag.
Every run left a pod in ImagePullBackOff. Those pods are Pending but bound
to a node, so they count against the kubelet's default limit of 250 pods.
Five days later: 1,442 Jobs, 1,153 stuck pods, all eight nodes at 250/250,
the scheduler answering "Too many pods" to everything, OpenShift Pipelines
reporting itself failed (its second webhook replica could not be placed),
21 agent-office-operator pods unschedulable. A second, smaller pile of the
same kind sat in `agent-office-operator` (`quay-pull-secret-copier`).

Nobody was told: `KubeJobNotCompleted` fired 1,301 times and
`KubeletTooManyPods` on all eight nodes, but the Alertmanager route sent
everything that was not critical to a receiver with no integration.

## The three layers

| Layer | File | What it does |
|---|---|---|
| 1. Alerts that reach a human | `alerting-rules.yaml` | `NamespacePendingPodPileUp` (>25 Pending pods in a namespace for 30 min), `JobPodsStuckPending` (>3 Job-owned pods Pending for 30 min), `NodePodCapacityHigh` (>92% of a node's pod limit), `ClusterPodCapacityHigh` (>80% overall). Every namespace, not just `openshift-*`. |
| | `alertmanager-main.yaml` | The Alertmanager config, in git. Since 2026-11-06 only the Runtab namespace (`claude-code-agent`) is emailed; everything else, including the pile-up alerts above, stays in the console (the `PlatformOps` and `Critical` email routes were removed at Dean's request). |
| | `cluster-monitoring-config.yaml` | Mounts the `alertmanager-smtp` Secret into Alertmanager so the config can reference the SMTP password by file. |
| 2. Caps | `resourcequotas.yaml` | `pods: 40` and `count/jobs.batch: 100` in `openshift-devspaces`, `agent-office-operator`, `vault`, `haveniq`, `claude-code-agent`. Pending pods count toward a `pods` quota, so a pile stops at 40 and never reaches the nodes. |
| | `project-request.yaml` | The project request template, so every project created with `oc new-project` or the console gets `pods: 100`. |
| 3. Admission | `cronjob-policy.yaml` | `cronjob-hygiene` denies a CronJob without `activeDeadlineSeconds`, with `concurrencyPolicy: Allow`, or with a `:latest`/untagged image, in the namespaces we own. `cronjob-gitops-owned` warns when a CronJob has no Argo tracking annotation. |

## Pipelines pruner (declared 2026-10-25)

`tektonconfig-pruner.yaml` holds the OpenShift Pipelines pruner at the operator's defaults (keep 100
PipelineRuns per namespace, daily 08:00 UTC) as a server-side-applied partial object, Prune=false, so the
setting is visible in git. An OLM clean-up CronJob for openshift-marketplace lived here for two days
(22-25 Oct 2026) and was removed: OLM reuses those unpack objects across InstallPlans and a pending
manual InstallPlan breaks when its ConfigMap disappears, so the platform namespace is left alone.

## Control-plane pins (added 2026-11-11)

`control-plane-pin-policy.yaml` holds one more admission policy, `no-pins-to-control-plane`.

2026-11-11, 23:28Z to 23:42Z: a throwaway test pod was pinned by hostname to
`ec-0d-9a-92-a5-6a`, a control-plane node. Control-plane nodes here also carry the
worker role and no taint, so the pod was accepted. Its image was 12.3 GB. That node
keeps etcd and container storage on one system disk, which wrote about 20 MB/s. The
pull saturated the disk, etcd fsync p99 on that member went from 50 ms to over 8 s,
API p99 from 0.09 s to 44 s, and controllers cluster-wide lost their leases and
crash-looped until 23:47Z. Deleting the pod did not stop the pull.

The policy denies a Pod created outside `openshift-*` and `kube-*` that names a
control-plane node through `spec.nodeName`, a `kubernetes.io/hostname` node selector,
or required node affinity. It leaves alone DaemonSet pods, host-network pods (what
`oc debug node/<name>` creates) and pods OpenShift Virtualization creates.

- The three control-plane node names are listed in the policy. Update them when a
  control-plane node is replaced.
- `failurePolicy: Ignore`: a rule that errors never blocks a pod.
- Break-glass: annotation `agent-office.io/control-plane-pin: exempt` on the pod or
  the pod template.
- Limit: it stops deliberate pins only. The scheduler can still place an unpinned pod
  with a large image on a control-plane node. The lasting fix is etcd on its own fast
  disk on `ec-0d-9a-92-a5-6a`, whose etcd fsync p99 sits near 48 ms on a normal day
  against 4 ms and 7 ms on the other two.

## What every CronJob in this repo must have

```yaml
spec:
  concurrencyPolicy: Forbid        # or Replace
  successfulJobsHistoryLimit: 1
  failedJobsHistoryLimit: 2
  jobTemplate:
    spec:
      activeDeadlineSeconds: 600   # a run that cannot start fails and is pruned
      backoffLimit: 2
      template:
        spec:
          containers:
            - image: registry.access.redhat.com/ubi9/ubi:9.7   # a tag or digest, never :latest
```

Need `oc` in a job? Use plain UBI9 and fetch the cluster's own binary from
`http://downloads.openshift-console.svc.cluster.local/amd64/linux/oc.tar`
(see `cluster/operator/operator-pullsecret-copier.yaml`).

Break-glass for a CronJob that genuinely needs concurrent runs:
`agent-office.io/cronjob-policy: exempt` as an annotation on the CronJob.

## Secret out of git

| Secret | What it holds | How to recreate |
|---|---|---|
| `openshift-monitoring/alertmanager-smtp` | key `password`: a Google app password for admin@enterprisewebservice.com, which Alertmanager uses to authenticate to Google Workspace's SMTP relay (`smtp-relay.gmail.com:587`). Until 2026-10-22 it held the Resend API key. | In zsh: `read -s "PW?Google app password: " && printf %s "$PW" \| oc create secret generic alertmanager-smtp -n openshift-monitoring --from-file=password=/dev/stdin --dry-run=client -o yaml \| oc apply -f - ; unset PW` |

The relay must be switched on in Google Admin: Apps → Google Workspace → Gmail →
Routing → SMTP relay service → Configure, with "Only addresses in my domains",
"Require SMTP Authentication" and "Require TLS encryption".

If it is missing, the Alertmanager pods stay in ContainerCreating (the
monitoring operator mounts it as a volume). Long-term it belongs behind an
ExternalSecret from Vault like the rest of `cluster/secrets`.

## Reversing any of it

Delete the file and let the Application prune. Three resources are marked
`Prune=false` on purpose and have to be handled by hand if you really want
them gone: `alertmanager-main` (the operator would reset it to a default
config with no email), `cluster-monitoring-config` (would switch off
user-workload monitoring), and the `Project` config singleton.

## Known limits

- The `pods` quota counts Terminating pods until they are gone, so a
  namespace that recycles many pods at once needs headroom; 40 is 4 to 10
  times what these five namespaces run.
- A quota does not touch Jobs that already exist; clean-up of an existing
  pile is still `oc delete jobs`.
- The admission policy checks CronJobs when they are created or updated,
  never retroactively.
- The 64-core worker runs about 220 pods legitimately, so
  `NodePodCapacityHigh` (92%) will speak up first about that node. If it
  gets noisy the right fix is a KubeletConfig raising `maxPods` for that
  node, not a higher threshold.
