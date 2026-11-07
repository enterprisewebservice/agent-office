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
  MLFLOW_URI       OpenShift AI MLflow tracking server; when set, every turn is
                   recorded as an MLflow trace (guardrail, model call, each
                   tool call with its latency) in MLFLOW_WORKSPACE /
                   MLFLOW_EXPERIMENT. Chat never waits on or fails for tracing.

Drives openclaw with `oc exec` using the pod's ServiceAccount (needs
pods/exec + agentworkstations get).
"""
import hashlib, json, os, re, ssl, subprocess, sys, time, urllib.error, urllib.request

MM = os.environ["MM_URL"]
ADMIN = os.environ["MM_ADMIN_TOKEN"]
TEAM_NAME = os.environ.get("MM_TEAM", "agents")
# Comma-separated: the shared namespace plus per-attendee agent workspaces
# (<handle>-agent-workspace, ...). Every AW record carries its own namespace.
GW_NAMESPACES = [n.strip() for n in os.environ.get("GW_NS", "agent-office").split(",") if n.strip()]
# Dynamic seats (factory-hub) are not in GW_NS: they are discovered by the
# same label the operator uses (agentoffice.ai/managed=true), re-read on
# every rediscovery, so a seat provisioned after the bridge started is
# bridged within REDISCOVER seconds. Needs `list namespaces` (rbac.yaml).
SEAT_NS_LABEL = os.environ.get("SEAT_NS_LABEL", "agentoffice.ai/managed=true")
POLL = int(os.environ.get("POLL_SECONDS", "3"))
REDISCOVER = int(os.environ.get("REDISCOVER_SECONDS", "60"))
CTX = ssl.create_default_context(); CTX.check_hostname = False; CTX.verify_mode = ssl.CERT_NONE
ANSI = re.compile(r"\x1b\[[0-9;]*m")

# --- content guardrail: Granite Guardian via the Guardrails Orchestrator ----------
# Every human message is screened BEFORE it reaches any agent (and therefore any
# model), inside the typing indicator so the chat feels the same. The detector
# (Red Hat HF detector runtime serving Granite Guardian) scores the fixed risk
# list below, in this order, one result each; the bridge blocks when a risk it
# is configured to block clears its threshold. Fails CLOSED by default: if the
# guardrail is unreachable the message is not relayed. Flagged messages are
# logged (who, channel, risk, scores, text) — never sent on.
GUARD_URL = os.environ.get("GUARDRAILS_URL", "").rstrip("/")      # https://guardrails-service.guardrails.svc.cluster.local:8032
GUARD_DETECTOR = os.environ.get("GUARDRAILS_DETECTOR", "granite-guardian")
GUARD_RISKS = ["harm", "social_bias", "jailbreak", "profanity", "unethical_behavior", "sexual_content", "violence"]
GUARD_BLOCK = {k.strip(): float(v) for k, v in (x.split("=", 1) for x in
               os.environ.get("GUARDRAILS_BLOCK", "sexual_content=0.5,illegal_activity=0.6,violence=0.7,harm=0.8,unethical_behavior=0.8,jailbreak=0.8").split(",") if "=" in x)}
GUARD_FAIL_CLOSED = os.environ.get("GUARDRAILS_FAIL_CLOSED", "true").lower() == "true"
GUARD_CA = "/var/run/secrets/kubernetes.io/serviceaccount/service-ca.crt"
GUARD_REPLY = os.environ.get("GUARDRAILS_REPLY",
    "I can't help with that here. The platform's content guardrail flagged this message ({risk}), so it was not sent to the model. "
    "This workshop is for building and running agents; a person reviews flagged messages.")


def screen(text):
    """Ask the orchestrator to score `text`. Returns (blocked_risk, score, scores) — blocked_risk None when clean. Raises on outage."""
    body = json.dumps({"detectors": {GUARD_DETECTOR: {"threshold": 0.0}}, "content": text}).encode()
    req = urllib.request.Request(GUARD_URL + "/api/v2/text/detection/content", data=body,
                                 headers={"Content-Type": "application/json", "Accept": "application/json"})
    ctx = ssl.create_default_context(cafile=GUARD_CA) if (GUARD_URL.startswith("https") and os.path.exists(GUARD_CA)) else CTX
    with urllib.request.urlopen(req, context=ctx, timeout=60) as r:
        out = json.load(r)
    dets = [d for d in out.get("detections", []) if d.get("detector_id", GUARD_DETECTOR) == GUARD_DETECTOR]
    scores = {}
    for i, d in enumerate(dets):
        # the shim labels each result with its risk name (detection); the shipped
        # HF runtime does not and returns them in GUARD_RISKS order instead.
        name = d.get("detection") if d.get("detection") in GUARD_RISKS or str(d.get("detection", "")).endswith("_activity") else None
        scores[name or (GUARD_RISKS[i] if i < len(GUARD_RISKS) else f"risk{i}")] = float(d.get("score") or 0.0)
    hits = [(r, s) for r, s in scores.items() if r in GUARD_BLOCK and s >= GUARD_BLOCK[r]]
    if hits:
        # name the most specific reason, not the highest score: an explicit request
        # also scores high on "harm"/"unethical behavior", which tells the person nothing.
        order = ["sexual_content", "illegal_activity", "violence", "jailbreak", "profanity", "social_bias", "harm", "unethical_behavior"]
        r, s = sorted(hits, key=lambda x: (order.index(x[0]) if x[0] in order else 99, -x[1]))[0]
        return r, s, scores
    return None, None, scores


def react(a, pid, emoji):
    """Visible proof on the message itself: the bot reacts to every human post it screened."""
    if pid and a.get("bot_id") and a.get("token"):
        try:
            api("POST", "/api/v4/reactions", {"user_id": a["bot_id"], "post_id": pid, "emoji_name": emoji}, token=a["token"])
        except Exception:
            pass


def guarded_drive(agent, a, ch, text, pid=None):
    turn = Turn(agent, a, ch, text, pid)
    if GUARD_URL:
        t0 = time.time()
        g = {"t_start": time.time_ns()}
        try:
            risk, score, scores = screen(text)
        except Exception as e:
            print(f"[guard] {agent} screen failed: {str(e)[:160]}", file=sys.stderr, flush=True)
            react(a, pid, "warning")
            g.update(t_end=time.time_ns(), decision="unavailable", error=str(e)[:200])
            turn.guard = g
            if GUARD_FAIL_CLOSED:
                return "(the content guardrail is unavailable right now — try again in a minute)", turn
            risk = None
        else:
            top = max(scores.items(), key=lambda x: x[1]) if scores else ("-", 0.0)
            print(f"[guard] screened agent={agent} channel={ch} post={pid} ms={int((time.time() - t0) * 1000)} "
                  f"{'BLOCK' if risk else 'pass'} top={top[0]}:{top[1]:.2f} scores={ {k: round(v, 2) for k, v in scores.items()} }", file=sys.stderr, flush=True)
            react(a, pid, "no_entry_sign" if risk else "shield")
            g.update(t_end=time.time_ns(), decision="block" if risk else "pass", risk=risk, score=score,
                     scores={k: round(v, 3) for k, v in scores.items()})
            turn.guard = g
        if risk:
            print(f"[guard] BLOCKED agent={agent} channel={ch} risk={risk} score={score:.2f} "
                  f"scores={ {k: round(v, 2) for k, v in scores.items()} } text={text[:160]!r}", file=sys.stderr, flush=True)
            return GUARD_REPLY.format(risk=risk.replace("_", " ")), turn
    reply, run = drive(agent, a["gw"], a["ns"], text, a.get("skey"))
    turn.run = run
    sf = (((((run or {}).get("meta") or {}).get("result") or {}).get("meta") or {}).get("agentMeta") or {}).get("sessionFile")
    if sf and run.get("pod") and _mlf():
        turn.steps = session_tail(a["ns"], run["pod"], sf)
    return reply, turn


# --- turn traces: OpenShift AI MLflow ------------------------------------------
# One trace per human turn: root span = the turn, children = the guardrail
# decision, the agent run (provider/model/usage from `openclaw agent --json`),
# and inside it one LLM span per model call and one TOOL span per tool call,
# rebuilt from the agent's session log with its own timestamps. Auth is the
# documented RHOAI way: the pod's ServiceAccount token as Bearer plus the
# workspace header on every call (see cluster/mlflow/README.md). Any failure
# here is logged and ignored: tracing never delays or breaks a reply.
MLFLOW_URI = os.environ.get("MLFLOW_URI", "").rstrip("/")
MLFLOW_WORKSPACE = os.environ.get("MLFLOW_WORKSPACE", "agent-office")
MLFLOW_EXPERIMENT = os.environ.get("MLFLOW_EXPERIMENT", "agent-turns")
_MLF = None            # (client, experiment_id) once initialised
_MLF_DEAD = False


def _mlf():
    """Lazy MLflow client; None when unconfigured or broken (retried on the next turn after a failure)."""
    global _MLF, _MLF_DEAD
    if _MLF or not MLFLOW_URI or _MLF_DEAD:
        return _MLF
    try:
        tok = "/var/run/secrets/kubernetes.io/serviceaccount/token"
        if os.path.exists(tok):
            os.environ["MLFLOW_TRACKING_TOKEN"] = open(tok).read().strip()
        ca = "/var/run/secrets/kubernetes.io/serviceaccount/service-ca.crt"
        if MLFLOW_URI.startswith("https") and os.path.exists(ca):
            os.environ.setdefault("MLFLOW_TRACKING_SERVER_CERT_PATH", ca)
        else:
            os.environ.setdefault("MLFLOW_TRACKING_INSECURE_TLS", "true")
        import mlflow
        from mlflow.tracking.request_header.abstract_request_header_provider import RequestHeaderProvider
        from mlflow.tracking.request_header.registry import _request_header_provider_registry

        class _WorkspaceHeader(RequestHeaderProvider):
            def in_context(self):
                return True

            def request_headers(self):
                return {"X-MLFLOW-WORKSPACE": MLFLOW_WORKSPACE}
        _request_header_provider_registry.register(_WorkspaceHeader)
        mlflow.set_tracking_uri(MLFLOW_URI)
        client = mlflow.MlflowClient()
        exp = client.get_experiment_by_name(MLFLOW_EXPERIMENT)
        exp_id = exp.experiment_id if exp else client.create_experiment(MLFLOW_EXPERIMENT)
        _MLF = (client, exp_id)
        print(f"[trace] MLflow ready: {MLFLOW_URI} workspace={MLFLOW_WORKSPACE} experiment={MLFLOW_EXPERIMENT} id={exp_id}", file=sys.stderr, flush=True)
    except Exception as e:
        _MLF_DEAD = True
        print(f"[trace] MLflow disabled: {str(e)[:200]}", file=sys.stderr, flush=True)
    return _MLF


def _ns(ts):
    """ISO-8601 'Z' timestamp or epoch ms -> ns; None on anything odd."""
    try:
        if isinstance(ts, (int, float)):
            return int(ts * 1_000_000)
        from datetime import datetime, timezone
        return int(datetime.strptime(ts, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc).timestamp() * 1e9)
    except Exception:
        return None


def _clip(x, n=600):
    s = x if isinstance(x, str) else json.dumps(x, default=str)
    return s if len(s) <= n else s[:n] + f"... ({len(s)} chars)"


class Turn:
    """Collects what happened during one human turn, then writes the trace in one go after the reply is posted."""

    def __init__(self, agent, a, ch, text, pid):
        self.t0 = time.time_ns()
        self.agent, self.ns, self.ch, self.text, self.pid = agent, a.get("ns"), ch, text, pid
        self.skey = a.get("skey")
        self.gw = a.get("gw")
        self.guard = None          # dict: ms, decision, risk, score, scores, error
        self.run = None            # dict: t_start, t_end, meta (openclaw --json), reply, error
        self.steps = []            # session-log entries of this turn (list of dicts)

    def write(self, reply):
        m = _mlf()
        if not m:
            return
        client, exp_id = m
        try:
            from mlflow.entities import SpanType
            root = client.start_trace(name=f"{self.agent}", span_type=SpanType.AGENT, experiment_id=exp_id,
                                      inputs={"message": self.text},
                                      attributes={"agent": self.agent, "namespace": self.ns, "channel": self.ch,
                                                  "post_id": self.pid, "session_key": self.skey, "gateway": self.gw,
                                                  "surface": "mattermost"},
                                      tags={"agent": self.agent, "namespace": self.ns or "",
                                            "blocked": str(bool(self.guard and self.guard.get("risk"))).lower()},
                                      start_time_ns=self.t0)
            tid = root.trace_id if hasattr(root, "trace_id") else root.request_id
            kw = {"trace_id": tid} if hasattr(root, "trace_id") else {"request_id": tid}
            if self.guard:
                g = self.guard
                s = client.start_span(name="guardrail", parent_id=root.span_id, span_type=SpanType.CHAIN,
                                      inputs={"text": self.text},
                                      attributes={"detector": GUARD_DETECTOR, "blocks": GUARD_BLOCK, "fail_closed": GUARD_FAIL_CLOSED},
                                      start_time_ns=g["t_start"], **kw)
                client.end_span(span_id=s.span_id, end_time_ns=g["t_end"],
                                outputs={"decision": g["decision"], "risk": g.get("risk"), "score": g.get("score"),
                                         "scores": g.get("scores"), "error": g.get("error")},
                                status="ERROR" if g.get("error") else "OK", **kw)
            if self.run:
                r = self.run; meta = r.get("meta") or {}
                am = ((meta.get("result") or {}).get("meta") or {}).get("agentMeta") or {}
                ex = ((meta.get("result") or {}).get("meta") or {}).get("executionTrace") or {}
                usage = am.get("usage") or {}
                attrs = {"provider": am.get("provider"), "model": am.get("model"), "thinking": (((meta.get("result") or {}).get("meta") or {}).get("requestShaping") or {}).get("thinking"),
                         "duration_ms": ((meta.get("result") or {}).get("meta") or {}).get("durationMs"),
                         "usage.input": usage.get("input"), "usage.output": usage.get("output"), "usage.total": usage.get("total"),
                         "stop_reason": (((meta.get("result") or {}).get("meta") or {}).get("completion") or {}).get("stopReason"),
                         "fallback_used": ex.get("fallbackUsed"), "session_id": am.get("sessionId"), "status": meta.get("status")}
                run_span = client.start_span(name="openclaw", parent_id=root.span_id, span_type=SpanType.AGENT,
                                             inputs={"message": self.text}, attributes={k: v for k, v in attrs.items() if v is not None},
                                             start_time_ns=r["t_start"], **kw)
                self._steps(client, kw, run_span.span_id, r["t_start"], r["t_end"], SpanType)
                client.end_span(span_id=run_span.span_id, end_time_ns=r["t_end"], outputs={"reply": _clip(r.get("reply"))},
                                status="ERROR" if r.get("error") else "OK", **kw)
            client.end_trace(outputs={"reply": _clip(reply)}, end_time_ns=time.time_ns(),
                             attributes={"turn_ms": (time.time_ns() - self.t0) // 1_000_000}, **kw)
            print(f"[trace] {self.agent} trace={tid} steps={len(self.steps)}", file=sys.stderr, flush=True)
        except Exception as e:
            print(f"[trace] {self.agent} failed: {type(e).__name__}: {str(e)[:200]}", file=sys.stderr, flush=True)

    def _steps(self, client, kw, parent, t_start, t_end, SpanType):
        """One LLM span per assistant message, one TOOL span per tool call, from the session log."""
        prev = t_start
        pending = {}   # toolCallId -> (span_id, started)
        for e in self.steps:
            m = e.get("message") or {}
            ts = _ns(e.get("timestamp")) or prev
            if ts < t_start - 2_000_000_000 or ts > t_end + 2_000_000_000:
                continue
            role = m.get("role")
            if role == "assistant":
                content = m.get("content") or []
                texts = [p.get("text", "") for p in content if isinstance(p, dict) and p.get("type") == "text"]
                calls = [p for p in content if isinstance(p, dict) and p.get("type") == "toolCall"]
                thinking = sum(1 for p in content if isinstance(p, dict) and p.get("type") == "thinking")
                u = m.get("usage") or {}
                s = client.start_span(name=f"llm:{m.get('model') or '?'}", parent_id=parent, span_type=SpanType.LLM,
                                      attributes={"provider": m.get("provider"), "model": m.get("model"),
                                                  "usage.input": u.get("input"), "usage.output": u.get("output"),
                                                  "usage.cache_read": u.get("cacheRead"), "usage.reasoning": u.get("reasoningTokens"),
                                                  "stop_reason": m.get("stopReason"), "thinking_parts": thinking,
                                                  "tool_calls": [c.get("name") for c in calls]},
                                      start_time_ns=max(prev, t_start), **kw)
                client.end_span(span_id=s.span_id, end_time_ns=ts, outputs={"text": _clip("\n".join(texts)) if texts else None,
                                                                            "tool_calls": [c.get("name") for c in calls]}, **kw)
                for c in calls:
                    ts_ = client.start_span(name=f"tool:{c.get('name')}", parent_id=parent, span_type=SpanType.TOOL,
                                            inputs={"arguments": c.get("arguments")}, attributes={"tool": c.get("name")},
                                            start_time_ns=ts, **kw)
                    pending[c.get("id")] = ts_.span_id
                prev = ts
            elif role == "toolResult":
                sid = pending.pop(m.get("toolCallId"), None)
                out = m.get("content")
                if isinstance(out, list):
                    out = "\n".join(p.get("text", "") for p in out if isinstance(p, dict))
                if sid:
                    client.end_span(span_id=sid, end_time_ns=ts, outputs={"result": _clip(out)},
                                    attributes={"is_error": bool(m.get("isError"))},
                                    status="ERROR" if m.get("isError") else "OK", **kw)
                prev = ts
            elif role == "user":
                prev = ts
        for sid in pending.values():   # a call without a result: close it at the turn's end
            client.end_span(span_id=sid, end_time_ns=t_end, status="ERROR", **kw)


def session_tail(ns, pod, path, lines=400):
    """Last entries of the agent's session log (JSON per line); [] on any problem."""
    out = oc("exec", "-n", ns, pod, "-c", "openclaw", "--", "tail", "-n", str(lines), path)
    entries = []
    for line in out.splitlines():
        try:
            entries.append(json.loads(line))
        except Exception:
            pass
    return entries


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


