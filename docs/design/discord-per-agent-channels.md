# Design: a Discord channel per agent (auto-provisioned, by name)

> Status: **designed, not built** (next thread). Supersedes/expands task #77.
> Decision (2026-06): provisioning **owns everything** — bot + guild + channels
> are stood up by the platform; assume nothing pre-exists.

## Goal
Every AgentWorkstation — even a standalone one — is **immediately reachable on
Discord in its own channel, under its own name**. Create `genesis-pm` →
a `#genesis-pm` channel appears → you message it there and *Genesis PM* (its
display name + emoji) replies. No manual channel creation, no pasted URLs.

## Current state (what exists today)
- `AgentWorkstation.spec.channels.discord.url` — only a UI "Open in Discord"
  link (`DiscordChannelSpec` is just `URL`). No routing.
- `AgentGateway` writes an **allowFrom** allowlist
  (`<channel>-<accountId>-allowFrom.json`) — access control, not creation.
- The gateway connects to Discord via openclaw's `discord` channel plugin
  (needs a bot token). **No bot/secret is provisioned today.**
- So: no channel creation, no channel→agent routing, no per-agent identity.

## Components to build
| # | Piece | Detail |
|---|---|---|
| 1 | **Bot + guild (provision everything)** | Stand up a Discord application + bot; create/own a guild (or accept a guild ID). Bot perms: `Manage Channels`, `Send Messages`, `Manage Webhooks`. Bot token → **Vault → ESO →** `discord-bot-token` Secret (same pattern as the GitHub App token). Document the one manual OAuth step if the Discord API can't fully self-serve app creation. |
| 2 | **Channel provisioning (operator)** | On AW reconcile, find-or-create `#<name>` in the guild (`POST /guilds/{guild}/channels`, idempotent). Persist `status.discord.channelId`. **Finalizer deletes (or archives) the channel on AW delete** — reversible by deleting the resource. |
| 3 | **Channel→agent routing** | Operator writes a `channelId → agentId` map into the gateway openclaw config so a message in `#genesis-pm` routes to the `genesis-pm` persona (not a random one). Extends the existing allowFrom wiring. |
| 4 | **Per-agent identity** | Reply via a per-channel **webhook** with `username=<displayName>` + `<emoji>` avatar, so each agent appears as *itself* — one bot, N identities. (Avoids a bot-token-per-agent.) |

## Declarative / reversible model
- `AgentGateway.spec.channels.discord`: `{ guildId, botTokenSecretRef,
  autoProvisionChannels: true }` — the gateway owns the bot connection.
- `AgentWorkstation.spec.channels.discord`: `{ autoChannel: true }` (default on
  when the gateway has Discord enabled). Operator provisions `#<name>` + routes
  + identity.
- Reversible by deletion: delete the AW → finalizer removes the channel +
  webhook + routing entry. No side-channel state.

## Build phases (suggested)
1. ESO/Vault `discord-bot-token` + a minimal `AgentGateway` Discord block; gateway
   connects to the guild (prove the bot is live).
2. Operator: Discord REST client (find/create/delete channel) + status field +
   finalizer. Provision `#<name>` per AW. (Thin slice = shared bot identity.)
3. Channel→agent routing in the gateway config.
4. Per-agent webhook identity (name + avatar).
5. Scaffolder template: surface as default-on (Channels page already has a
   `discordChannelUrl` field to evolve).

## Validation target
`oc apply` an AgentWorkstation → within a reconcile, `#<name>` exists in the
guild → post a message there → the agent replies as itself. Delete the AW →
the channel is gone. Idempotent; leaves no trace.
