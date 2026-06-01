#!/usr/bin/env python3
"""
Provision (or tear down) an agent's Mattermost presence — the reference
implementation the operator will mirror in Go.

For an agent it ensures, all via plain REST (no captcha, no portal):
  - a bot account  @<agent>  with display name <Display>      (its own name)
  - a bot access token                                         (runtime auth)
  - membership in the team
  - a public channel  #<agent>                                 (talk, no @mention)
  - a DM channel admin<->bot                                   (DM-able)

Idempotent (find-or-create). --teardown disables the bot + archives the channel.

  MM_URL=...  MM_TOKEN=...  ./provision-agent.py --agent genesis-pm --display "Genesis PM"
  MM_URL=...  MM_TOKEN=...  ./provision-agent.py --agent genesis-pm --teardown

MM_URL defaults to the in-cluster service; MM_TOKEN is the admin Personal
Access Token (secret mattermost/mattermost-admin-token).
"""
import argparse, json, os, ssl, sys, urllib.error, urllib.request

MM = os.environ.get("MM_URL", "http://mattermost.mattermost.svc.cluster.local:8065")
TOKEN = os.environ.get("MM_TOKEN", "")
TEAM = os.environ.get("MM_TEAM", "agents")
CTX = ssl.create_default_context(); CTX.check_hostname = False; CTX.verify_mode = ssl.CERT_NONE


def api(method, path, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(MM + path, data=data, method=method, headers={
        "Authorization": "Bearer " + (token or TOKEN), "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, context=CTX) as r:
            return r.status, json.loads(r.read() or "null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or "null")


def me_id():
    st, u = api("GET", "/api/v4/users/me")
    return u["id"] if st == 200 else None


def ensure_team():
    st, t = api("GET", f"/api/v4/teams/name/{TEAM}")
    if st != 200:
        st, t = api("POST", "/api/v4/teams", {"name": TEAM, "display_name": TEAM.title(), "type": "O"})
    return t["id"]


def find_bot(agent):
    st, bots = api("GET", "/api/v4/bots?per_page=200&include_deleted=true")
    return next((b for b in (bots or []) if b["username"] == agent), None) if st == 200 else None


def provision(agent, display):
    admin = me_id(); team = ensure_team()
    api("POST", f"/api/v4/teams/{team}/members", {"team_id": team, "user_id": admin})

    bot = find_bot(agent)
    if not bot:
        st, bot = api("POST", "/api/v4/bots", {"username": agent, "display_name": display,
                      "description": f"{display} — talk to me in #{agent} or DM me."})
        if st != 201:
            print("FAIL create bot:", json.dumps(bot)); sys.exit(1)
    else:
        api("POST", f"/api/v4/bots/{bot['user_id']}/enable")  # re-enable if previously disabled
    bot_id = bot["user_id"]

    st, tok = api("POST", f"/api/v4/users/{bot_id}/tokens", {"description": "agent runtime"})
    bot_token = tok.get("token", "")
    api("POST", f"/api/v4/teams/{team}/members", {"team_id": team, "user_id": bot_id})

    st, c = api("GET", f"/api/v4/teams/{team}/channels/name/{agent}")
    if st != 200:
        st, c = api("POST", "/api/v4/channels", {"team_id": team, "name": agent,
                    "display_name": display, "type": "O"})
    chan = c["id"]
    api("POST", f"/api/v4/channels/{chan}/members", {"user_id": bot_id})
    api("POST", f"/api/v4/channels/{chan}/members", {"user_id": admin})

    st, dm = api("POST", "/api/v4/channels/direct", [admin, bot_id])
    dm_id = dm["id"] if st in (200, 201) else ""

    out = {"agent": agent, "display": display, "bot_id": bot_id, "channel_id": chan,
           "dm_channel_id": dm_id, "bot_token": bot_token}
    print(json.dumps(out))
    print(f"  ✓ @{agent} ('{display}') provisioned: channel #{agent} + DM, own bot identity", file=sys.stderr)


def teardown(agent):
    team = ensure_team()
    st, c = api("GET", f"/api/v4/teams/{team}/channels/name/{agent}")
    if st == 200:
        api("DELETE", f"/api/v4/channels/{c['id']}")  # archive
        print(f"  archived channel #{agent}", file=sys.stderr)
    bot = find_bot(agent)
    if bot:
        api("POST", f"/api/v4/bots/{bot['user_id']}/disable")
        print(f"  disabled bot @{agent}", file=sys.stderr)
    print("TEARDOWN_OK", file=sys.stderr)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--agent", required=True)
    ap.add_argument("--display", default=None)
    ap.add_argument("--teardown", action="store_true")
    a = ap.parse_args()
    if not TOKEN:
        print("MM_TOKEN required", file=sys.stderr); sys.exit(2)
    if a.teardown:
        teardown(a.agent)
    else:
        provision(a.agent, a.display or a.agent)
