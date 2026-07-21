#!/usr/bin/env bash
# render.sh <service-name> <out-dir> — instantiate the golden-path scaffold.
# The rendered repo is complete: its FIRST commit carries .tekton/ (PaC fires on push #1),
# gitops/ (ApplicationSet adopts via the marker), and a running MCP stub for the pipeline
# to build. The developer agent replaces app/ + tests/ with the real implementation.
set -euo pipefail
NAME="${1:?service name}"; OUT="${2:?output dir}"
PREFIX="$(echo "$NAME" | tr '-' '_')"   # spec.prefix must match ^[a-z0-9][a-z0-9_]*$ (no hyphens)
SRC="$(cd "$(dirname "$0")/scaffold" && pwd)"
mkdir -p "$OUT"
(cd "$SRC" && find . -type f) | while read -r f; do
  mkdir -p "$OUT/$(dirname "$f")"
  sed -e "s/__SVC_PREFIX__/${PREFIX}/g" -e "s/__SVC__/${NAME}/g" "$SRC/$f" > "$OUT/$f"
done
chmod +x "$OUT"/render.sh 2>/dev/null || true
echo "rendered ${NAME} -> ${OUT}"