def aw_gateway(agent, ns):
    gw = oc("get", "agentworkstation", agent, "-n", ns,
            "-o", "jsonpath={.spec.runtime.shared.gatewayRef}")
    return gw or None


def bridged_namespaces():
    """GW_NS plus every namespace carrying SEAT_NS_LABEL (dynamic seats).
    A failed label read degrades to the static list — never to nothing."""
    names = list(GW_NAMESPACES)
    out = oc("get", "namespaces", "-l", SEAT_NS_LABEL, "-o", "json") if SEAT_NS_LABEL else ""
    if out:
        try:
            for i in json.loads(out).get("items", []):
                n = i["metadata"]["name"]
                if n not in names:
                    names.append(n)
        except Exception:
            pass
    return names


def list_aws():
    """{name: (displayName, namespace)} for every AgentWorkstation across all
    bridged namespaces, or None when EVERY namespace read fails (so we never
    tear down on a transient failure)."""
    result = {}
    any_ok = False
    for ns in bridged_namespaces():
        out = oc("get", "agentworkstations", "-n", ns, "-o", "json")
        if not out:
            continue
        try:
            items = json.loads(out).get("items", [])
        except Exception:
            continue
        any_ok = True
        for i in items:
            result[i["metadata"]["name"]] = (
                (i.get("spec", {}).get("displayName") or i["metadata"]["name"]), ns,
                int((i.get("status") or {}).get("sessionEpoch") or 0))
    return result if any_ok else None



