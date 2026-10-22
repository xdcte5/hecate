#!/usr/bin/env bash
# Mini Terminal-Bench comparison: Relay vs Codex CLI vs Claude Code
#
# Defaults: 3 tasks, 1 attempt each, sequential (-n 1) to reduce rate limits.
# NOT a full bench — use -l to scale up after validating setup.
#
# Prerequisites:
#   - Docker running
#   - harbor CLI (~/.local/bin/harbor)
#   - Relay built: cd ~/Projects/relay && pnpm build
#   - API keys exported (see below)
#
# Usage:
#   export ANTHROPIC_API_KEY=...
#   export OPENAI_API_KEY=...          # Codex CLI
#   ./scripts/harbor/mini-bench.sh
#
#   N_TASKS=5 JOB_DIR=~/tb-mini ./scripts/harbor/mini-bench.sh

set -euo pipefail

RELAY_ROOT="${RELAY_ROOT:-$HOME/Projects/relay}"
N_TASKS="${N_TASKS:-3}"
N_CONCURRENT="${N_CONCURRENT:-1}"
N_ATTEMPTS="${N_ATTEMPTS:-1}"
JOBS_DIR="${JOB_DIR:-$RELAY_ROOT/jobs/mini-bench}"
DATASET="${DATASET:-terminal-bench/terminal-bench-2}"
RELAY_AGENT_PY="$RELAY_ROOT/scripts/harbor/relay_agent.py"
RELAY_CLI="$RELAY_ROOT/packages/cli/dist/index.js"

CLAUDE_MODEL="${CLAUDE_MODEL:-anthropic/claude-sonnet-4-6}"
CODEX_MODEL="${CODEX_MODEL:-openai/gpt-5.4}"

if ! docker info &>/dev/null; then
  echo "ERROR: Docker is not running. Start Docker Desktop, then retry."
  exit 1
fi

if [[ ! -f "$RELAY_CLI" ]]; then
  echo "ERROR: Relay CLI not built. Run: cd $RELAY_ROOT && pnpm build"
  exit 1
fi

if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  echo "WARN: ANTHROPIC_API_KEY not set — Claude Code / Relay failover may fail."
fi
if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "WARN: OPENAI_API_KEY not set — Codex / Relay failover may fail."
fi

mkdir -p "$JOBS_DIR"
MOUNTS_JSON="[{\"type\":\"bind\",\"source\":\"$RELAY_ROOT\",\"target\":\"/opt/relay\",\"readonly\":true}]"
TS="$(date +%Y%m%d-%H%M%S)"

run_job() {
  local name="$1"
  shift
  echo ""
  echo "========== $name =========="
  harbor run \
    -d "$DATASET" \
    -o "$JOBS_DIR" \
    --job-name "${name}-${TS}" \
    -l "$N_TASKS" \
    -n "$N_CONCURRENT" \
    -k "$N_ATTEMPTS" \
    -y \
    "$@"
}

# 1) Claude Code (direct harness)
run_job "claude-code" \
  -a claude-code \
  -m "$CLAUDE_MODEL"

# 2) Codex CLI (direct harness)
run_job "codex-cli" \
  -a codex \
  -m "$CODEX_MODEL"

# 3) Relay orchestrator (routes between claude-code + codex inside container)
run_job "relay-mesh" \
  -a "$RELAY_AGENT_PY:RelayAgent" \
  --mounts "$MOUNTS_JSON" \
  --ae "RELAY_ROOT=/opt/relay"

echo ""
echo "Done. Summarize with:"
echo "  python3 $RELAY_ROOT/scripts/harbor/summarize-results.py $JOBS_DIR"
