# Mattermost — the agent platform's chat backend

Self-hosted Mattermost (Team Edition, free) in the `mattermost` namespace. We
pivoted here from Discord because Discord **captcha-walls programmatic bot
creation** — Mattermost is 100% API-driven, so every agent gets a bot account
+ channel + DM via plain REST, no portal, no captcha, no limits.

## What's deployed (`mattermost.yaml`)
- **Postgres** (OpenShift-native `sclorg/postgresql-15`, restricted SCC)
- **Mattermost** (`docker.io/mattermost/mattermost-team-edition`, needs `anyuid`)
- **Route**: https://mattermost-mattermost.apps.salamander.aimlworkbench.com
- In-cluster API: `http://mattermost.mattermost.svc.cluster.local:8065`

`oc apply -f cluster/mattermost/mattermost.yaml`

## One-time bootstrap (secrets are NOT in git)
1. **DB creds** — generated password, kept out of git:
   ```
   oc create secret generic mattermost-db -n mattermost \
     --from-literal=POSTGRESQL_USER=mmuser \
     --from-literal=POSTGRESQL_PASSWORD="$(openssl rand -hex 16)" \
     --from-literal=POSTGRESQL_DATABASE=mattermost
   ```
2. **Admin + provisioner token** — the first user created becomes system admin:
   ```
   MM=https://mattermost-mattermost.apps.salamander.aimlworkbench.com
   curl -sk -X POST $MM/api/v4/users -d '{"email":"admin@agent-office.local","username":"agentadmin","password":"<PW>"}'
   # login -> session token (Token response header), then mint a PAT:
   curl -sk -X POST $MM/api/v4/users/<adminId>/tokens -H "Authorization: Bearer <session>" -d '{"description":"provisioner"}'
   oc create secret generic mattermost-admin-token -n mattermost --from-literal=token=<PAT>
   ```
   > TODO: make this a bootstrap Job + move both secrets to Vault/ESO (declarative).

## Per-agent provisioning
`integration-tests/mattermost/provision-agent.py` is the reference flow the
operator will mirror in Go. Idempotent; `--teardown` disables the bot +
archives the channel.
```
export MM_URL=http://mattermost.mattermost.svc.cluster.local:8065   # in-cluster
export MM_TOKEN=$(oc get secret mattermost-admin-token -n mattermost -o jsonpath='{.data.token}' | base64 -d)
python3 integration-tests/mattermost/provision-agent.py --agent genesis-pm --display "Genesis PM"
```
For each agent it ensures: a **bot** `@<agent>` (its own name) + **bot token**
(runtime auth) + team membership + a **channel** `#<agent>` (talk, no @mention)
+ a **DM channel** (DM-able). Proven end-to-end.

## Roadmap
- [x] Deploy Mattermost in-cluster (declarative)
- [x] API-driven per-agent bot + channel + DM (proven; reference provisioner)
- [x] **openclaw ↔ Mattermost** — `integration-tests/mattermost/bridge.py`: watches an
      agent's channel + DM, drives the real openclaw agent, posts the reply AS the
      bot. PROVEN (genesis-pm answers in `#genesis-pm`). Prototype runs locally;
      productionize as an in-cluster Deployment next.
- [x] **In-cluster bridge** — `cluster/mattermost/bridge/` Deployment (mm-bridge), durable
- [x] **Auto-provision** — the bridge watches AgentWorkstations and mints a bot + channel
      + DM for EVERY agent (tearing it down when the AW is deleted; only touches bots it
      provisioned). So every agent is chat-reachable the moment it exists. PROVEN.
- [x] **Presence (green dot) + "…is typing"** — a persistent per-bot WebSocket keeps each
      bot ONLINE, and `user_typing` events fire while the agent thinks. (The WS must hit the
      SiteURL host via the route — Mattermost blocks WS upgrades whose Host/Origin != SiteURL.)
      Both verified live.
- [ ] Name sanitization for agents whose name exceeds Mattermost's 22-char username limit
- [ ] Fold auto-provision into the main operator's reconcile + finalizer (native, with status)
- [ ] Drive openclaw via its API instead of `oc exec`; bootstrap Job + Vault/ESO for secrets

Supersedes the Discord approach in `docs/design/discord-per-agent-channels.md`
(kept for history; Discord is unusable for automated bot creation).
