"""
runtab-support-mcp — governed, read-only tools that let the Runtab help desk
agent look at ONE Runtab user's state: account and plan, the linked bank
(Plaid item) and its health, recent sync activity, the emails Runtab sent
them, the current release, and product facts.

Registered on the platform's Kuadrant MCP gateway like every other tool
server (HTTPRoute + MCPServerRegistration, prefix `runtab_`): the tools are
named account/link/activity/release/knowledge HERE and reach agents as
runtab_account, runtab_link, ... (the registration adds the prefix). The agent never
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
def account(email: str) -> dict:
    """Account and plan state for ONE Runtab user, identified by the email the
    platform gave you. Says whether an app account exists (they signed in at
    least once), the plan (trial, active, expired, owner), trial days left,
    whether billing is attached, how many banks are linked, their waitlist
    record, and every email Runtab sent them. Call this first."""
    return _get("/internal/support/account", email=email)


@mcp.tool()
def link(email: str) -> dict:
    """The user's linked bank(s): institution, when it was linked, whether Plaid
    says the login must be redone (needs_reconnect), any Plaid error code with
    its plain message, whether the bank is degraded for the areas a card balance
    uses (bank_outage), whether a credit-card account is present, and when each
    account last synced. Never returns balances, transactions or card numbers."""
    return _get("/internal/support/link", email=email)


@mcp.tool()
def activity(email: str, days: int = 7) -> dict:
    """Recent sync activity for the user over the last `days` days: transactions
    observed per day and the latest daily snapshot, which shows whether the app
    has been polling successfully. Amounts are never included."""
    return _get("/internal/support/activity", email=email, days=days)


@mcp.tool()
def release() -> dict:
    """The current Runtab for Mac release served at runtab.io/download: version,
    build date, size, minimum macOS, notarization, and the download URL."""
    return _get("/internal/support/release")


KNOWLEDGE = {
    "install": (
        "iPhone: 'Runtab: Credit Card Balance' on the App Store (https://apps.apple.com/app/id6823869078), "
        "iOS 17 or later, free to download; the plans are bought inside the app. Mac: download at "
        "https://runtab.io/download (a DMG, free; the trial and plan live on the account, not in the file). "
        "Requirements: macOS 14 or later on Apple silicon. Open the DMG, drag Runtab to Applications, launch "
        "it: it lives in the menu bar (no Dock icon). It is signed with a Developer ID and notarized by "
        "Apple; if macOS says the app is damaged or cannot be opened, the download was incomplete: delete "
        "it and download again. One Runtab account works on both."
    ),
    "signin": (
        "iPhone: open Runtab > Sign in or create account. Mac: menu bar icon > Sign In… opens the browser. "
        "Both go to auth.runtab.io (the account service). New users pick 'Register', enter email + "
        "password, then confirm the verification email from hello@runtab.io (check spam). The website "
        "(runtab.io/help, runtab.io/account) has its own sign-in with the same email and password. On the "
        "Mac, 'Waiting for browser sign-in…' means the browser step was not finished; 'Session expired' "
        "means Sign In again."
    ),
    "link": (
        "iPhone: Link a card on the home screen, or Settings > Link a card… (Add another card… for the "
        "next one). Mac: menu > Link new card…. Plaid opens: pick the bank (Chase, Wells Fargo and most US "
        "banks), sign in at the bank, choose the credit card account. Runtab only gets read-only access "
        "through Plaid and never sees bank credentials. The 14-day free trial starts when the first card "
        "is linked; more than one card needs a paid plan. If the bank later wants a new login (changed "
        "password or MFA): iPhone Settings > Reconnect bank…, Mac menu > Reconnect bank…."
    ),
    "widgets": (
        "Home Screen: touch and hold an empty spot > Edit > Add Widget > Runtab. Lock Screen: touch and "
        "hold the Lock Screen > Customize > Lock Screen > tap the widget area > Runtab. Widgets show what "
        "the app last loaded; iOS refreshes them on its own schedule, and opening the app refreshes them."
    ),
    "bank-issue": (
        "The label 'Bank issue' (on the Mac, 'Runtab · Bank issue') means Plaid reports the bank itself is "
        "degraded or down for logins, transactions or balances, so waiting is the fix, not reconnecting. "
        "Since 2026-09-25 the backend ignores degraded Plaid areas a card balance does not use (such as "
        "investments), with no app update needed."
    ),
    "refresh": (
        "Banks send Runtab new balances on their own 1 to 4 times a day. iPhone: pull down on the home "
        "screen to reload from Runtab's server (free); Settings > Refresh from bank now asks the bank for "
        "new numbers. Mac: the app checks Runtab's server at the menu's Refresh interval (default 5 "
        "minutes); 'Pull updates (Plaid cache)' is free; 'Pull fresh from bank (slow, metered)' asks the "
        "bank (30 seconds to 2 minutes). Asking the bank uses the plan's allowance: trial and Runtab, 10 a "
        "month; Plus, 3 automatic checks a day at about 8 AM, 1 PM and 6 PM; Pro, 6 a day at about 7:30 "
        "AM, 10 AM, 12:30 PM, 3 PM, 5:30 PM and 8 PM (the user's time zone). On Plus and Pro, Refresh from "
        "bank now uses one of that day's checks."
    ),
    "balance": (
        "Each card shows posted (what the bank has settled) plus pending (the charges the bank lists as "
        "pending), and 'Bank data' with the time the bank last sent numbers. After a payment some banks "
        "(Chase) lower the posted balance at once but hold back the available credit for days; Runtab "
        "does not count that held credit as a pending charge. Runtab never shows a balance the bank has "
        "not sent; if numbers look stale, see refresh."
    ),
    "trial-billing": (
        "14-day free trial with one card, starting when the first card is linked. Then: Runtab $5/month "
        "(the bank's own updates plus 10 refreshes a month), Runtab Plus $15/month (3 automatic checks a "
        "day), Runtab Pro $30/month (6 a day). Every paid plan allows more than one card. There is no "
        "yearly plan. iPhone: App Store subscriptions (Settings > Subscribe…, Get Plus or Pro…, Manage App "
        "Store subscription; cancel in the iPhone's Settings app under Subscriptions); on the App Store, "
        "the $5 plan starts with a 2-week free trial for new subscribers, Plus and Pro start right away. "
        "Web and Mac: billed by Stripe at https://runtab.io/account (the Mac's Upgrade… opens it), managed "
        "and cancelled there. One subscription covers iPhone and Mac. When a trial ends, data is kept and "
        "balances stop updating until a plan is active. Refunds: App Store purchases through Apple "
        "(reportaproblem.apple.com); Stripe billing is handled by a person at support@runtab.io."
    ),
    "privacy": (
        "Runtab stores the linked accounts' masked names and the balance history needed to show the "
        "numbers; bank credentials never touch Runtab (Plaid handles the bank login). iPhone Settings > "
        "Delete account removes the account and its data; deletion requests also go to support@runtab.io. "
        "Runtab is operated by Enterprise Web Service LLC (Minnesota)."
    ),
    "contact": "A person (Dean) reads every help desk transcript. Email: support@runtab.io, or the help desk at https://runtab.io/help. Replies within about five business days; security matters faster.",
}


@mcp.tool()
def knowledge(topic: str = "") -> dict:
    """Runtab product facts for the help desk (iPhone and Mac). Topics: install,
    signin, link, widgets, bank-issue, refresh, balance, trial-billing, privacy,
    contact. Empty topic lists them."""
    t = (topic or "").strip().lower()
    if not t:
        return {"topics": sorted(KNOWLEDGE)}
    if t in KNOWLEDGE:
        return {"topic": t, "facts": KNOWLEDGE[t]}
    hits = {k: v for k, v in KNOWLEDGE.items() if t in k or t in v.lower()}
    return {"matches": hits} if hits else {"error": f"no topic matches '{topic}'", "topics": sorted(KNOWLEDGE)}


if __name__ == "__main__":
    mcp.run(transport="streamable-http")
