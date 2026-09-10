# seat-triage-mcp — governed read-only seat inspection for the help desk agent.
# UBI9 Python (runs as non-root uid 1001, OpenShift-friendly).
FROM registry.access.redhat.com/ubi9/python-311:latest

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .

# The cluster's OWN oc (never an external CLI image): the in-cluster build
# fetches it from the console's downloads service. /opt/app-root/bin is on
# PATH for uid 1001 and writable at build time.
ARG OC_DOWNLOAD=http://downloads.openshift-console.svc/amd64/linux/oc.tar
RUN curl -sSL "$OC_DOWNLOAD" | tar -x -C /opt/app-root/bin && /opt/app-root/bin/oc version --client

# Streamable-HTTP MCP transport; the Kuadrant gateway proxies /mcp here.
EXPOSE 8080
CMD ["python", "server.py"]
