"""
seat-triage-mcp — governed, read-only tools that let the Hands-On Mode help
desk agent look at ONE attendee's workshop seat: what exists, what they have
done module by module, and what looks wrong.

Registered on the platform's Kuadrant MCP gateway like every other tool
server (HTTPRoute + MCPServerRegistration, prefix `seat_`). The agent never
holds a cluster credential: this server runs as its own ServiceAccount with
cluster-wide READ on the resource kinds a seat is made of, and refuses any
handle that is not a seat in the hub's factory-seats ConfigMap.

Secrets never leave: every value that looks like a token is redacted before
it is returned, and no tool reads Secret objects at all.
"""
import datetime as dt
import json
import os
import re
import ssl
import urllib.error
import urllib.parse
import urllib.request

import requests
from mcp.server.fastmcp import FastMCP

PORT = int(os.environ.get("PORT", "8080"))
HUB_NS = os.environ.get("HUB_NS", "factory-hub")
SEATS_CM = os.environ.get("SEATS_CM", "factory-seats")
APPS = os.environ.get("APPS_DOMAIN", "apps.salamander.aimlworkbench.com")
GITEA = os.environ.get("GITEA_URL", f"https://gitea-gitea.{APPS}")
GUIDE_RAW = os.environ.get(
    "GUIDE_RAW",
    "https://raw.githubusercontent.com/enterprisewebservice/showroom-openshift-software-factory/main/content/modules/ROOT/pages/",
)
ARGO_NS = os.environ.get("ARGO_NS", "openshift-gitops")
K8S = "https://kubernetes.default.svc"
SA_DIR = "/var/run/secrets/kubernetes.io/serviceaccount"

mcp = FastMCP("seat-triage", host="0.0.0.0", port=PORT)

# ----------------------------------------------------------------- helpers
_ctx = None
_tok = None


def _k8s(path, ok=(200,)):
    global _ctx, _tok
    if _ctx is None:
        _ctx = ssl.create_default_context(cafile=f"{SA_DIR}/ca.crt")
        _tok = open(f"{SA_DIR}/token").read().strip()
    req = urllib.request.Request(K8S + path)
    req.add_header("Authorization", "Bearer " + _tok)
    req.add_header("Accept", "application/json")
    try:
        with urllib.request.urlopen(req, context=_ctx, timeout=20) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw and r.headers.get("Content-Type", "").startswith("application/json") else raw.decode(errors="replace"))
    except urllib.error.HTTPError as e:
        return e.code, {}
    except Exception as e:  # network / timeout
        return 0, {"error": str(e)}


def _items(path):
    code, body = _k8s(path)
    return (body.get("items") or []) if code == 200 and isinstance(body, dict) else []


REDACT = [
    (re.compile(r"(?i)(bearer\s+)[A-Za-z0-9._\-]{12,}"), r"\1***"),
    (re.compile(r"\b(sk|ghs|ghp|gho|ghu|glpat|xox[abp])[-_][A-Za-z0-9._\-]{8,}"), "***"),
    (re.compile(r"\beyJ[A-Za-z0-9._\-]{20,}"), "***"),
    (re.compile(r"(?i)(token|secret|password|api[-_]?key)([\"':=\s]+)[^\s\"',;]{8,}"), r"\1\2***"),
]


def redact(text):
    if not isinstance(text, str):
        text = json.dumps(text)
    for rx, rep in REDACT:
        text = rx.sub(rep, text)
    return text


def _seat(handle):
    """The seat record for a handle, or raise. Handles are DNS-safe, so anything
    else is refused before it reaches an API path."""
    if not re.fullmatch(r"[a-z][a-z0-9-]{0,30}", handle or ""):
        raise ValueError("handle must be a seat handle like 'dpeterson'")
    code, cm = _k8s(f"/api/v1/namespaces/{HUB_NS}/configmaps/{SEATS_CM}")
    raw = ((cm.get("data") or {}) if code == 200 else {}).get(handle)
    if not raw:
        raise ValueError(f"'{handle}' is not a seat on this hub")
    rec = json.loads(raw)
    rec["handle"] = handle
    rec["workspace"] = f"{handle}-agent-workspace"
    rec["showroom"] = f"showroom-{handle}"
    return rec


