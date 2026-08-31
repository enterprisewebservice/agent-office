# OpenShift AI Models-as-a-Service on salamander (RHOAI 3.4, Tech Preview)

What's in this dir (apply order matters only on first bootstrap):

1. `maas-default-gateway.yaml` — the required Gateway (service-ca TLS
   via the infra-ConfigMap trick, mirroring data-science-gateway).
2. `external-models.yaml` — ExternalModel + MaaSModelRef pairs.
   External SaaS models ride model-desk (LiteLLM) as the
   protocol/credential translator; `endpointOverride` MUST be
   `https://model-desk...:8443/v1` — the MaaS data path originates
   TLS to external backends unconditionally.
3. `maas-subscriptions.yaml` — who gets budgets (token rate limits
   per model, enforced by Limitador).
4. `maas-authpolicy.yaml` — who gets access at all. Without one, the
   gateway's default policy denies every model route.

Live-only prerequisites (operator-owned or secret; not in this repo):

- DataScienceCluster: `spec.components.kserve.modelsAsService: Managed`.
- Postgres: software-factory-deployer/deploy/salamander-maas-db +
  Secret `redhat-ods-applications/maas-db-config` (DB_CONNECTION_URL).
- Authorino TLS/trust (per the RHOAI 3.4 MaaS doc, applied 2026-08-31):
  - `oc annotate service authorino-authorino-authorization -n kuadrant-system service.beta.openshift.io/serving-cert-secret-name=authorino-server-cert`
  - Authorino CR: `spec.listener.tls {enabled: true, certSecretRef: authorino-server-cert}`
  - `oc -n kuadrant-system set env deployment/authorino SSL_CERT_FILE=/etc/ssl/certs/openshift-service-ca/service-ca-bundle.crt REQUESTS_CA_BUNDLE=...` (same path)
  - Authorino CR `spec.volumes` mounts ConfigMap `openshift-service-ca.crt`
    at that path — the doc's env vars point at a mount nothing creates.
  - Gateway annotation `security.opendatahub.io/authorino-tls-bootstrap=true`.
- maas-controller: annotated `opendatahub.io/managed=false` with
  memory limit raised to 2Gi — the default 512Mi OOMs against this
  cluster's object counts.

Known TP gaps bridged in model-desk's TLS sidecar (see
software-factory-deployer/deploy/salamander-model-desk):

- The public path `/models-as-a-service/<model>/v1/...` is forwarded
  verbatim; the sidecar strips the scope prefix for LiteLLM.
- The ExternalModel `credentialRef` is NOT injected on the data path
  (BBR not rendered in this build); the sidecar swaps in LiteLLM's
  key — that leg only ever carries traffic that already passed MaaS
  auth + quota.

Consumer flow (verified live 2026-08-31, reply `MAAS-GOVERNED-OK`):
mint a key `POST {gw}/maas-api/v1/api-keys` with an OpenShift token,
then `POST {gw}/models-as-a-service/<model>/v1/chat/completions` with
`Authorization: Bearer <key>`. Gateway (in-cluster):
`https://maas-default-gateway-data-science-gateway-class.openshift-ingress.svc.cluster.local`.
