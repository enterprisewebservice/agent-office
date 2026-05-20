# syntax=docker/dockerfile:1.6
#
# Dockerfile for the agent-office Codex Reauth UI
# Backstage scaffolder field-extension plugin.
#
# Build context: this directory (rhdh-plugins/codex-reauth-ui).
# Output: an OCI image that contains the plugin's dist-dynamic folder
# at /dynamic-plugins/. RHDH's install-dynamic-plugins.sh pulls the
# image (referenced as `oci://<image-ref>!<plugin-name>` in the
# v1-dynamic-plugins ConfigMap) and copies that folder into the main
# pod's dynamic-plugins-root volume before the developer-hub
# container starts.
#
# We use the upstream Backstage dynamic-plugin packager (janus-cli)
# because RHDH 1.x still mirrors that toolchain. The final image is
# tiny — only the dist-dynamic folder is shipped; no node_modules
# in the runtime layer.

# ---------- builder ----------
FROM registry.access.redhat.com/ubi9/nodejs-20:latest AS builder

USER 0
WORKDIR /workspace

# Yarn 1 is bundled with the ubi nodejs image and is what
# @backstage/cli expects.
COPY package.json ./
COPY tsconfig.json ./
COPY src ./src

# npm install — `--legacy-peer-deps` is required because
# @material-ui/icons@4 declares a peer of @types/react ^16||^17, but
# the rest of Backstage 1.45's plugin-scaffolder-react chain wants
# @types/react@18. The combination is well-tested at runtime
# (MUI v4 works fine with React 18); npm 7+ just refuses to resolve
# the optional peer without this flag. The plugin has no lockfile
# yet — that's intentional since this is the only environment that
# builds it; reproducibility comes from pinned base images upstream.
RUN npm install --no-audit --no-fund --legacy-peer-deps

# Three-step build:
#   1. `tsc` emits .d.ts files into dist-types/ that the rest of the
#      pipeline needs. `backstage-cli package build` does NOT do
#      this itself — it expects dist-types/src/index.d.ts to already
#      exist, then bundles the runtime JS separately.
#   2. `backstage-cli package build`  → produces dist/ (CJS + ESM).
#   3. `janus-cli package export-dynamic-plugin` → produces
#      dist-dynamic/ with a Backstage-loadable bundle (UMD +
#      manifest.json) that RHDH's install-dynamic-plugins.sh copies
#      into the dev-hub pod.
RUN npx tsc
RUN npx backstage-cli package build
RUN npx janus-cli package export-dynamic-plugin --in-place --no-embed-as-dependencies
# Assemble what RHDH's install-dynamic-plugins.py extracts from the
# image's `!<plugin-path>` directory. For a frontend plugin it needs:
#   - package.json        (so Backstage's PluginScanner finds the role)
#   - dist-scalprum/      (the webpack-bundled chunks janus-cli built)
#   - app-config.yaml     (the dynamicPlugins.frontend default config)
# Build attempt #8 only shipped the scalprum chunks under the wrong
# parent dir, so PluginScanner errored with ENOENT package.json.
# Assemble into a hard-coded path so the COPY in stage 2 doesn't
# depend on ARG/ENV expansion at copy time (buildah preserves env
# inside RUN steps but not always in COPY source paths).
RUN mkdir -p /out/agent-office-backstage-plugin-codex-reauth-ui && \
    cp package.json /out/agent-office-backstage-plugin-codex-reauth-ui/ && \
    cp -R dist-scalprum /out/agent-office-backstage-plugin-codex-reauth-ui/dist-scalprum && \
    if [ -f app-config.yaml ]; then cp app-config.yaml /out/agent-office-backstage-plugin-codex-reauth-ui/; fi && \
    ls -la /out/agent-office-backstage-plugin-codex-reauth-ui/

# ---------- runtime ----------
# FROM scratch (not ubi-micro) so the final image has exactly ONE
# layer containing only the plugin files. RHDH's
# install-dynamic-plugins.py reads ONLY `manifest.layers[0]` (not the
# whole stack), so any base-image layer pushed first would leave the
# plugin in layer 1 — which the script ignores. Builds #8 through
# #10 silently extracted zero files for that reason.
# `FROM scratch` makes our COPY the only layer and the install
# script's first-layer logic Just Works.
FROM scratch

# Copy the assembled plugin tree built in /out/<plugin-name>/ to the
# image root at the same path. install-dynamic-plugins.py extracts
# this tarball into the dev-hub pod's
# dynamic-plugins-root/<plugin-name>/ and Backstage's PluginScanner
# reads package.json from there.
COPY --from=builder /out/agent-office-backstage-plugin-codex-reauth-ui /agent-office-backstage-plugin-codex-reauth-ui

# No metadata LABELs on FROM scratch — they require a base image
# config to attach to. We could add an explicit config, but for an
# install-dynamic-plugin tarball-style image RHDH only cares about
# the layer contents.

# RHDH's install-dynamic-plugins.py reads this base64-JSON OCI
# annotation to discover which plugin paths to extract from the image
# layers. WITHOUT IT the script silently extracts zero files even
# though it reports "Successfully installed" — that's the bug builds
# #8 through #10 hit (image had the right tarball but no annotation).
#
# The decoded JSON is:
#   [{"agent-office-backstage-plugin-codex-reauth-ui":{
#     "name": "agent-office-backstage-plugin-codex-reauth-ui",
#     "version": "0.0.1",
#     "backstage": {
#       "role": "frontend-plugin",
#       "pluginId": "codex-reauth-ui",
#       "pluginPackage": "agent-office-backstage-plugin-codex-reauth-ui",
#       "pluginPackages": ["agent-office-backstage-plugin-codex-reauth-ui"],
#       "supported-versions": "1.45.3"
#     }
#   }}]
LABEL io.backstage.dynamic-packages="W3siYWdlbnQtb2ZmaWNlLWJhY2tzdGFnZS1wbHVnaW4tY29kZXgtcmVhdXRoLXVpIjp7Im5hbWUiOiJhZ2VudC1vZmZpY2UtYmFja3N0YWdlLXBsdWdpbi1jb2RleC1yZWF1dGgtdWkiLCJ2ZXJzaW9uIjoiMC4wLjQiLCJiYWNrc3RhZ2UiOnsicm9sZSI6ImZyb250ZW5kLXBsdWdpbiIsInBsdWdpbklkIjoiY29kZXgtcmVhdXRoLXVpIiwicGx1Z2luUGFja2FnZSI6ImFnZW50LW9mZmljZS1iYWNrc3RhZ2UtcGx1Z2luLWNvZGV4LXJlYXV0aC11aSIsInBsdWdpblBhY2thZ2VzIjpbImFnZW50LW9mZmljZS1iYWNrc3RhZ2UtcGx1Z2luLWNvZGV4LXJlYXV0aC11aSJdLCJzdXBwb3J0ZWQtdmVyc2lvbnMiOiIxLjQ1LjMifX19XQ=="

# RHDH copies content out of the image. No CMD on `FROM scratch`.