def _cond(obj, typ="Ready"):
    for c in (obj.get("status") or {}).get("conditions") or []:
        if c.get("type") == typ:
            return {"status": c.get("status"), "reason": c.get("reason"), "message": (c.get("message") or "")[:300]}
    return None


def _age(ts):
    try:
        t = dt.datetime.fromisoformat(ts.replace("Z", "+00:00"))
        m = int((dt.datetime.now(dt.timezone.utc) - t).total_seconds() // 60)
        return f"{m}m ago" if m < 120 else f"{m // 60}h ago"
    except Exception:
        return ts


def _gitea(path):
    try:
        r = requests.get(f"{GITEA}/api/v1{path}", timeout=15)
        if r.status_code != 200:
            return None
        return r.json()
    except Exception:
        return None


# ------------------------------------------------------------------- tools
@mcp.tool()
def seat_overview(handle: str) -> dict:
    """Everything the platform knows about one attendee's seat: the seat record,
    namespaces, agent workstations and gateways, skills, governed tool
    registrations, pods, pipeline runs, GitOps applications and recent warning
    events. Call this first; `handle` is the attendee's seat handle."""
    try:
        rec = _seat(handle)
    except ValueError as e:
        return {"error": str(e)}
    ws, sr = rec["workspace"], rec["showroom"]
    out = {"seat": {k: rec.get(k) for k in ("handle", "username", "phase", "brand", "ready", "last_reset", "step", "detail")},
           "namespaces": {}}
    for ns in (ws, sr):
        code, _ = _k8s(f"/api/v1/namespaces/{ns}")
        out["namespaces"][ns] = "present" if code == 200 else f"missing ({code})"

    aws = []
    for a in _items(f"/apis/agentoffice.ai/v1alpha1/namespaces/{ws}/agentworkstations"):
        sp, st = a.get("spec", {}), a.get("status", {})
        aws.append({
            "name": a["metadata"]["name"], "role": sp.get("role"), "phase": st.get("phase"), "message": (st.get("message") or "")[:300],
            "model": sp.get("model"), "gateway": ((sp.get("runtime") or {}).get("shared") or {}).get("gatewayRef"),
            "skillRefs": [s.get("name") for s in sp.get("skillRefs") or []],
            "systemPromptTail": (sp.get("systemPrompt") or "")[-240:],
            "skillRefsResolved": _cond(a, "SkillRefsResolved"), "ready": _cond(a, "Ready"),
            "createdAgo": _age(a["metadata"].get("creationTimestamp", "")),
        })
    out["agentworkstations"] = aws
    out["agentgateways"] = [{"name": g["metadata"]["name"], "phase": (g.get("status") or {}).get("phase"),
                             "agents": (g.get("status") or {}).get("agentCount"), "message": ((g.get("status") or {}).get("message") or "")[:200]}
                            for g in _items(f"/apis/agentoffice.ai/v1alpha1/namespaces/{ws}/agentgateways")]
    out["skills"] = [{"name": s["metadata"]["name"], "version": (s.get("spec") or {}).get("version"),
                      "ready": _cond(s, "Ready") or (s.get("status") or {}).get("phase")}
                     for s in _items(f"/apis/agentoffice.ai/v1alpha1/namespaces/{ws}/skills")]
    out["mcpRegistrations"] = [{"name": r["metadata"]["name"], "prefix": (r.get("spec") or {}).get("prefix"),
                                "ready": _cond(r, "Ready"), "tools": (r.get("status") or {}).get("discoveredTools")}
                               for r in _items(f"/apis/mcp.kuadrant.io/v1alpha1/namespaces/{ws}/mcpserverregistrations")]
    pods = []
    for p in _items(f"/api/v1/namespaces/{ws}/pods"):
        cs = (p.get("status") or {}).get("containerStatuses") or []
        waiting = [c.get("state", {}).get("waiting", {}).get("reason") for c in cs if c.get("state", {}).get("waiting")]
        pods.append({"name": p["metadata"]["name"], "phase": (p.get("status") or {}).get("phase"),
                     "ready": f"{sum(1 for c in cs if c.get('ready'))}/{len(cs)}",
                     "restarts": sum(c.get("restartCount", 0) for c in cs), "waiting": [w for w in waiting if w],
                     "ago": _age(p["metadata"].get("creationTimestamp", ""))})
    out["pods"] = pods
    out["deployments"] = [{"name": d["metadata"]["name"], "ready": f"{(d.get('status') or {}).get('readyReplicas', 0)}/{(d.get('spec') or {}).get('replicas', 0)}"}
                          for d in _items(f"/apis/apps/v1/namespaces/{ws}/deployments")]
    prs = []
    for pr in _items(f"/apis/tekton.dev/v1/namespaces/{ws}/pipelineruns"):
        c = _cond(pr, "Succeeded") or {}
        lbl = pr["metadata"].get("labels") or {}
        prs.append({"name": pr["metadata"]["name"], "status": c.get("status"), "reason": c.get("reason"), "message": c.get("message"),
                    "fromPaC": bool(lbl.get("pipelinesascode.tekton.dev/repository")), "repo": lbl.get("pipelinesascode.tekton.dev/url-repository"),
                    "ago": _age(pr["metadata"].get("creationTimestamp", ""))})
    out["pipelineRuns"] = sorted(prs, key=lambda x: x["name"])[-12:]
    out["pacRepositories"] = [{"name": r["metadata"]["name"], "url": (r.get("spec") or {}).get("url")}
                              for r in _items(f"/apis/pipelinesascode.tekton.dev/v1alpha1/namespaces/{ws}/repositories")]
    out["gitopsApplications"] = [{"name": a["metadata"]["name"], "sync": ((a.get("status") or {}).get("sync") or {}).get("status"),
                                  "health": ((a.get("status") or {}).get("health") or {}).get("status"),
                                  "repo": (a.get("spec") or {}).get("source", {}).get("repoURL"),
                                  "error": "; ".join((c.get("message") or "")[:160] for c in ((a.get("status") or {}).get("conditions") or []))}
                                 for a in _items(f"/apis/argoproj.io/v1alpha1/namespaces/{ARGO_NS}/applications")
                                 if ((a.get("spec") or {}).get("destination") or {}).get("namespace") == ws]
    out["warnings"] = seat_events(handle, 90).get("events", [])[:15]
    out["links"] = {"workshop": f"https://showroom-{handle}-showroom-{handle}.{APPS}/", "gitea_org": f"{GITEA}/{handle}-agents"}
    return json.loads(redact(out))


@mcp.tool()
def seat_events(handle: str, minutes: int = 60) -> dict:
    """Warning events in the attendee's workspace namespace from the last N
    minutes (image pulls, scheduling, crash loops, quota, RBAC)."""
    try:
        rec = _seat(handle)
    except ValueError as e:
        return {"error": str(e)}
    since = dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=max(5, min(minutes, 1440)))
    evs = []
    for e in _items(f"/api/v1/namespaces/{rec['workspace']}/events?fieldSelector=type%3DWarning"):
        ts = e.get("lastTimestamp") or e.get("eventTime") or (e.get("series") or {}).get("lastObservedTime") or e["metadata"].get("creationTimestamp", "")
        try:
            if dt.datetime.fromisoformat(ts.replace("Z", "+00:00")) < since:
                continue
        except Exception:
            pass
        io = e.get("involvedObject") or {}
        evs.append({"ago": _age(ts), "object": f"{io.get('kind')}/{io.get('name')}", "reason": e.get("reason"),
                    "message": (e.get("message") or "")[:240], "count": e.get("count")})
    evs.sort(key=lambda x: x["ago"])
    return json.loads(redact({"namespace": rec["workspace"], "minutes": minutes, "events": evs[:40]}))


