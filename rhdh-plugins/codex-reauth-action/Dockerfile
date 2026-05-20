# syntax=docker/dockerfile:1.6
#
# Dockerfile for the agent-office codex-reauth-action plugin.
#
# Same shape as ../source-filtered-entity-picker/Dockerfile but for
# a BACKEND module (role: backend-plugin-module), so janus-cli emits
# a different shape:
#
#   frontend-plugin       → dist-scalprum/ (UMD chunks + manifest)
#   backend-plugin-module → dist-dynamic/ (package.json + dist/index.cjs.js)
#
# Final image structure (extracted by install-dynamic-plugins.py
# into /opt/app-root/src/dynamic-plugins-root/<plugin-name>/):
#
#   <plugin-name>/
#     package.json
#     dist/index.cjs.js
#     dist/index.cjs.js.map
#     app-config.yaml  (optional, if present)

# ---------- builder ----------
FROM registry.access.redhat.com/ubi9/nodejs-20:latest AS builder

USER 0
WORKDIR /workspace

# janus-cli's export-dynamic-plugin shells out to `yarn --version`
# for backend modules (frontend plugins skip this). Install yarn
# 1.x globally so the bundling step doesn't fail with "yarn:
# command not found" right after backstage-cli build succeeds.
RUN npm install -g yarn@1.22

COPY package.json ./
COPY tsconfig.json ./
COPY src ./src

# --legacy-peer-deps for the same reason as the sibling plugin: the
# Backstage 1.45 dep tree disagrees with itself on @types/react.
# Harmless here (no React), kept for symmetry + to handle whatever
# transitive peer-dep conflicts the backend tree has too.
RUN npm install --no-audit --no-fund --legacy-peer-deps

# Three steps, same as the frontend plugin:
#   1. tsc emits .d.ts files into dist-types/
#   2. backstage-cli package build  → produces dist/index.cjs.js
#   3. janus-cli export-dynamic-plugin → wraps everything for RHDH
RUN npx tsc
RUN npx backstage-cli package build
# janus-cli assembles a complete runtime package under dist-dynamic/
# for backend plugins:
#   dist-dynamic/
#     package.json    ← publishConfig-applied main + types + -dynamic suffixed name
#     dist/           ← bundled CommonJS (index.cjs.js)
#     node_modules/   ← production deps yarn-installed against the dynamic package
#     app-config.yaml ← copied from source if present
#     yarn.lock
# This is what RHDH expects — node_modules and all. The earlier
# attempts that copied just `package.json + dist/` were missing the
# production deps + the publishConfig-rewritten package.json that
# janus-cli already produces.
RUN npx janus-cli package export-dynamic-plugin --in-place --no-embed-as-dependencies

# Verified locally: dist-dynamic/ is a self-contained Node module
# that `require()` can load (default export = BackendModule). Copy
# it verbatim into the OCI artifact's plugin folder.
RUN mkdir -p /out/agent-office-backstage-plugin-codex-reauth-backend && \
    cp -R dist-dynamic/. /out/agent-office-backstage-plugin-codex-reauth-backend/ && \
    ls -la /out/agent-office-backstage-plugin-codex-reauth-backend/

# ---------- runtime ----------
# FROM scratch so the final image has exactly ONE layer with only
# the plugin files. RHDH's install-dynamic-plugins.py reads ONLY
# manifest.layers[0], so any base-image layer ahead of ours would
# leave the plugin in a layer the script ignores.
FROM scratch

COPY --from=builder /out/agent-office-backstage-plugin-codex-reauth-backend /agent-office-backstage-plugin-codex-reauth-backend

# Decoded annotation JSON:
#   [{"agent-office-backstage-plugin-codex-reauth-backend":{
#     "name": "agent-office-backstage-plugin-codex-reauth-backend",
#     "version": "0.0.1",
#     "backstage": {
#       "role": "backend-plugin-module",
#       "pluginId": "scaffolder",
#       "pluginPackage": "agent-office-backstage-plugin-codex-reauth-backend",
#       "pluginPackages": ["agent-office-backstage-plugin-codex-reauth-backend"],
#       "supported-versions": "1.45.3"
#     }
#   }}]
LABEL io.backstage.dynamic-packages="W3siYWdlbnQtb2ZmaWNlLWJhY2tzdGFnZS1wbHVnaW4tY29kZXgtcmVhdXRoLWJhY2tlbmQiOnsibmFtZSI6ImFnZW50LW9mZmljZS1iYWNrc3RhZ2UtcGx1Z2luLWNvZGV4LXJlYXV0aC1iYWNrZW5kIiwidmVyc2lvbiI6IjAuMC41IiwiYmFja3N0YWdlIjp7InJvbGUiOiJiYWNrZW5kLXBsdWdpbiIsInBsdWdpbklkIjoiY29kZXgtcmVhdXRoIiwicGx1Z2luUGFja2FnZSI6ImFnZW50LW9mZmljZS1iYWNrc3RhZ2UtcGx1Z2luLWNvZGV4LXJlYXV0aC1iYWNrZW5kIiwicGx1Z2luUGFja2FnZXMiOlsiYWdlbnQtb2ZmaWNlLWJhY2tzdGFnZS1wbHVnaW4tY29kZXgtcmVhdXRoLWJhY2tlbmQiXSwic3VwcG9ydGVkLXZlcnNpb25zIjoiMS40NS4zIn19fV0="
