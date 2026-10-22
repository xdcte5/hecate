#!/usr/bin/env bash
# Tiny local Terminal-Bench comparison: Relay mesh vs plain Codex CLI.
#
# Defaults to a 3-task local slice copied from the original Terminal-Bench repo.
# Keep N_ATTEMPTS=1 and N_CONCURRENT=1 while validating auth and adapter wiring.

set -euo pipefail

RELAY_ROOT="${RELAY_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
TB_ROOT="${TB_ROOT:-/Users/shaynavinoth/projects/terminal-bench}"
DATASET_PATH="${DATASET_PATH:-$TB_ROOT/datasets/relay-small}"
JOBS_DIR="${JOB_DIR:-$RELAY_ROOT/jobs/tb-small}"
N_CONCURRENT="${N_CONCURRENT:-1}"
N_ATTEMPTS="${N_ATTEMPTS:-1}"
RUN_AGENTS="${RUN_AGENTS:-codex,relay}"
CODEX_MODEL="${CODEX_MODEL:-openai/gpt-5.4}"
RELAY_AGENT_PY="$RELAY_ROOT/scripts/harbor/relay_agent.py"
RELAY_CLI="$RELAY_ROOT/packages/cli/dist/index.js"
TS="$(date +%Y%m%d-%H%M%S)"

if ! command -v harbor >/dev/null 2>&1; then
  echo "ERROR: harbor CLI not found on PATH."
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "ERROR: Docker is not running. Start Docker Desktop, then retry."
  exit 1
fi

if [[ ! -d "$DATASET_PATH" ]]; then
  echo "ERROR: Terminal-Bench small dataset not found: $DATASET_PATH"
  exit 1
fi

if [[ ! -f "$RELAY_CLI" ]]; then
  echo "ERROR: Relay CLI not built. Run: cd $RELAY_ROOT && pnpm build"
  exit 1
fi

if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "WARN: OPENAI_API_KEY is not set; Codex trials may fail."
fi

if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  echo "WARN: ANTHROPIC_API_KEY is not set; Relay claude-code failover may fail."
fi

mkdir -p "$JOBS_DIR"
MOUNTS_JSON="[{\"type\":\"bind\",\"source\":\"$RELAY_ROOT\",\"target\":\"/opt/relay\",\"readonly\":true}]"

run_codex() {
  harbor run \
    -p "$DATASET_PATH" \
    -o "$JOBS_DIR" \
    --job-name "tb-small-codex-${TS}" \
    -a codex \
    -m "$CODEX_MODEL" \
    -n "$N_CONCURRENT" \
    -k "$N_ATTEMPTS" \
    -y
}

run_relay() {
  harbor run \
    -p "$DATASET_PATH" \
    -o "$JOBS_DIR" \
    --job-name "tb-small-relay-${TS}" \
    -a "$RELAY_AGENT_PY:RelayAgent" \
    --mounts "$MOUNTS_JSON" \
    --ae "RELAY_ROOT=/opt/relay" \
    -n "$N_CONCURRENT" \
    -k "$N_ATTEMPTS" \
    -y
}

IFS="," read -r -a AGENTS <<< "$RUN_AGENTS"
for agent in "${AGENTS[@]}"; do
  case "$agent" in
    codex)
      echo "========== Codex CLI =========="
      run_codex
      ;;
    relay)
      echo "========== Relay mesh =========="
      run_relay
      ;;
    *)
      echo "ERROR: unsupported RUN_AGENTS entry: $agent"
      echo "Supported: codex,relay"
      exit 1
      ;;
  esac
done

echo ""
echo "Done. Summarize with:"
echo "  python3 $RELAY_ROOT/scripts/harbor/summarize-results.py $JOBS_DIR"