@mcp.tool()
def seat_logs(handle: str, target: str = "assistant", lines: int = 120) -> dict:
    """Tail of a log from the attendee's seat, secrets redacted. `target` is a
    substring of a pod name (default 'assistant' = the assistant's gateway pod),
    or 'pipelinerun:<name>' for the failed step of a pipeline run."""
    try:
        rec = _seat(handle)
    except ValueError as e:
        return {"error": str(e)}
    ws = rec["workspace"]
    lines = max(20, min(int(lines or 120), 400))
    if target.startswith("pipelinerun:"):
        name = target.split(":", 1)[1]
        code, pr = _k8s(f"/apis/tekton.dev/v1/namespaces/{ws}/pipelineruns/{urllib.parse.quote(name)}")
        if code != 200:
            return {"error": f"no pipelinerun {name} in {ws}"}
        out = {"pipelineRun": name, "condition": _cond(pr, "Succeeded"), "tasks": []}
        for ch in (pr.get("status") or {}).get("childReferences") or []:
            c2, tr = _k8s(f"/apis/tekton.dev/v1/namespaces/{ws}/taskruns/{ch.get('name')}")
            if c2 != 200:
                continue
            cond = _cond(tr, "Succeeded") or {}
            entry = {"task": ch.get("pipelineTaskName"), "status": cond.get("status"), "reason": cond.get("reason"), "message": cond.get("message")}
            if cond.get("status") == "False":
                pod = (tr.get("status") or {}).get("podName")
                failed = [s for s in (tr.get("status") or {}).get("steps") or [] if (s.get("terminated") or {}).get("exitCode", 0) != 0]
                if pod and failed:
                    cont = failed[0].get("container") or f"step-{failed[0].get('name')}"
                    c3, log = _k8s(f"/api/v1/namespaces/{ws}/pods/{pod}/log?container={cont}&tailLines={lines}")
                    entry["failedStep"] = failed[0].get("name")
                    entry["log"] = redact(log if isinstance(log, str) else json.dumps(log))[-8000:]
            out["tasks"].append(entry)
        return out
    pods = [p for p in _items(f"/api/v1/namespaces/{ws}/pods") if target in p["metadata"]["name"]]
    if not pods:
        return {"error": f"no pod matching '{target}' in {ws}", "pods": [p["metadata"]["name"] for p in _items(f'/api/v1/namespaces/{ws}/pods')]}
    p = pods[0]
    names = [c["name"] for c in p["spec"].get("containers", [])]
    cont = "openclaw" if "openclaw" in names else names[0]
    code, log = _k8s(f"/api/v1/namespaces/{ws}/pods/{p['metadata']['name']}/log?container={cont}&tailLines={lines}")
    if code != 200:
        return {"error": f"log read failed ({code})", "pod": p["metadata"]["name"], "container": cont}
    return {"pod": p["metadata"]["name"], "container": cont, "tail": redact(log if isinstance(log, str) else json.dumps(log))[-12000:]}


