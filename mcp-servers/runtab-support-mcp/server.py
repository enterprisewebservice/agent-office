"""
runtab-support-mcp — governed, read-only tools that let the Runtab help desk
agent look at ONE Runtab user's state: account and plan, the linked bank
(Plaid item) and its health, recent sync activity, the emails Runtab sent
them, the current release, and product facts.

Registered on the platform's Kuadrant MCP gateway like every other tool
server (HTTPRoute + MCPServerRegistration, prefix `runtab_`). The agent never
holds the backend key: this server carries it (ExternalSecret mirror of the
backend's CCS_API_KEY) and only calls the backend's /internal/support routes,
which never return balances, transactions, card numbers or tokens.
"""
import json
import os
import urllib.error
import urllib.parse
import urllib.request

from mcp.server.fastmcp import FastMCP

PORT = int(os.environ.get("PORT", "8080"))
BACKEND = os.environ.get("RUNTAB_BACKEND_URL", "http://ccs-backend.claude-code-agent.svc.cluster.local:8080")
KEY = os.environ.get("CCS_API_KEY", "")

mcp = FastMCP("runtab-support", host="0.0.0.0", port=PORT)


def _get(path: str, **q) -> dict:
    if not KEY:
        return {"error": "CCS_API_KEY is not configured on the tool server"}
    qs = {k: v for k, v in q.items() if v is not None and v != ""}
    url = BACKEND + path + (("?" + urllib.parse.urlencode(qs)) if qs else "")
    req = urllib.request.Request(url, headers={"X-API-Key": KEY, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return {"error": f"backend HTTP {e.code}", "detail": e.read()[:200].decode(errors="replace")}
    except Exception as e:  # noqa: BLE001
        return {"error": f"backend unreachable: {e}"}


@mcp.tool()
def runtab_account(email: str) -> dict:
    """Account and plan state for ONE Runtab user, identified by the email the
    platform gave you. Says whether an app account exists (they signed in at
    least once), the plan (trial, active, expired, owner), trial days left,
    whether billing is attached, how many banks are linked, their waitlist
    record, and every email Runtab sent them. Call this first."""
    return _get("/internal/support/account", email=email)


@mcp.tool()
def runtab_link(email: str) -> dict:
    """The user's linked bank(s): institution, when it was linked, whether Plaid
    says the login must be redone (needs_reconnect), any Plaid error code with
    its plain message, whether the bank is degraded for the areas a card balance
    uses (bank_outage), whether a credit-card account is present, and when each
    account last synced. Never returns balances, transactions or card numbers."""
    return _get("/internal/support/link", email=email)


@mcp.tool()
def runtab_activity(email: str, days: int = 7) -> dict:
    """Recent sync activity for the user over the last `days` days: transactions
    observed per day and the latest daily snapshot, which shows whether the app
    has been polling successfully. Amounts are never included."""
    return _get("/internal/support/activity", email=email, days=days)


@mcp.tool()
def runtab_release() -> dict:
    """The current Runtab for Mac release served at runtab.io/download: version,
    build date, size, minimum macOS, notarization, and the download URL."""
    return _get("/internal/support/release")


KNOWLEDGE = {
    "install": (
        "Download at https://runtab.io/download (a DMG, free to download; the trial and plan live on the "
        "account, not in the file). Requirements: macOS 14 or later on Apple silicon. Open the DMG, drag "
        "Runtab to Applications, launch it: it lives in the menu bar (no Dock icon). The app is signed "
        "with a Developer ID and notarized by Apple, so Gatekeeper opens it without warnings; if macOS "
        "says the app is damaged or cannot be opened, the download was incomplete: delete it and download again."
    ),
    "signin": (
        "Menu bar icon > Sign In… opens the browser at auth.runtab.io (the account service). New users pick "
        "'Register', enter email + password, then confirm the verification email from hello@runtab.io "
        "(check spam). The browser hands the session back to the app; the menu shows the email when signed in. "
        "'Waiting for browser sign-in…' means the browser step was not finished; 'Session expired' means Sign In again."
    ),
    "link": (
        "After signing in: menu > Link new card… opens Plaid Link in the browser. Pick the bank (Wells Fargo "
        "and most US banks), sign in at the bank, choose the credit card account. Runtab only gets read-only "
        "access through Plaid and never sees bank credentials. The 14-day free trial starts when the first "
        "card is linked. If the item later needs a new login (bank changed password or MFA), the menu shows "
        "'Reconnect bank…'."
    ),
    "bank-issue": (
        "The label 'Runtab · Bank issue' means Plaid reports the bank itself is degraded or down for logins, "
        "transactions or balances, so waiting is the fix, not reconnecting. Until 2026-09-25 the app also "
        "showed it when only an unrelated Plaid area (investments) was degraded, which happened most days "
        "for Wells Fargo; the backend now ignores areas a card balance does not use, no app update needed."
    ),
    "refresh": (
        "The app polls the Runtab backend at the interval set in the menu (default 5 minutes). 'Pull updates "
        "(Plaid cache)' re-reads Plaid's cached data (fast, free); 'Pull fresh from bank' asks Plaid to "
        "re-pull from the bank (slow, rate limited, 30 seconds to 2 minutes). Balances update when the bank "
        "posts transactions, typically within a day."
    ),
    "trial-billing": (
        "14-day free trial from the first linked card, then $5/month or $48/year through Stripe, managed at "
        "https://runtab.io/account (Upgrade… in the menu opens it). When the trial ends the menu says 'Your "
        "free trial has ended'; data is kept, the balance stops updating until a plan is active. Billing "
        "changes and refunds are handled by a person: support@runtab.io."
    ),
    "privacy": (
        "Runtab stores the linked account's masked name and the balance history needed to show the number; "
        "bank credentials never touch Runtab (Plaid handles the bank login). Data deletion requests go to "
        "support@runtab.io. Runtab is operated by Enterprise Web Service LLC (Minnesota)."
    ),
    "contact": "A person (Dean) reads every help desk transcript. Email: support@runtab.io. Replies within about five business days; security matters faster.",
}


@mcp.tool()
def runtab_knowledge(topic: str = "") -> dict:
    """Runtab product facts for the help desk. Topics: install, signin, link,
    bank-issue, refresh, trial-billing, privacy, contact. Empty topic lists them."""
    t = (topic or "").strip().lower()
    if not t:
        return {"topics": sorted(KNOWLEDGE)}
    if t in KNOWLEDGE:
        return {"topic": t, "facts": KNOWLEDGE[t]}
    hits = {k: v for k, v in KNOWLEDGE.items() if t in k or t in v.lower()}
    return {"matches": hits} if hits else {"error": f"no topic matches '{topic}'", "topics": sorted(KNOWLEDGE)}


if __name__ == "__main__":
    mcp.run(transport="streamable-http")
