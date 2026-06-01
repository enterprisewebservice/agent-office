#!/usr/bin/env python3
"""
openclaw <-> Mattermost bridge (prototype).

Watches an agent's Mattermost channel + DM; for each NEW human message it
drives the real openclaw agent and posts the reply back AS THE BOT (so it
shows up under the agent's own name). This is the request/reply loop that
makes a provisioned bot actually *answer*.

Env:
  MM_URL          Mattermost base (route)
  MM_ADMIN_TOKEN  admin PAT (to read posts / resolve channels)
  MM_BOT_TOKEN    the agent bot's token (to post as the bot)
  AGENT           openclaw agent id (e.g. genesis-pm)
  GW_NS / GW_LABEL  gateway pod location for `oc exec`

Prototype: runs locally, drives openclaw via `oc exec`. Productionize later
as an in-cluster Deployment.
"""
import json, os, re, ssl, subprocess, sys, time, urllib.error, urllib.request

MM = os.environ["MM_URL"]
ADMIN = os.environ["MM_ADMIN_TOKEN"]
BOTOK = os.environ["MM_BOT_TOKEN"]
AGENT = os.environ.get("AGENT", "genesis-pm")
GW_NS = os.environ.get("GW_NS", "agent-office")
GW_LABEL = os.environ.get("GW_LABEL", "agentoffice.ai/gateway=research-gateway")
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
        return e.code, json.loads(e.read() or "null")


def whoami(token):
    return api("GET", "/api/v4/users/me", token=token)[1]["id"]


def gw_pod():
    out = subprocess.run(["oc", "get", "pods", "-n", GW_NS, "-l", GW_LABEL,
        "--field-selector=status.phase=Running", "-o",
        "jsonpath={.items[0].metadata.name}"], capture_output=True, text=True).stdout.strip()
    return out


def drive(text):
    pod = gw_pod()
    if not pod:
        return "(gateway unavailable)"
    try:
        out = subprocess.run(["oc", "exec", "-n", GW_NS, pod, "-c", "openclaw", "--",
            "openclaw", "agent", "--agent", AGENT, "--message", text, "--timeout", "150"],
            capture_output=True, text=True, timeout=200)
    except subprocess.TimeoutExpired:
        return "(timed out thinking)"
    reply = ANSI.sub("", out.stdout).strip()
    return reply or "(no reply)"


def post(channel_id, message):
    api("POST", "/api/v4/posts", {"channel_id": channel_id, "message": message}, token=BOTOK)


def main():
    bot_id = whoami(BOTOK)
    print(f"[bridge] agent={AGENT} bot_id={bot_id}", file=sys.stderr)
    chan = open("/tmp/mm_genesis_chan.txt").read().strip()
    admin_id = whoami(ADMIN)
    _, dm = api("POST", "/api/v4/channels/direct", [admin_id, bot_id])
    channels = [chan, dm["id"]]
    print(f"[bridge] watching channels: {channels}", file=sys.stderr)

    # mark existing posts as seen so we only answer NEW messages
    seen = set()
    for ch in channels:
        _, ps = api("GET", f"/api/v4/channels/{ch}/posts?per_page=50")
        seen.update((ps or {}).get("order", []))

    print("[bridge] ready — message genesis-pm in Mattermost.", file=sys.stderr)
    while True:
        for ch in channels:
            st, ps = api("GET", f"/api/v4/channels/{ch}/posts?per_page=20")
            if st != 200:
                continue
            for pid in reversed(ps.get("order", [])):
                if pid in seen:
                    continue
                seen.add(pid)
                p = ps["posts"][pid]
                if p["user_id"] == bot_id or p.get("type"):
                    continue  # skip our own + system messages
                text = p.get("message", "").strip()
                if not text:
                    continue
                print(f"[bridge] <- {text!r}", file=sys.stderr)
                reply = drive(text)
                print(f"[bridge] -> {reply[:80]!r}", file=sys.stderr)
                post(ch, reply)
        time.sleep(3)


if __name__ == "__main__":
    main()