@mcp.tool()
def seat_gitea(handle: str, repo: str = "", what: str = "repos") -> dict:
    """The attendee's own Git org (Gitea) — `what` is 'repos' (the org's
    repositories), or for a given `repo`: 'commits' (last 15), 'prs' (pull
    requests), or 'workstation' (the base/agentworkstation.yaml on main)."""
    try:
        rec = _seat(handle)
    except ValueError as e:
        return {"error": str(e)}
    org = f"{handle}-agents"
    if what == "repos" or not repo:
        repos = _gitea(f"/orgs/{org}/repos") or []
        return {"org": org, "repos": [{"name": r["name"], "updated": r.get("updated_at"), "url": r.get("html_url")} for r in repos]}
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,64}", repo):
        return {"error": "bad repo name"}
    if what == "commits":
        cs = _gitea(f"/repos/{org}/{repo}/commits?limit=15") or []
        return {"repo": f"{org}/{repo}", "commits": [{"sha": c["sha"][:8], "when": (c.get("commit") or {}).get("author", {}).get("date"),
                                                      "message": ((c.get("commit") or {}).get("message") or "")[:160].strip()} for c in cs]}
    if what == "prs":
        prs = _gitea(f"/repos/{org}/{repo}/pulls?state=all&limit=15") or []
        return {"repo": f"{org}/{repo}", "pulls": [{"number": p["number"], "title": p.get("title"), "state": p.get("state"), "merged": bool(p.get("merged")),
                                                     "head": (p.get("head") or {}).get("ref"), "updated": p.get("updated_at")} for p in prs]}
    if what == "workstation":
        f = _gitea(f"/repos/{org}/{repo}/contents/base/agentworkstation.yaml?ref=main")
        if not f:
            return {"error": "no base/agentworkstation.yaml on main"}
        import base64
        txt = base64.b64decode(f.get("content") or "").decode(errors="replace")
        return {"repo": f"{org}/{repo}", "path": "base/agentworkstation.yaml", "content": redact(txt)[:8000]}
    return {"error": "what must be repos | commits | prs | workstation"}


