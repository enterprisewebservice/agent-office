# syntax=docker/dockerfile:1.6
#
# Dockerfile for the agent-office Source-Filtered EntityPicker
# Backstage scaffolder field-extension plugin.
#
# Build context: this directory (rhdh-plugins/source-filtered-entity-picker).
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
RUN mkdir -p /out/${PLUGIN_NAME} && \
    cp package.json /out/${PLUGIN_NAME}/ && \
    cp -R dist-scalprum /out/${PLUGIN_NAME}/dist-scalprum && \
    if [ -f app-config.yaml ]; then cp app-config.yaml /out/${PLUGIN_NAME}/; fi && \
    ls /out/${PLUGIN_NAME}

# ---------- runtime ----------
# RHDH's install-dynamic-plugins.sh expects the OCI image's filesystem
# to have the plugin at the path declared in its manifest. The
# convention is `/dynamic-plugins/<plugin-name>/` — we name the
# folder identically to package.json's `name`.
FROM registry.access.redhat.com/ubi9/ubi-micro:latest

ARG PLUGIN_NAME=agent-office-backstage-plugin-source-filtered-entity-picker
ENV PLUGIN_NAME=${PLUGIN_NAME}

# Copy the assembled plugin tree built in /out/<plugin-name>/ to the
# image root at the same path. install-dynamic-plugins.py extracts
# this tarball into the dev-hub pod's
# dynamic-plugins-root/<plugin-name>/ and Backstage's PluginScanner
# reads package.json from there.
COPY --from=builder /out/${PLUGIN_NAME} /${PLUGIN_NAME}

LABEL io.openshift.maintainer="agent-office team"
LABEL io.openshift.tags="backstage,rhdh,scaffolder,plugin"
LABEL description="Backstage scaffolder field extension that adds a filter-icon popover to EntityPicker, narrowing the dropdown by model source (Registry / Catalog)."

# RHDH copies content out of the image — no need for a CMD. Set a
# no-op so container scanners don't complain about a missing entrypoint.
CMD ["true"]
