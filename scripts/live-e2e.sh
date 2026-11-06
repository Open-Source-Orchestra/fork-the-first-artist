#!/usr/bin/env bash
# Thin wrapper: see docs/LIVE-E2E.md. Pass --dev, --dev --real-0g, or --live.
# Root disk is often full on the demo box; keep temp + npm cache on /workspace.
cd "$(dirname "$0")/.." || exit 1
export TMPDIR="${TMPDIR:-$PWD/.tmp}"
mkdir -p "$TMPDIR"
exec node scripts/live-e2e.mjs "$@"