MODULE_FILES = {
    1: "03-module-01-hire-an-agent.adoc", 2: "04-module-02-the-agent-is-in-git.adoc", 3: "05-module-03-governed-tools.adoc",
    4: "06-module-04-teach-with-a-skill-artifact.adoc", 5: "07-module-05-headless-agent-in-the-pipeline.adoc",
    6: "08-module-06-ship-to-production.adoc", 7: "09-module-07-swap-the-brain.adoc", 8: "10-module-08-the-gap-map.adoc",
}


@mcp.tool()
def workshop_guide(module: int, find: str = "") -> dict:
    """The workshop guide text for a module (1-8), so you can compare what the
    attendee was told to do with what their seat shows. Optional `find`: return
    only the paragraphs containing that phrase."""
    if module not in MODULE_FILES:
        return {"error": "module must be 1..8"}
    try:
        r = requests.get(GUIDE_RAW + MODULE_FILES[module], timeout=20)
        if r.status_code != 200:
            return {"error": f"guide fetch {r.status_code}"}
    except Exception as e:
        return {"error": str(e)}
    text = r.text
    text = re.sub(r"\{user\}", "<their-handle>", text)
    if find:
        paras = [p for p in re.split(r"\n\s*\n", text) if find.lower() in p.lower()]
        return {"module": module, "find": find, "matches": len(paras), "text": "\n\n".join(paras)[:14000]}
    return {"module": module, "text": text[:16000], "truncated": len(text) > 16000}


