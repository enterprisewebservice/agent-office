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

# Yarn install — keep this simple. The plugin has no lockfile yet,
# which means hash mismatches are possible across builds but we only
# build behind a Konflux pipeline that pins everything via image
# digests upstream of this step.
RUN npm install --no-audit --no-fund

# Two-step build:
#   1. `backstage-cli package build`  → produces dist/
#   2. `janus-cli package export-dynamic-plugin` → produces dist-dynamic/
#      with a Backstage-loadable bundle (UMD + manifest.json).
RUN npx backstage-cli package build
RUN npx janus-cli package export-dynamic-plugin --in-place --no-embed-as-dependencies

# ---------- runtime ----------
# RHDH's install-dynamic-plugins.sh expects the OCI image's filesystem
# to have the plugin at the path declared in its manifest. The
# convention is `/dynamic-plugins/<plugin-name>/` — we name the
# folder identically to package.json's `name`.
FROM registry.access.redhat.com/ubi9/ubi-micro:latest

ARG PLUGIN_NAME=agent-office-backstage-plugin-source-filtered-entity-picker
ENV PLUGIN_NAME=${PLUGIN_NAME}

COPY --from=builder /workspace/dist-dynamic /dynamic-plugins/${PLUGIN_NAME}

LABEL io.openshift.maintainer="agent-office team"
LABEL io.openshift.tags="backstage,rhdh,scaffolder,plugin"
LABEL description="Backstage scaffolder field extension that adds a filter-icon popover to EntityPicker, narrowing the dropdown by model source (Registry / Catalog)."

# RHDH copies content out of the image — no need for a CMD. Set a
# no-op so container scanners don't complain about a missing entrypoint.
CMD ["true"]