def mm_slug(name):
    """Mattermost handle (username + channel name) for an agent. Mattermost caps
    usernames at 22 chars, so longer names are shortened to "<first 13>-<sha256[:8]>".
    MUST stay byte-for-byte identical to mmSlug() in the operator
    (agentworkstation_mattermost.go) + slug() in the beats."""
    if len(name) <= 22:
        return name
    h = hashlib.sha256(name.encode()).hexdigest()[:8]
    return name[:13].rstrip("-._") + "-" + h


BOT_TOKENS = {}  # bot user id -> personal access token (one per bridge life)


def bot_token(uid):
    """The bot's access token, minted ONCE per bridge life. Rediscovery rebuilds every
    agent record every REDISCOVER seconds; minting there left each agent user with a
    new token per minute, forever (10,000+ per agent on the reference cluster, found
    2026-10-13). The pile earlier bridge lives left behind is revoked in the background,
    page by page, so a long-lived bot never blocks the bridge's first discovery."""
    tok = BOT_TOKENS.get(uid)
    if tok:
        return tok
    _, new = api("POST", f"/api/v4/users/{uid}/tokens", {"description": "bridge"})
    tok = (new or {}).get("token", "")
    if not tok:
        return ""
    BOT_TOKENS[uid] = tok
    keep = (new or {}).get("id")

    def sweep():
        revoked = 0
        while True:
            st, old = api("GET", f"/api/v4/users/{uid}/tokens?page=0&per_page=200")
            stale = [t for t in (old or []) if st == 200
                     and t.get("description") == "bridge" and t.get("id") != keep]
            if not stale:
                break
            for t in stale:
                api("POST", "/api/v4/users/tokens/revoke", {"token_id": t["id"]})
                revoked += 1
        if revoked:
            print(f"[bridge] revoked {revoked} stale bridge token(s) for {uid}", file=sys.stderr, flush=True)

    threading.Thread(target=sweep, daemon=True).start()
    return tok