@mcp.tool()
def seat_progress(handle: str) -> dict:
    """What the attendee has done in the workshop, module by module, judged from
    their seat (workstations, git commits, skills, pipeline runs, tools), with the
    mistakes those observations usually mean. Use it to answer 'where are they
    and what went wrong' before asking them to describe anything."""
    ov = seat_overview(handle)
    if "error" in ov:
        return ov
    aws = ov["agentworkstations"]
    assistant = next((a for a in aws if a["name"].endswith("-assistant") or a.get("role") in ("assistant", None)), aws[0] if aws else None)
    dev = next((a for a in aws if a is not assistant), None)
    org_repos = seat_gitea(handle).get("repos", [])
    gitops = [r["name"] for r in org_repos if r["name"].endswith("-agent-gitops")]
    services = [r["name"] for r in org_repos if not r["name"].endswith("-agent-gitops")]
    m = {}

    def mod(n, status, evidence, mistakes=None):
        m[f"module {n}"] = {"status": status, "evidence": evidence, "suspected_mistakes": mistakes or []}

    # 1 hire
    if not aws:
        mod(1, "not started", ["no AgentWorkstation in the workspace namespace"] + ([f"gitops repo(s) exist: {gitops}" ] if gitops else []),
            ["repo published but no Application yet: GitOps sync takes ~1 min after the template finishes"] if gitops else [])
    elif assistant and assistant["phase"] == "Running":
        mod(1, "done", [f"{assistant['name']} Running on gateway {assistant['gateway']}"])
    else:
        mod(1, "looks wrong", [f"{assistant['name']} phase={assistant['phase']} {assistant['message']}"] + [f"pod {p['name']} {p['phase']} waiting={p['waiting']}" for p in ov["pods"] if p["waiting"]],
            ["ImagePullBackOff → quay-pull-secret missing in the seat", "Pending with no pod → gateway not scheduled; check events", "SCC forbidden → seat-policy RoleBinding missing"])
    # 2 in git
    commits = seat_gitea(handle, gitops[0], "commits").get("commits", []) if gitops else []
    msgs = [c["message"].lower() for c in commits]
    tail = (assistant or {}).get("systemPromptTail", "").lower()
    if not gitops:
        mod(2, "not started", ["no gitops repository yet"])
    elif "three bullet" in tail or "3 bullet" in tail:
        mod(2, "in progress", ["the workstation prompt still ends with the three-bullet rule"], ["the revert step was not merged, or GitOps has not synced it yet"])
    elif any("bullet" in x or "revert" in x for x in msgs):
        mod(2, "done", [f"commits: {[c['message'][:60] for c in commits[:4]]}"])
    else:
        mod(2, "not started" if len(commits) <= 1 else "in progress", [f"{len(commits)} commit(s) on {gitops[0]}"])
    # 3 governed tools (chat-side; only the substrate is observable)
    gw_pods = [p for p in ov["pods"] if "gateway" in p["name"]]
    mod(3, "not observable from the platform", [f"gateway pods: {[(p['name'], p['phase'], p['ready']) for p in gw_pods]}"],
        ["'no reply' from the assistant: the brain warms up slowly, ask again after ~1 min",
         "the assistant says it cannot see a tool: run `openclaw mcp reload` happens automatically after a registration changes — wait a minute, then 'new session'"])
    # 4 skill artifact
    skills = [s["name"] for s in ov["skills"]]
    refs = (assistant or {}).get("skillRefs", [])
    if "platform-incident-triage" in refs and any(s == "platform-incident-triage" for s in skills):
        res = (assistant or {}).get("skillRefsResolved") or {}
        mod(4, "done" if res.get("status") in ("True", None) else "looks wrong", [f"skillRefs={refs}", f"SkillRefsResolved={res}"],
            [] if res.get("status") in ("True", None) else ["the three hashes do not match: pinned version vs delivered vs registry", "Skill created in the wrong namespace"])
    elif "platform-incident-triage" in skills:
        mod(4, "in progress", ["Skill resource exists but the workstation does not reference it"], ["the skillRefs pull request was not merged (or has a YAML indentation error, so GitOps shows OutOfSync)"])
    else:
        mod(4, "not started", [f"skills in namespace: {skills}"])
    # 5 headless
    headless = [p for p in ov["pipelineRuns"] if not p["fromPaC"]]
    mod(5, "done" if headless else "not started (optional in the video)", [f"non-PaC pipeline runs: {[(p['name'], p['status'], p['reason']) for p in headless]}"])
    # 6 ship to production
    pac = ov["pacRepositories"]
    builds = [p for p in ov["pipelineRuns"] if p["fromPaC"]]
    regs = [r for r in ov["mcpRegistrations"]]
    deployed = [d for d in ov["deployments"] if "gateway" not in d["name"]]
    ev = [f"dev agent: {dev['name'] if dev else 'none'}", f"service repos: {services}", f"PaC repositories: {[r['name'] for r in pac]}",
          f"builds: {[(p['name'], p['status'], p['reason']) for p in builds]}", f"deployments: {deployed}", f"registrations: {[(r['name'], (r['ready'] or {}).get('status'), r['tools']) for r in regs]}"]
    mistakes = []
    if services and not pac:
        mistakes.append("the pull request was merged before the PaC Repository was applied: no pipeline will ever start. Recovery: apply the Repository, then Gitea → the repo → Settings → Webhooks → Recent Deliveries → Redeliver, or push any commit to main")
    if services and pac and not builds:
        mistakes.append("Repository exists but no build ran: the webhook did not fire (redeliver it) or the PR is not merged yet")
    if builds and builds[-1]["status"] == "False":
        mistakes.append(f"last build failed ({builds[-1]['reason']}): read seat_logs target='pipelinerun:{builds[-1]['name']}'; on self-service seats the quota is small, a build that needs more memory is Pending")
    if deployed and not regs:
        mistakes.append("service runs but is not registered as a tool yet: the MCPServerRegistration + HTTPRoute step")
    if regs and any((r["ready"] or {}).get("status") != "True" for r in regs):
        mistakes.append("registration not Ready: the route's backend port/path do not match the service's /mcp, or the tool prefix collides with another seat's")
    status = "done" if (regs and all((r["ready"] or {}).get("status") == "True" for r in regs)) else ("in progress" if (dev or services) else "not started")
    mod(6, status, ev, mistakes)
    # 7 swap the brain
    model = (assistant or {}).get("model") or {}
    swapped = bool(model.get("connectionRef")) or model.get("provider") not in (None, "openai-codex", "openai")
    mod(7, "done" if swapped else "not started", [f"assistant model: {model}"],
        [] if swapped else ["after the merge, wait for the sync then say 'new session'; a 'no reply' right after the swap is the new brain warming up"])
    return json.loads(redact({"handle": handle, "seat": ov["seat"], "modules": m, "warnings": ov["warnings"][:8]}))


