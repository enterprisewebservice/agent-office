# syntax=docker/dockerfile:1.6
#
# Dockerfile for the agent-office AgentWorkstation Bindings UI
# Backstage frontend plugin.
#
# Build context: this directory (rhdh-plugins/agentworkstation-binders).
# Output: an OCI image that contains the plugin's dist-scalprum bundle
# under /agent-office-backstage-plugin-agentworkstation-binders/.
# RHDH's install-dynamic-plugins.py pulls the image (referenced as
# `oci://<image>!<plugin-name>` in the v1-dynamic-plugins ConfigMap)
# and copies that directory into the dev-hub pod's
# dynamic-plugins-root volume before the developer-hub container
# starts.
#
# Same patterns as codex-reauth-ui / source-filtered-entity-picker:
# - FROM scratch runtime so the install script's first-layer logic
#   sees the plugin tarball (a base layer would push it to layer 1
#   and the install would silently extract zero files).
# - LABEL io.backstage.dynamic-packages with base64-JSON metadata —
#   install-dynamic-plugins.py reads this annotation to discover
#   which plugin paths to extract.

# ---------- builder ----------
FROM registry.access.redhat.com/ubi9/nodejs-20:latest AS builder

USER 0
WORKDIR /workspace

COPY package.json ./
COPY tsconfig.json ./
COPY src ./src
COPY app-config.yaml ./

# --legacy-peer-deps: same reason as the codex-reauth-ui Dockerfile —
# @material-ui/icons@4 declares @types/react ^16||^17 as a peer but
# Backstage 1.45 wants @types/react@18. Runtime is fine.
RUN npm install --no-audit --no-fund --legacy-peer-deps

# Same three-step build as codex-reauth-ui:
#   1. tsc emits .d.ts for backstage-cli
#   2. backstage-cli package build -> dist/ (CJS + ESM)
#   3. janus-cli export-dynamic-plugin -> dist-scalprum/
RUN npx tsc
RUN npx backstage-cli package build
RUN npx janus-cli package export-dynamic-plugin --in-place --no-embed-as-dependencies

# Assemble what RHDH's install-dynamic-plugins.py extracts:
#   - package.json
#   - dist-scalprum/
#   - app-config.yaml
RUN mkdir -p /out/agent-office-backstage-plugin-agentworkstation-binders && \
    cp package.json /out/agent-office-backstage-plugin-agentworkstation-binders/ && \
    cp -R dist-scalprum /out/agent-office-backstage-plugin-agentworkstation-binders/dist-scalprum && \
    if [ -f app-config.yaml ]; then cp app-config.yaml /out/agent-office-backstage-plugin-agentworkstation-binders/; fi && \
    ls -la /out/agent-office-backstage-plugin-agentworkstation-binders/

# ---------- runtime ----------
FROM scratch

COPY --from=builder /out/agent-office-backstage-plugin-agentworkstation-binders /agent-office-backstage-plugin-agentworkstation-binders

# Base64-JSON OCI annotation that RHDH's install-dynamic-plugins.py
# reads to discover plugin paths. Decoded JSON:
#   [{"agent-office-backstage-plugin-agentworkstation-binders":{
#     "name": "agent-office-backstage-plugin-agentworkstation-binders",
#     "version": "0.0.7",
#     "backstage": {
#       "role": "frontend-plugin",
#       "pluginId": "agentworkstation-binders",
#       "pluginPackage": "agent-office-backstage-plugin-agentworkstation-binders",
#       "pluginPackages": ["agent-office-backstage-plugin-agentworkstation-binders"],
#       "supported-versions": "1.45.3"
#     }
#   }}]
LABEL io.backstage.dynamic-packages="W3siYWdlbnQtb2ZmaWNlLWJhY2tzdGFnZS1wbHVnaW4tYWdlbnR3b3Jrc3RhdGlvbi1iaW5kZXJzIjp7Im5hbWUiOiJhZ2VudC1vZmZpY2UtYmFja3N0YWdlLXBsdWdpbi1hZ2VudHdvcmtzdGF0aW9uLWJpbmRlcnMiLCJ2ZXJzaW9uIjoiMC4wLjciLCJiYWNrc3RhZ2UiOnsicm9sZSI6ImZyb250ZW5kLXBsdWdpbiIsInBsdWdpbklkIjoiYWdlbnR3b3Jrc3RhdGlvbi1iaW5kZXJzIiwicGx1Z2luUGFja2FnZSI6ImFnZW50LW9mZmljZS1iYWNrc3RhZ2UtcGx1Z2luLWFnZW50d29ya3N0YXRpb24tYmluZGVycyIsInBsdWdpblBhY2thZ2VzIjpbImFnZW50LW9mZmljZS1iYWNrc3RhZ2UtcGx1Z2luLWFnZW50d29ya3N0YXRpb24tYmluZGVycyJdLCJzdXBwb3J0ZWQtdmVyc2lvbnMiOiIxLjQ1LjMifX19XQ=="
