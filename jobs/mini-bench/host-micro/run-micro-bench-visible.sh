#!/usr/bin/env bash
# Host-native micro-benchmark: Claude Code vs Codex vs Relay (3 tasks each).
# Run: bash jobs/mini-bench/host-micro/run-micro-bench-visible.sh
# Watch: tail -f jobs/mini-bench/host-micro/run.log
set -euo pipefail

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 22 >/dev/null 2>&1 || true

RELAY_CLI="/Users/shaynavinoth/Projects/relay/packages/cli/dist/index.js"
ROOT="/Users/shaynavinoth/Projects/relay/jobs/mini-bench/host-micro"
OUT="$ROOT/results.jsonl"
BASE="$ROOT/runs"
LOG="$ROOT/run.log"

mkdir -p "$BASE"
touch "$OUT"

log() {
  echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG"
}

already_done() {
  local agent="$1" task_id="$2"
  python3 - "$agent" "$task_id" "$OUT" <<'PY'
import json, sys
agent, task_id, path = sys.argv[1:4]
try:
    lines = open(path).read().splitlines()
except OSError:
    sys.exit(1)
for line in lines:
    if not line.strip():
        continue
    row = json.loads(line)
    if row.get("agent") == agent and row.get("task_id") == task_id:
        sys.exit(0)
sys.exit(1)
PY
}

run_agent() {
  local agent="$1" task_id="$2" workdir="$3" prompt="$4"
  if already_done "$agent" "$task_id"; then
    log "SKIP  agent=$agent task=$task_id (already in results.jsonl)"
    return 0
  fi

  rm -rf "$workdir"
  mkdir -p "$workdir"
  if [[ "$task_id" == "B" ]]; then
    printf '%s\n' 'def add(a,b):' '    return a - b' > "$workdir/add.py"
  fi
  cd "$workdir"

  local cmd=""
  case "$agent" in
    claude)
      cmd="claude -p --permission-mode bypassPermissions -- \"$prompt\""
      ;;
    codex)
      cmd="codex exec --sandbox workspace-write -C \"$workdir\" \"$prompt\" < /dev/null"
      ;;
    relay)
      cmd="node \"$RELAY_CLI\" harbor-exec \"$prompt\" --agents claude-code,codex"
      ;;
  esac

  log "START agent=$agent task=$task_id workdir=$workdir"
  log "PROMPT: $prompt"
  log "COMMAND: $cmd"

  local start end elapsed exit_code=0 success=0 verify_msg=""
  start=$(python3 -c 'import time; print(time.time())')
  case "$agent" in
    claude)
      claude -p --permission-mode bypassPermissions -- "$prompt" > agent.log 2>&1 || exit_code=$?
      ;;
    codex)
      codex exec --sandbox workspace-write -C "$workdir" "$prompt" < /dev/null > agent.log 2>&1 || exit_code=$?
      ;;
    relay)
      node "$RELAY_CLI" init --all-harnesses > relay-init.log 2>&1 || true
      if [[ -f relay/session-policy.yaml ]]; then
        sed -i.bak 's/requireGitSnapshotOnHandoff: true/requireGitSnapshotOnHandoff: false/' relay/session-policy.yaml 2>/dev/null || \
          sed -i '' 's/requireGitSnapshotOnHandoff: true/requireGitSnapshotOnHandoff: false/' relay/session-policy.yaml 2>/dev/null || true
      fi
      node "$RELAY_CLI" harbor-exec "$prompt" --agents claude-code,codex > agent.log 2>&1 || exit_code=$?
      ;;
  esac
  end=$(python3 -c 'import time; print(time.time())')
  elapsed=$(python3 -c "print(round($end - $start, 2))")

  case "$task_id" in
    A)
      if [[ -f hello.sh ]] && bash hello.sh 2>/dev/null | grep -q hello; then success=1; verify_msg="hello.sh ok"; else verify_msg="hello.sh fail"; fi
      ;;
    B)
      if python3 -c "from add import add; assert add(2,3)==5" 2>/dev/null; then success=1; verify_msg="add fixed"; else verify_msg="add broken"; fi
      ;;
    C)
      if python3 -c "from fib import fib; assert fib(10)==55" 2>/dev/null; then success=1; verify_msg="fib ok"; else verify_msg="fib fail"; fi
      ;;
  esac

  python3 - <<EOF >> "$OUT"
import json
print(json.dumps({"agent":"$agent","task_id":"$task_id","wall_s":$elapsed,"exit_code":$exit_code,"success":bool($success),"verify":"$verify_msg"}))
EOF

  log "DONE  agent=$agent task=$task_id wall_s=${elapsed}s exit=$exit_code success=$success verify=$verify_msg"
  log "LOG:   $workdir/agent.log"
  echo "---" | tee -a "$LOG"
}

PROMPT_A='Create an executable shell script hello.sh in the current directory that prints exactly: hello'
PROMPT_B='Fix add.py in the current directory. It should define add(a,b) returning a+b. Currently it returns a-b. Only edit add.py.'
PROMPT_C='Create fib.py with function fib(n) returning nth Fibonacci (fib(0)=0,fib(1)=1). No external deps.'

log "=== Host micro-benchmark ==="
log "Tasks:"
log "  A: create hello.sh (prints 'hello')"
log "  B: fix add.py (a+b not a-b)"
log "  C: create fib.py (fib(10)==55)"
log "Agents: claude, codex, relay"
log "Results: $OUT"
log ""

for agent in claude codex relay; do
  log ">>> Agent: $agent"
  run_agent "$agent" A "$BASE/${agent}-A" "$PROMPT_A"
  run_agent "$agent" B "$BASE/${agent}-B" "$PROMPT_B"
  run_agent "$agent" C "$BASE/${agent}-C" "$PROMPT_C"
done

log "=== All runs complete ==="
log "Results:"
cat "$OUT" | tee -a "$LOG"
