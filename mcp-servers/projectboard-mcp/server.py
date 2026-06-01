"""
projectboard-mcp — a tiny governed MCP server that fills the ONE gap in
the upstream github-mcp-server: creating/deleting GitHub Projects v2
("kanban") boards.

The official github-mcp-server (--toolsets=all) exposes only item-level
project tools (github_projects_write: add/update/delete items, status
updates) — it cannot CREATE a board. Projects v2 creation is GraphQL-only
(createProjectV2 / deleteProjectV2), which is exactly the access the
GitHub App already has (proven in the Projects-v2 spike).

So this server exposes two tools — create_project_board /
delete_project_board — over the standard streamable-HTTP MCP transport,
and is registered on the SAME Kuadrant MCP gateway as github-mcp-server
with the SAME ESO-managed App installation token. An agent calls these
like any other governed MCP tool; it never sees a raw credential. The
agent then uses the existing github_projects_* tools to populate + manage
the board it just created.

Auth: the GitHub token is injected as GITHUB_PERSONAL_ACCESS_TOKEN from
the ESO-synced github-mcp-installation-token Secret (same as the
github-mcp-server Deployment). Creating an ORG-owned Projects v2 board
requires the App's organization_projects: write permission.
"""

import os

import requests
from mcp.server.fastmcp import FastMCP

GH_GRAPHQL = "https://api.github.com/graphql"

mcp = FastMCP(
    "projectboard",
    host="0.0.0.0",
    port=int(os.environ.get("PORT", "8080")),
)


def _gql(query: str, variables: dict) -> dict:
    """Run a GraphQL request with the governed App token; raise on errors."""
    token = os.environ.get("GITHUB_PERSONAL_ACCESS_TOKEN", "")
    if not token:
        raise RuntimeError("GITHUB_PERSONAL_ACCESS_TOKEN not set")
    resp = requests.post(
        GH_GRAPHQL,
        json={"query": query, "variables": variables},
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
        },
        timeout=30,
    )
    resp.raise_for_status()
    payload = resp.json()
    if payload.get("errors"):
        raise RuntimeError(f"GraphQL error: {payload['errors']}")
    return payload["data"]


# The board-layout TEMPLATE this server copies for every new board.
#
# WHY a template: GitHub's GraphQL API has NO mutation to create or change
# a project VIEW or its layout — board/table/roadmap views can only be
# authored in the web UI. The ONLY API way to obtain a project that ALREADY
# has a board (kanban) view is copyProjectV2, which copies an existing
# project including its views. So the platform keeps ONE protected template
# project that has a board-layout view, and create_project_board COPIES it.
# This is the same mechanism GitHub's own "project templates" feature uses.
#
# The template is resolved by TITLE (not a brittle hardcoded node id) under
# the SAME owner the board is created for. If it is missing, we fall back to
# a plain createProjectV2 (table view) so board creation never hard-fails.
BOARD_TEMPLATE_TITLE = os.environ.get(
    "BOARD_TEMPLATE_TITLE", "Kanban Template — DO NOT DELETE"
)


def _owner_node_id(owner: str, owner_type: str) -> str:
    """Resolve an org/user login to the node ID the mutations need."""
    if owner_type == "user":
        q = "query($l:String!){ user(login:$l){ id } }"
        return _gql(q, {"l": owner})["user"]["id"]
    q = "query($l:String!){ organization(login:$l){ id } }"
    return _gql(q, {"l": owner})["organization"]["id"]


def _find_board_template(owner: str, owner_type: str) -> str | None:
    """Return the node id of the board-layout template under `owner`, or None.

    Matches BOARD_TEMPLATE_TITLE exactly among the owner's first 100
    projects. Returns None when no such project exists (caller falls back).
    """
    field = "user" if owner_type == "user" else "organization"
    q = (
        "query($l:String!){ %s(login:$l){ "
        "projectsV2(first:100){ nodes{ id title } } } }" % field
    )
    nodes = (_gql(q, {"l": owner})[field]["projectsV2"]["nodes"]) or []
    for n in nodes:
        if n.get("title") == BOARD_TEMPLATE_TITLE:
            return n["id"]
    return None


@mcp.tool()
def create_project_board(owner: str, title: str, owner_type: str = "org") -> dict:
    """Create a new GitHub Projects v2 board (kanban) owned by an org or user.

    The board is created by COPYING the platform's board-layout template
    project ("Kanban Template — DO NOT DELETE") so it opens as a real kanban
    BOARD view with Status columns — not a flat table. (GitHub's API cannot
    author a board view directly; copying a template is the only supported
    path, and is how GitHub's own project-template feature works.) Agents
    move cards across columns with github_projects_write `update_project_item`.

    If the template is missing, this degrades gracefully to a plain board
    (table view) and flags `template_used: false` in the result.

    Args:
        owner: The org or user login that will own the board (e.g. "enterprisewebservice").
        title: Human-readable board title.
        owner_type: "org" (default) or "user".

    Returns:
        {id, number, title, url, template_used} of the created board.
        `number` is what the github_projects_* tools take as `project_number`;
        `id` is the node ID needed to delete it.
    """
    owner_id = _owner_node_id(owner, owner_type)
    template_id = _find_board_template(owner, owner_type)
    if template_id:
        q = (
            "mutation($p:ID!,$o:ID!,$t:String!){"
            " copyProjectV2(input:{projectId:$p,ownerId:$o,title:$t,includeDraftIssues:false}){"
            " projectV2{ id number title url } } }"
        )
        board = _gql(q, {"p": template_id, "o": owner_id, "t": title})[
            "copyProjectV2"
        ]["projectV2"]
        board["template_used"] = True
        return board
    # Fallback: no template found — plain board (table view).
    q = (
        "mutation($o:ID!,$t:String!){"
        " createProjectV2(input:{ownerId:$o,title:$t}){"
        " projectV2{ id number title url } } }"
    )
    board = _gql(q, {"o": owner_id, "t": title})["createProjectV2"]["projectV2"]
    board["template_used"] = False
    return board


@mcp.tool()
def delete_project_board(project_id: str) -> dict:
    """Delete a GitHub Projects v2 board by its node ID.

    Args:
        project_id: The board's node ID (the `id` returned by create_project_board).

    Returns:
        {deleted: <project_id>}.
    """
    q = "mutation($id:ID!){ deleteProjectV2(input:{projectId:$id}){ projectV2{ id } } }"
    _gql(q, {"id": project_id})
    return {"deleted": project_id}


if __name__ == "__main__":
    # Standard streamable-HTTP MCP transport, mounted at /mcp — the same
    # shape the Kuadrant MCP gateway proxies for github-mcp-server.
    mcp.run(transport="streamable-http")

# build: projectboard-mcp v0.0.2 — copy board-layout template (kanban) instead of plain createProjectV2