def ensure_presence(agent, display, ns, team_id, admin_id):
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
    tok = {"token": bot_token(uid)}
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
            "gw": aw_gateway(agent, ns), "ns": ns, "channels": chans,
            # skey: explicit openclaw session key. None = the agent's main
            # session. "/new" in chat mints a fresh key — a deterministic
            # history reset (identity edits apply instantly; transcript
            # momentum does not survive a new session). Not persisted: a
            # bridge restart returns the agent to its main session.
            "skey": None,
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


def gw_pod(gw, ns):
    return oc("get", "pods", "-n", ns, "-l", f"agentoffice.ai/gateway={gw}",
              "--field-selector=status.phase=Running",
              "-o", "jsonpath={.items[0].metadata.name}") or None


def drive(agent, gw, ns, text, skey=None):
    """Run one agent turn on its gateway. Returns (reply_text, run) where run carries the
    openclaw --json result (provider, model, usage, session file) for the trace."""
    run = {"t_start": time.time_ns(), "pod": None, "meta": None, "reply": None, "error": None}
    pod = gw_pod(gw, ns)
    run["pod"] = pod
    if not pod:
        run.update(t_end=time.time_ns(), error="gateway unavailable")
        return "(my gateway is unavailable right now)", run
    cmd = ["oc", "exec", "-n", ns, pod, "-c", "openclaw", "--",
           "openclaw", "agent", "--agent", agent, "--message", text, "--timeout", "1200", "--json"]
    if skey:
        cmd[cmd.index("--message"):cmd.index("--message")] = ["--session-key", skey]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=1260)
    except subprocess.TimeoutExpired:
        run.update(t_end=time.time_ns(), error="timeout")
        return "(I took too long thinking — try again?)", run
    run["t_end"] = time.time_ns()
    raw = ANSI.sub("", out.stdout).strip()
    reply, meta = raw, None
    try:
        # the JSON object is the last thing on stdout; anything before it is chatter
        meta = json.loads(raw[raw.index("{"):]) if "{" in raw else None
    except Exception:
        meta = None
    if isinstance(meta, dict):
        run["meta"] = meta
        payloads = ((meta.get("result") or {}).get("payloads") or [])
        reply = "\n\n".join(p.get("text", "") for p in payloads if isinstance(p, dict) and p.get("text")).strip()
        if not reply and meta.get("status") not in (None, "ok"):
            run["error"] = meta.get("summary") or meta.get("status")
            reply = f"({meta.get('summary') or 'the agent run failed'})"
    if out.returncode != 0 and not reply:
        # The exec itself failed: the gateway pod is restarting (a brain
        # swap rolls it twice: once for the key, once for the provider
        # block) or is not ready yet. Say so instead of "(no reply)".
        err = (out.stderr or "").strip()
        print(f"[bridge] {agent} exec failed rc={out.returncode}: {err[:160]}", file=sys.stderr, flush=True)
        run["error"] = f"exec rc={out.returncode}"
        return "(my gateway is restarting — give it a minute and ask again)", run
    run["reply"] = reply or "(no reply)"
    return reply or "(no reply)", run


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
    for agent, (display, ns, epoch) in aws.items():
        if agent in FAILED:
            continue
        rec = ensure_presence(agent, display, ns, team_id, admin_id)
        if rec:
            rec["epoch"] = epoch
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
    print(f"[bridge] up. team={TEAM_NAME} ns={GW_NAMESPACES}", file=sys.stderr, flush=True)

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
                for name, rec in new.items():
                    old = agents.get(name)
                    if not old:
                        continue
                    # Rediscovery rebuilds every record; the session key must
                    # outlive it or a `new session` silently expires within
                    # REDISCOVER seconds (it did, until 2026-09-02).
                    rec["skey"] = old.get("skey")
                    # The OPERATOR bumps status.sessionEpoch when it delivers a
                    # different skill set (skills load at session start). A new
                    # epoch is a fresh session; the operator posts the notice.
                    if rec.get("epoch", 0) != old.get("epoch", 0) and rec["ns"].endswith("-agent-workspace"):
                        rec["skey"] = f"agent:{name}:mm-e{rec['epoch']}"
                        print(f"[bridge] {name}: session epoch {old.get('epoch', 0)} -> {rec['epoch']}; fresh session", file=sys.stderr, flush=True)
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
                    # Platform notices (operator: "Governed tools changed", "Skills
                    # changed") carry this prop; they are for the attendee, not a
                    # message to the agent.
                    if (p.get("props") or {}).get("agentoffice.ai/notice"):
                        continue
                    text = (p.get("message") or "").strip()
                    if not text:
                        continue
                    print(f"[bridge] {agent} <- {text!r}", file=sys.stderr, flush=True)
                    # /new is a WORKSHOP affordance: only agents living in a
                    # per-seat workspace honor it. Long-lived production agents
                    # (newsdesks, ops) ignore it — their main session is their
                    # memory and nothing in chat may fork it.
                    # Slash-free variants exist because Mattermost's composer
                    # intercepts any leading "/" as its own slash command
                    # ("Command with a trigger of 'new' not found") and never
                    # posts it — attendees type `new session` instead.
                    if (text.strip().lower() in ("/new", "/new session", "/reset",
                                                 "new session", "reset session")
                            and a["ns"].endswith("-agent-workspace")):
                        a["skey"] = f"agent:{agent}:mm-{int(time.time())}"
                        api("POST", "/api/v4/posts", {"channel_id": ch,
                            "message": "🔄 Fresh session — conversation history cleared. The current directive applies from the first word."}, token=a["token"])
                        continue
                    # show "…is typing" while the agent thinks. Re-prime the
                    # per-bot WS if adoption raced provisioning (fresh hires:
                    # the first token mint can land before the operator's
                    # user-reactivation settles, leaving ws=None for the
                    # first record — without this, the FIRST turn after a
                    # hire runs with no indicator and no retry).
                    if not a.get("ws"):
                        a["ws"] = get_ws(agent, a.get("token", ""))
                    reply, turn = with_typing(a.get("ws"), ch, lambda: guarded_drive(agent, a, ch, text, p.get("id")))
                    print(f"[bridge] {agent} -> {reply[:80]!r}", file=sys.stderr, flush=True)
                    api("POST", "/api/v4/posts", {"channel_id": ch, "message": reply}, token=a["token"])
                    # the trace is written after the reply is posted, so tracing never delays chat
                    threading.Thread(target=turn.write, args=(reply,), daemon=True).start()
        time.sleep(POLL)


if __name__ == "__main__":
    main()
