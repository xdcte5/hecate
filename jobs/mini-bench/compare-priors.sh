#!/usr/bin/env bash
# Compare mini-bench / routing-stats outcomes against relay/routing-priors.yaml.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$ROOT/../.." && pwd)"
BENCH_RESULTS="${1:-$ROOT/host-micro/results-with-usage.jsonl}"
ROUTING_STATS="${2:-$REPO/.relay/routing-stats.jsonl}"
PRIORS="${3:-$REPO/relay/routing-priors.yaml}"

cd "$REPO/packages/registry"
pnpm build >/dev/null
node dist/compare-priors-cli.js "$BENCH_RESULTS" "$ROUTING_STATS" "$PRIORS"
