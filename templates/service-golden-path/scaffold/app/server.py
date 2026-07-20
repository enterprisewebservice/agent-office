"""__SVC__ — golden-path scaffold stub.

Streamable-HTTP MCP server on :8080 (same shape as projectboard-mcp) plus a REST /healthz.
The developer agent replaces this file with the real implementation per the contract;
transport, port, and /healthz must stay.
"""
import os
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("__SVC__", host="0.0.0.0", port=int(os.environ.get("PORT", "8080")))


@mcp.tool()
def ping() -> str:
    """Liveness tool — proves __SVC__ is reachable through the gateway."""
    return "pong from __SVC__"


if hasattr(mcp, "custom_route"):
    from starlette.responses import JSONResponse

    @mcp.custom_route("/healthz", methods=["GET"])
    async def healthz(_req):
        return JSONResponse({"status": "ok", "service": "__SVC__"})


if __name__ == "__main__":
    mcp.run(transport="streamable-http")