OC = os.environ.get("OC_BIN", "/opt/app-root/bin/oc")
OC_READ = {"get", "describe", "logs", "events", "explain", "api-resources", "wait", "top", "auth", "status"}
OC_FIX = {"rollout", "delete", "exec"}
OC_FORBIDDEN_FLAGS = {"-A", "--all-namespaces", "--kubeconfig", "--token", "--server", "--as", "--as-group", "--context", "--cluster", "--user"}


@mcp.tool()
def seat_oc(handle: str, args: str) -> dict:
    """Run one `oc` command inside the attendee's seat, as the help desk's own
    ServiceAccount (namespace admin of every seat, nothing outside). `args` is the
    command line after `oc`, e.g. 'get pods', 'describe agentworkstation <h>-assistant',
    'logs deploy/<h>-assistant-gateway -c openclaw --tail=80',
    'exec deploy/<h>-assistant-gateway -c openclaw -- openclaw mcp reload',
    'rollout restart deploy/<name>', 'delete pod <name>'. The namespace is the seat's
    workspace unless you pass -n showroom-<h>; other namespaces, apply/create/patch/edit/scale
    and cluster-wide flags are refused."""
    import shlex
    import subprocess
    try:
        rec = _seat(handle)
    except ValueError as e:
        return {"error": str(e)}
    try:
        argv = shlex.split(args or "")
    except ValueError as e:
        return {"error": f"cannot parse args: {e}"}
    if not argv:
        return {"error": "empty command"}
    verb = argv[0]
    if verb not in OC_READ | OC_FIX:
        return {"error": f"verb '{verb}' is not allowed here (allowed: {sorted(OC_READ | OC_FIX)})"}
    if any(a in OC_FORBIDDEN_FLAGS or a.startswith(("--kubeconfig", "--token", "--server", "--as", "--context")) for a in argv):
        return {"error": "cluster-wide or identity-changing flags are refused"}
    allowed_ns = {rec["workspace"], rec["showroom"]}
    ns, clean, i = None, [], 0
    while i < len(argv):
        a = argv[i]
        if a in ("-n", "--namespace"):
            ns = argv[i + 1] if i + 1 < len(argv) else None
            i += 2
            continue
        if a.startswith("--namespace="):
            ns = a.split("=", 1)[1]
            i += 1
            continue
        clean.append(a)
        i += 1
    ns = ns or rec["workspace"]
    if ns not in allowed_ns:
        return {"error": f"namespace {ns} is not this seat's (allowed: {sorted(allowed_ns)})"}
    if verb == "delete" and (len(clean) < 2 or clean[1] not in ("pod", "pods", "po")):
        return {"error": "delete is allowed for pods only (their Deployment recreates them)"}
    if verb == "rollout" and (len(clean) < 2 or clean[1] not in ("status", "restart", "history")):
        return {"error": "rollout supports status | restart | history"}
    if verb == "auth" and (len(clean) < 2 or clean[1] != "can-i"):
        return {"error": "auth supports can-i only"}
    cmd = [OC, "-n", ns] + clean
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=90)
    except subprocess.TimeoutExpired:
        return {"error": "timed out after 90s", "command": " ".join(clean)}
    except FileNotFoundError:
        return {"error": f"oc binary not found at {OC}"}
    return {"namespace": ns, "command": "oc -n " + ns + " " + " ".join(clean), "exit": r.returncode,
            "stdout": redact((r.stdout or "")[-12000:]), "stderr": redact((r.stderr or "")[-3000:])}


if __name__ == "__main__":
    mcp.run(transport="streamable-http")
