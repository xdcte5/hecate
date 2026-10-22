#!/usr/bin/env bash
set -euo pipefail
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 22 >/dev/null 2>&1 || true

RELAY_CLI="/Users/shaynavinoth/Projects/relay/packages/cli/dist/index.js"
OUT="/Users/shaynavinoth/Projects/relay/jobs/mini-bench/host-micro/results.jsonl"
BASE="/Users/shaynavinoth/Projects/relay/jobs/mini-bench/host-micro/runs"
mkdir -p "$BASE"
: > "$OUT"

run_agent() {
  local agent="$1" task_id="$2" workdir="$3" prompt="$4"
  rm -rf "$workdir"
  mkdir -p "$workdir"
  if [[ "$task_id" == "B" ]]; then
    printf '%s\n' 'def add(a,b):' '    return a - b' > "$workdir/add.py"
  fi
  cd "$workdir"
  local start end elapsed exit_code=0 success=0 verify_msg=""
  start=$(python3 -c 'import time; print(time.time())')
  case "$agent" in
    claude)
      claude -p --permission-mode bypassPermissions -- "$prompt" > agent.log 2>&1 || exit_code=$?
      ;;
    codex)
      codex exec --full-auto -C "$workdir" "$prompt" > agent.log 2>&1 || exit_code=$?
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
}

PROMPT_A='Create an executable shell script hello.sh in the current directory that prints exactly: hello'
PROMPT_B='Fix add.py in the current directory. It should define add(a,b) returning a+b. Currently it returns a-b. Only edit add.py.'
PROMPT_C='Create fib.py with function fib(n) returning nth Fibonacci (fib(0)=0,fib(1)=1). No external deps.'

for agent in claude codex relay; do
  run_agent "$agent" A "$BASE/${agent}-A" "$PROMPT_A"
  run_agent "$agent" B "$BASE/${agent}-B" "$PROMPT_B"
  run_agent "$agent" C "$BASE/${agent}-C" "$PROMPT_C"
done

echo "Wrote $OUT"
cat "$OUT"
