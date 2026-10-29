// export-gateway-token.cjs: print the freshest Codex sign-in a gateway's
// agents hold, as a Codex auth.json, so it can be piped into
// `vault kv put -mount=agent-office codex/<gateway> auth.json=-`.
//
// Runs inside the gateway pod's codex-auth-sync container, read from stdin:
//
//   oc exec -i -n agent-office deploy/<gateway> -c codex-auth-sync -- node - < scripts/codex/export-gateway-token.cjs
//
// stdout is the auth.json: token material, so pipe it, never save it.
// stderr names the agent and account it came from, the lineage
// fingerprint (sha256[:12] of the refresh token, the same id the Dev Hub
// card shows) and when the access token expires.
//
// Read-only: it opens every agent store under /home/node/.openclaw/agents
// readOnly and picks the openai OAuth profile that expires last, the same
// rule codex-auth-sync uses. Copying that token into Vault adds no second
// live holder: Vault never refreshes, and the sidecar only seeds a token
// that expires later than what the agents already hold.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const AGENTS_DIR = process.env.CODEX_SYNC_AGENTS_DIR || "/home/node/.openclaw/agents";
const fingerprint = (t) => crypto.createHash("sha256").update(String(t)).digest("hex").slice(0, 12);
const claims = (jwt) => {
  try {
    return JSON.parse(Buffer.from(String(jwt).split(".")[1], "base64url").toString());
  } catch {
    return {};
  }
};

let best = null;
const accounts = new Set();
for (const id of fs.readdirSync(AGENTS_DIR)) {
  const dbPath = path.join(AGENTS_DIR, id, "agent", "openclaw-agent.sqlite");
  if (!fs.existsSync(dbPath)) continue;
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    const row = db.prepare("SELECT store_json FROM auth_profile_store WHERE store_key='primary'").get();
    for (const [pid, p] of Object.entries(row ? JSON.parse(row.store_json).profiles ?? {} : {})) {
      if (!p || p.provider !== "openai" || p.type !== "oauth" || !p.access || !p.refresh) continue;
      accounts.add(pid);
      if (!best || (Number(p.expires) || 0) > (Number(best.p.expires) || 0)) best = { id, pid, p };
    }
  } finally {
    db.close();
  }
}
if (!best) {
  console.error("no Codex sign-in in this gateway's agent stores; nothing exported");
  process.exit(1);
}
if (accounts.size > 1) {
  console.error(`more than one Codex account in this gateway (${[...accounts].join(", ")}); nothing exported`);
  process.exit(1);
}
const acc = claims(best.p.access);
process.stdout.write(
  JSON.stringify(
    {
      auth_mode: "chatgpt",
      OPENAI_API_KEY: null,
      tokens: {
        id_token: "",
        access_token: best.p.access,
        refresh_token: best.p.refresh,
        account_id: best.p.accountId || acc["https://api.openai.com/auth"]?.chatgpt_account_id || null,
      },
      last_refresh: new Date().toISOString(),
    },
    null,
    2,
  ),
);
console.error(
  `exported ${best.pid} from agent ${best.id}: lineage ${fingerprint(best.p.refresh)}, access token expires ${new Date(Number(best.p.expires)).toISOString()}`,
);
