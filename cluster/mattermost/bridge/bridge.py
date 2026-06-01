#!/usr/bin/env python3
"""
openclaw <-> Mattermost bridge — in-cluster, multi-agent.

Discovers every provisioned agent (a Mattermost bot whose username matches an
AgentWorkstation), and for each one watches its channel #<agent> + the
admin<->bot DM. For each new human message it drives the REAL openclaw agent
(on that agent's gateway) and posts the reply back AS the bot, under the
agent's own name. Re-discovers periodically, so a newly-provisioned agent
becomes chat-reachable automatically.

Env:
  MM_URL           Mattermost base (in-cluster service)
  MM_ADMIN_TOKEN   admin PAT (reads posts, resolves channels, mints bot tokens)
  MM_TEAM          team name (default "agents")
  GW_NS            namespace the gateways live in (default "agent-office")
  POLL_SECONDS     poll interval (default 3)
  REDISCOVER_SECONDS  agent re-discovery interval (default 60)

Drives openclaw with `oc exec` using the pod's ServiceAccount (needs
pods/exec + agentworkstations get).
"""
import json, os, re, ssl, subprocess, sys, time, urllib.error, urllib.request

MM = os.environ["MM_URL"]
ADMIN = os.environ["MM_ADMIN_TOKEN"]
TEAM_NAME = os.environ.get("MM_TEAM", "agents")
GW_NS = os.environ.get("GW_NS", "agent-office")
POLL = int(os.environ.get("POLL_SECONDS", "3"))
REDISCOVER = int(os.environ.get("REDISCOVER_SECONDS", "60"))
CTX = ssl.create_default_context(); CTX.check_hostname = False; CTX.verify_mode = ssl.CERT_NONE
ANSI = re.compile(r"\x1b\[[0-9;]*m")


def api(method, path, body=None, token=ADMIN):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(MM + path, data=data, method=method, headers={
        "Authorization": "Bearer " + token, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, context=CTX) as r:
            return r.status, json.loads(r.read() or "null")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or "null")
        except Exception:
            return e.code, None


def oc(*args):
    return subprocess.run(["oc", *args], capture_output=True, text=True).stdout.strip()


def aw_gateway(agent):
    gw = oc("get", "agentworkstation", agent, "-n", GW_NS,
            "-o", "jsonpath={.spec.runtime.shared.gatewayRef}")
    return gw or None


def gw_pod(gw):
    return oc("get", "pods", "-n", GW_NS, "-l", f"agentoffice.ai/gateway={gw}",
              "--field-selector=status.phase=Running",
              "-o", "jsonpath={.items[0].metadata.name}") or None


def drive(agent, gw, text):
    pod = gw_pod(gw)
    if not pod:
        return "(my gateway is unavailable right now)"
    try:
        out = subprocess.run(["oc", "exec", "-n", GW_NS, pod, "-c", "openclaw", "--",
            "openclaw", "agent", "--agent", agent, "--message", text, "--timeout", "150"],
            capture_output=True, text=True, timeout=200)
    except subprocess.TimeoutExpired:
        return "(I took too long thinking — try again?)"
    return ANSI.sub("", out.stdout).strip() or "(no reply)"


def discover(admin_id, team_id):
    """Return {agent: {bot_id, token, gw, channels:[...]}} for bots that are AWs."""
    st, bots = api("GET", "/api/v4/bots?per_page=200")
    agents = {}
    for b in (bots or []):
        if b.get("delete_at"):
            continue
        agent = b["username"]
        gw = aw_gateway(agent)
        if not gw:
            continue  # only bridge bots that are real AgentWorkstations
        _, tok = api("POST", f"/api/v4/users/{b['user_id']}/tokens", {"description": "bridge"})
        _, ch = api("GET", f"/api/v4/teams/{team_id}/channels/name/{agent}")
        _, dm = api("POST", "/api/v4/channels/direct", [admin_id, b["user_id"]])
        chans = [c["id"] for c in (ch, dm) if c and c.get("id")]
        agents[agent] = {"bot_id": b["user_id"], "token": tok.get("token", ""),
                         "gw": gw, "channels": chans}
    return agents


def main():
    admin_id = api("GET", "/api/v4/users/me")[1]["id"]
    team_id = api("GET", f"/api/v4/teams/name/{TEAM_NAME}")[1]["id"]
    print(f"[bridge] up. team={TEAM_NAME} ns={GW_NS}", file=sys.stderr, flush=True)

    agents = {}
    seen = set()
    last_disc = 0.0
    started = False
    while True:
        now = time.time()
        if now - last_disc > REDISCOVER:
            agents = discover(admin_id, team_id)
            last_disc = now
            print(f"[bridge] agents: {sorted(agents)}", file=sys.stderr, flush=True)
            if not started:
                # on first discovery, mark existing posts as seen (answer only NEW msgs)
                for a in agents.values():
                    for ch in a["channels"]:
                        _, ps = api("GET", f"/api/v4/channels/{ch}/posts?per_page=50")
                        seen.update((ps or {}).get("order", []))
                started = True
                print("[bridge] ready.", file=sys.stderr, flush=True)

        for agent, a in agents.items():
            for ch in a["channels"]:
                st, ps = api("GET", f"/api/v4/channels/{ch}/posts?per_page=20")
                if st != 200:
                    continue
                for pid in reversed(ps.get("order", [])):
                    if pid in seen:
                        continue
                    seen.add(pid)
                    p = ps["posts"][pid]
                    if p["user_id"] == a["bot_id"] or p.get("type"):
                        continue
                    text = (p.get("message") or "").strip()
                    if not text:
                        continue
                    print(f"[bridge] {agent} <- {text!r}", file=sys.stderr, flush=True)
                    reply = drive(agent, a["gw"], text)
                    print(f"[bridge] {agent} -> {reply[:80]!r}", file=sys.stderr, flush=True)
                    api("POST", "/api/v4/posts", {"channel_id": ch, "message": reply}, token=a["token"])
        time.sleep(POLL)


if __name__ == "__main__":
    main()
