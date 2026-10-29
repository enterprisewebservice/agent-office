# Codex sign-ins, one per gateway

Codex refresh tokens are single-use with rotation, so two holders of one
sign-in cut each other off at the first refresh. Each Codex agent gateway
therefore has its own sign-in:

```
Vault agent-office/codex/<gateway>   (KV v2, property auth.json)
  -> ExternalSecret <gateway>-codex-credentials   (cluster/secrets/codex-gateway-credentials.yaml, every minute)
  -> Secret <gateway>-codex-credentials           (AgentGateway spec.codexCredentialsSecretRef)
  -> codex-auth-sync sidecar -> the gateway's agent stores
```

The sidecar copies that credential into the gateway's agents only when they
hold no usable sign-in or it expires later than theirs. After the gateway
refreshes its own token in its pod, Vault's copy is a recovery seed, and the
backend judges the gateway by its daily test turn, never by refreshing the
copy.

## First seed: copy each gateway's current sign-in into Vault

Nobody signs in again. For each gateway, `export-gateway-token.cjs` reads the
freshest sign-in its own agents hold (read-only) and streams it straight into
`vault kv put`; the token never touches disk. Vault never refreshes, so it is
not a second live holder.

Run from the agent-office repo with `oc` logged in to salamander. It asks for
the Vault root token (the `root-token` key of Secret `vault-bootstrap-keys`
in namespace `vault`):

```bash
printf 'Vault root token: '; read -rs VAULT_TOKEN; echo; for gw in handsonmode-help newsroom-gateway research-gateway runtab-help supply-chain-ops-gateway upstreambeat-newsroom-gateway; do echo "== $gw"; oc exec -i -n agent-office deploy/$gw -c codex-auth-sync -- node --no-warnings - < scripts/codex/export-gateway-token.cjs | oc exec -i -n vault vault-0 -- sh -c "VAULT_TOKEN=$VAULT_TOKEN vault kv put -mount=agent-office codex/$gw auth.json=-" | grep -E '^(created_time|version)'; done; unset VAULT_TOKEN
```

Each gateway prints the agent and lineage it exported (the same fingerprint
the Dev Hub card shows), then Vault's `created_time` and `version`. Within a
minute the six ExternalSecrets turn `SecretSynced`:

```bash
oc get externalsecrets -n agent-office -l agentoffice.ai/credential=codex-gateway
```

Only then point each AgentGateway's `codexCredentialsSecretRef` at
`<gateway>-codex-credentials`.

## Later: a gateway's sign-in died

The daily test turn fails and emails (CodexGatewayTurnFailing). In Dev Hub,
open an agent's **Codex Subscription Auth** card and press **Re-authenticate**
on that gateway's row. The sign-in runs in your browser and writes only that
gateway's Vault key; the gateway picks it up within about two minutes.
