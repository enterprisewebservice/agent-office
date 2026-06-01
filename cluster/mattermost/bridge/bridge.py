#!/usr/bin/env python3
"""
openclaw <-> Mattermost bridge + auto-provisioner — in-cluster, multi-agent.

On a periodic cycle it AUTO-PROVISIONS every AgentWorkstation: ensures each
one has a Mattermost bot @<agent> (its own name) + a #<agent> channel + a DM,
and tears that presence down when the AW is deleted (only ever touching bots
it provisioned). Then it watches each agent's channel + DM and, for every new
human message, drives the REAL openclaw agent (on that agent's gateway) and
posts the reply back AS the bot. So every agent is chat-reachable the moment
it exists — create an AgentWorkstation, message #<agent>, it answers as itself.

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
import hashlib, json, os, re, ssl, subprocess, sys, time, urllib.error, urllib.request

MM = os.environ["MM_URL"]
ADMIN = os.environ["MM_ADMIN_TOKEN"]
TEAM_NAME = os.environ.get("MM_TEAM", "agents")
GW_NS = os.environ.get("GW_NS", "agent-office")
POLL = int(os.environ.get("POLL_SECONDS", "3"))
REDISCOVER = int(os.environ.get("REDISCOVER_SECONDS", "60"))
CTX = ssl.create_default_context(); CTX.check_hostname = False; CTX.verify_mode = ssl.CERT_NONE
ANSI = re.compile(r"\x1b\[[0-9;]*m")

# --- presence + typing via a per-bot WebSocket --------------------------------
# A live WS connection makes a bot show ONLINE (green); user_typing events on it
# drive the "…is typing" indicator while the agent thinks. Graceful if the lib
# is absent (chat still works via polling).
import threading  # noqa: E402
try:
    import websocket  # websocket-client (pip-installed at container start)
    HAVE_WS = True
except Exception:
    HAVE_WS = False
# The WS must hit the SiteURL host (the route) — Mattermost blocks WS upgrades
# whose Host/Origin != SiteURL ("URL Blocked because of CORS"). REST stays on
# the internal service; only the WS uses the route.
MM_WS = os.environ.get("MM_WS_URL", MM)
WS_URL = MM_WS.replace("https://", "wss://").replace("http://", "ws://") + "/api/v4/websocket"
WSCONNS = {}  # agent -> WebSocketApp (persistent → presence)


def get_ws(agent, token):
    """One persistent authenticated WS per bot (keeps it online)."""
    if not HAVE_WS or not token:
        return None
    if agent in WSCONNS:
        return WSCONNS[agent]

    def on_open(w):
        w.send(json.dumps({"seq": 1, "action": "authentication_challenge",
                           "data": {"token": token}}))

    app = websocket.WebSocketApp(WS_URL, on_open=on_open,
                                 on_error=lambda w, e: None,
                                 on_close=lambda w, *a: WSCONNS.pop(agent, None))
    threading.Thread(target=lambda: app.run_forever(ping_interval=30, ping_timeout=10,
                     sslopt={"cert_reqs": ssl.CERT_NONE}), daemon=True).start()
    WSCONNS[agent] = app
    return app


def with_typing(ws, channel, fn):
    """Run fn() while emitting user_typing on `ws` (so the bot shows 'is typing')."""
    if not ws:
        return fn()
    stop = threading.Event()

    def typer():
        seq = 100
        while not stop.is_set():
            try:
                ws.send(json.dumps({"action": "user_typing", "seq": seq,
                                    "data": {"channel_id": channel, "parent_id": ""}}))
            except Exception:
                pass
            seq += 1
            stop.wait(2)  # typing events expire ~5s; refresh every 2s

    t = threading.Thread(target=typer, daemon=True); t.start()
    try:
        return fn()
    finally:
        stop.set()


FAILED = set()  # agents that can't be provisioned (e.g. name > Mattermost's
                # 22-char username limit) — skip + don't spam the log.


def set_online(bot_id):
    """Keep the bot status ONLINE (green dot). A WS alone drifts to 'away', so
    refresh it every discovery cycle (well under Mattermost's auto-away)."""
    try:
        api("PUT", f"/api/v4/users/{bot_id}/status", {"user_id": bot_id, "status": "online"})
    except Exception:
        pass


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


def list_aws():
    """{name: displayName} for every AgentWorkstation, or None on a read error
    (so we never tear down on a transient failure)."""
    out = oc("get", "agentworkstations", "-n", GW_NS, "-o", "json")
    if not out:
        return None
    try:
        items = json.loads(out).get("items", [])
        return {i["metadata"]["name"]:
                (i.get("spec", {}).get("displayName") or i["metadata"]["name"])
                for i in items}
    except Exception:
        return None


def mm_slug(name):
    """Mattermost handle (username + channel name) for an agent. Mattermost caps
    usernames at 22 chars, so longer names are shortened to "<first 13>-<sha256[:8]>".
    MUST stay byte-for-byte identical to mmSlug() in the operator
    (agentworkstation_mattermost.go) + slug() in the beats."""
    if len(name) <= 22:
        return name
    h = hashlib.sha256(name.encode()).hexdigest()[:8]
    return name[:13].rstrip("-._") + "-" + h


def ensure_presence(agent, display, team_id, admin_id):
    """Find the agent's USER + channel (provisioned by the OPERATOR's reconcile)
    and set up the chat record (token + DM + presence WS). Does NOT create —
    the operator owns provisioning; we just bridge what it made. Returns None
    until the operator has provisioned this agent."""
    slug = mm_slug(agent)  # the handle the operator provisioned under
    u = get_user(slug)
    if not u or u.get("is_bot"):
        return None  # operator hasn't provisioned this agent (yet)
    uid = u["id"]
    set_online(uid)  # keep the green dot lit
    _, tok = api("POST", f"/api/v4/users/{uid}/tokens", {"description": "bridge"})
    api("POST", f"/api/v4/teams/{team_id}/members", {"team_id": team_id, "user_id": uid})
    st, ch = api("GET", f"/api/v4/teams/{team_id}/channels/name/{slug}")
    if st != 200:
        return None  # operator hasn't made the channel yet
    chan = ch["id"]
    api("POST", f"/api/v4/channels/{chan}/members", {"user_id": uid})
    api("POST", f"/api/v4/channels/{chan}/members", {"user_id": admin_id})
    _, dm = api("POST", "/api/v4/channels/direct", [admin_id, uid])
    chans = [chan] + ([dm["id"]] if dm.get("id") else [])
    return {"bot_id": uid, "token": tok.get("token", ""),
            "gw": aw_gateway(agent), "channels": chans,
            "ws": get_ws(agent, tok.get("token", ""))}  # presence (green) + typing


def teardown_presence(agent, team_id):
    w = WSCONNS.pop(agent, None)
    if w:
        try:
            w.close()
        except Exception:
            pass
    # The operator's finalizer deactivates the user + archives the channel on
    # AW delete — the bridge just stops bridging.
    print(f"[bridge] stopped bridging @{agent} (operator handles Mattermost teardown)",
          file=sys.stderr, flush=True)


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


def get_user(username):
    st, u = api("GET", f"/api/v4/users/username/{username}")
    return u if st == 200 else None


# agents this bridge has provisioned — so teardown only ever touches our own.
PROVISIONED = set()


def discover(admin_id, team_id):
    """AUTO-PROVISION: every AgentWorkstation gets a bot + channel + DM; an AW
    that disappears has its (bridge-provisioned) presence torn down. Returns the
    live {agent: record} map, or None on a cluster read error (keep the old map)."""
    aws = list_aws()
    if aws is None:
        return None
    agents = {}
    for agent, display in aws.items():
        if agent in FAILED:
            continue
        rec = ensure_presence(agent, display, team_id, admin_id)
        if rec:
            agents[agent] = rec
            PROVISIONED.add(agent)
    for agent in list(PROVISIONED):
        if agent not in aws:
            teardown_presence(agent, team_id)
            PROVISIONED.discard(agent)
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
            last_disc = now
            new = discover(admin_id, team_id)
            if new is not None:  # None == cluster read error → keep the old map
                agents = new
                print(f"[bridge] agents: {sorted(agents)}", file=sys.stderr, flush=True)
                if not started:
                    # on first discovery, mark existing posts seen (answer only NEW msgs)
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
                    # show "…is typing" while the agent thinks
                    reply = with_typing(a.get("ws"), ch, lambda: drive(agent, a["gw"], text))
                    print(f"[bridge] {agent} -> {reply[:80]!r}", file=sys.stderr, flush=True)
                    api("POST", "/api/v4/posts", {"channel_id": ch, "message": reply}, token=a["token"])
        time.sleep(POLL)


if __name__ == "__main__":
    main()
