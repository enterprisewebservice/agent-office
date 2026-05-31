# projectboard-mcp — governed Projects-v2 create/delete MCP server.
# UBI9 Python (runs as non-root uid 1001, OpenShift-friendly).
FROM registry.access.redhat.com/ubi9/python-311:latest

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .

# Streamable-HTTP MCP transport; the Kuadrant gateway proxies /mcp here.
EXPOSE 8080
CMD ["python", "server.py"]
