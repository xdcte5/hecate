#!/usr/bin/env bash
# Host micro-benchmark with token/cost extraction (Claude / Codex / Relay).
set -euo pipefail

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 22 >/dev/null 2>&1 || true
corepack enable >/dev/null 2>&1 || true

RELAY_CLI="/Users/shaynavinoth/Projects/relay/packages/cli/dist/index.js"
ROOT="/Users/shaynavinoth/Projects/relay/jobs/mini-bench/host-micro"
OUT="$ROOT/results-with-usage.jsonl"
BASE="$ROOT/runs-usage"
LOG="$ROOT/run-with-usage.log"

mkdir -p "$BASE"
: > "$OUT"

log() {
  echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG"
}

parse_usage() {
  local agent="$1" workdir="$2"
  python3 - "$agent" "$workdir" <<'PY'
import json, os, sys, glob

agent, workdir = sys.argv[1:3]

def parse_claude(path):
    result = None
    try:
        lines = open(path).read().splitlines()
    except OSError:
        return None
    for line in lines:
        line = line.strip()
        if not line or not line.startswith("{"):
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if obj.get("type") == "result":
            result = obj
    if not result:
        return None
    usage = result.get("usage") or {}
    inp = usage.get("input_tokens")
    out = usage.get("output_tokens")
    cost = result.get("total_cost_usd")
    if inp is None and result.get("modelUsage"):
        for m in result["modelUsage"].values():
            inp = m.get("inputTokens", inp)
            out = m.get("outputTokens", out)
            cost = m.get("costUSD", cost)
    total = None
    if inp is not None and out is not None:
        total = inp + out
    return {
        "input_tokens": inp,
        "output_tokens": out,
        "total_tokens": total,
        "cost_usd": cost,
        "extraction": "claude stream-json type=result",
    }

def parse_codex(path):
    last = None
    try:
        lines = open(path).read().splitlines()
    except OSError:
        return None
    for line in lines:
        line = line.strip()
        if not line or not line.startswith("{"):
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if obj.get("type") == "turn.completed" and obj.get("usage"):
            last = obj["usage"]
    if not last:
        return None
    inp = last.get("input_tokens")
    out = last.get("output_tokens")
    total = None
    if inp is not None and out is not None:
        total = inp + out
    return {
        "input_tokens": inp,
        "output_tokens": out,
        "total_tokens": total,
        "cost_usd": last.get("cost_usd") or last.get("total_cost_usd"),
        "extraction": "codex exec --json turn.completed (last turn)",
        "cached_input_tokens": last.get("cached_input_tokens"),
        "reasoning_output_tokens": last.get("reasoning_output_tokens"),
    }

def scan_relay_usage(root):
    launch = os.path.join(root, ".relay", "launch")
    paths = sorted(glob.glob(os.path.join(launch, "*-stream.jsonl")))
    if not paths:
        paths = [p for p in glob.glob(os.path.join(root, "**", "*-stream.jsonl"), recursive=True)]
    claude_in = claude_out = 0
    claude_cost = 0.0
    codex_in = codex_out = 0
    codex_cost = None
    harnesses = []
    for path in paths:
        harness = os.path.basename(path).replace("-stream.jsonl", "")
        try:
            lines = open(path).read().splitlines()
        except OSError:
            continue
        for line in lines:
            line = line.strip()
            if not line.startswith("{"):
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            if obj.get("type") == "result" and obj.get("usage"):
                u = obj["usage"]
                claude_in += (u.get("input_tokens") or 0) + (u.get("cache_read_input_tokens") or 0) + (u.get("cache_creation_input_tokens") or 0)
                claude_out += u.get("output_tokens") or 0
                c = obj.get("total_cost_usd")
                if c is not None:
                    claude_cost += float(c)
                if harness not in harnesses:
                    harnesses.append(harness)
            if obj.get("type") == "turn.completed" and obj.get("usage"):
                u = obj["usage"]
                codex_in += u.get("input_tokens") or 0
                codex_out += u.get("output_tokens") or 0
                c = u.get("cost_usd") or u.get("total_cost_usd")
                if c is not None:
                    codex_cost = (codex_cost or 0.0) + float(c)
                if harness not in harnesses:
                    harnesses.append(harness)
    total_in = claude_in + codex_in
    total_out = claude_out + codex_out
    if not total_in and not total_out:
        return None
    cost = None
    if claude_cost or codex_cost:
        cost = claude_cost + (codex_cost or 0.0)
    return {
        "input_tokens": total_in or None,
        "output_tokens": total_out or None,
        "total_tokens": (total_in + total_out) if (total_in or total_out) else None,
        "cost_usd": cost,
        "extraction": f"relay .relay/launch stream logs ({', '.join(harnesses) or 'none'})",
        "claude_input_tokens": claude_in or None,
        "claude_output_tokens": claude_out or None,
        "claude_cost_usd": claude_cost if claude_cost else None,
        "codex_input_tokens": codex_in or None,
        "codex_output_tokens": codex_out or None,
    }

def scan_tree_for_usage(root):
    claude_cost = 0.0
    claude_in = claude_out = 0
    codex_last = None
    found = []
    for path in glob.glob(os.path.join(root, "**", "*"), recursive=True):
        if not os.path.isfile(path):
            continue
        try:
            with open(path, "r", errors="ignore") as f:
                for line in f:
                    line = line.strip()
                    if not line.startswith("{"):
                        continue
                    try:
                        obj = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if obj.get("type") == "result" and obj.get("usage"):
                        u = obj["usage"]
                        claude_in += u.get("input_tokens") or 0
                        claude_out += u.get("output_tokens") or 0
                        c = obj.get("total_cost_usd")
                        if c is not None:
                            claude_cost += float(c)
                        found.append(("claude-result", path))
                    if obj.get("type") == "turn.completed" and obj.get("usage"):
                        codex_last = obj["usage"]
                        found.append(("codex-turn", path))
        except OSError:
            pass
    if claude_in or claude_out:
        return {
            "input_tokens": claude_in or None,
            "output_tokens": claude_out or None,
            "total_tokens": (claude_in + claude_out) if (claude_in and claude_out) else None,
            "cost_usd": claude_cost if claude_cost else None,
            "extraction": f"relay workdir scan ({len(found)} usage lines)",
        }
    if codex_last:
        inp = codex_last.get("input_tokens")
        out = codex_last.get("output_tokens")
        return {
            "input_tokens": inp,
            "output_tokens": out,
            "total_tokens": (inp + out) if inp is not None and out is not None else None,
            "cost_usd": codex_last.get("cost_usd"),
            "extraction": "relay workdir scan codex turn.completed",
        }
    return None

if agent == "claude":
    data = parse_claude(os.path.join(workdir, "claude-stream.jsonl"))
elif agent == "codex":
    data = parse_codex(os.path.join(workdir, "codex-stream.jsonl"))
else:
    data = scan_relay_usage(workdir) or scan_tree_for_usage(workdir)

if not data:
    data = {
        "input_tokens": None,
        "output_tokens": None,
        "total_tokens": None,
        "cost_usd": None,
        "extraction": "not found in logs",
    }
print(json.dumps(data))
PY
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
    log "SKIP agent=$agent task=$task_id (in results-with-usage.jsonl)"
    return 0
  fi

  rm -rf "$workdir"
  mkdir -p "$workdir"
  if [[ "$task_id" == "B" ]]; then
    printf '%s\n' 'def add(a,b):' '    return a - b' > "$workdir/add.py"
  fi
  cd "$workdir"

  log "START agent=$agent task=$task_id"
  local start end elapsed exit_code=0 success=0 verify_msg=""
  start=$(python3 -c 'import time; print(time.time())')

  case "$agent" in
    claude)
      claude -p --verbose --permission-mode bypassPermissions \
        --output-format stream-json --max-turns 8 \
        -- "$prompt" < /dev/null > claude-stream.jsonl 2>claude-stderr.log || exit_code=$?
      ;;
    codex)
      codex exec --json --sandbox workspace-write -C "$workdir" "$prompt" \
        < /dev/null > codex-stream.jsonl 2>codex-stderr.log || exit_code=$?
      ;;
    relay)
      export RELAY_CAPTURE_USAGE=1
      node "$RELAY_CLI" init --all-harnesses > relay-init.log 2>&1 || true
      if [[ -f relay/session-policy.yaml ]]; then
        sed -i.bak 's/requireGitSnapshotOnHandoff: true/requireGitSnapshotOnHandoff: false/' relay/session-policy.yaml 2>/dev/null || \
          sed -i '' 's/requireGitSnapshotOnHandoff: true/requireGitSnapshotOnHandoff: false/' relay/session-policy.yaml 2>/dev/null || true
      fi
      node "$RELAY_CLI" harbor-exec "$prompt" --agents claude-code,codex \
        > agent.log 2>&1 || exit_code=$?
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

  parse_usage "$agent" "$workdir" > usage-parsed.json

  python3 - "$agent" "$task_id" "$elapsed" "$exit_code" "$success" "$verify_msg" "$OUT" usage-parsed.json <<'PYROW'
import json, sys
agent, task_id, elapsed, exit_code, success, verify_msg, out_path, usage_path = sys.argv[1:9]
usage = json.load(open(usage_path))
row = {
  "agent": agent,
  "task_id": task_id,
  "wall_s": float(elapsed),
  "exit_code": int(exit_code),
  "success": success == "1",
  "verify": verify_msg,
}
row.update(usage)
with open(out_path, "a") as f:
    f.write(json.dumps(row) + "\n")
print(json.dumps(row))
PYROW

  log "DONE agent=$agent task=$task_id wall_s=${elapsed}s usage=$(cat usage-parsed.json)"
  echo "---" | tee -a "$LOG"
}

PROMPT_A='Create an executable shell script hello.sh in the current directory that prints exactly: hello'
PROMPT_B='Fix add.py in the current directory. It should define add(a,b) returning a+b. Currently it returns a-b. Only edit add.py.'
PROMPT_C='Create fib.py with function fib(n) returning nth Fibonacci (fib(0)=0,fib(1)=1). No external deps.'

log "=== Usage micro-benchmark ==="
log "Output: $OUT"

for agent in claude codex relay; do
  log ">>> Agent: $agent"
  run_agent "$agent" A "$BASE/${agent}-A" "$PROMPT_A"
  run_agent "$agent" B "$BASE/${agent}-B" "$PROMPT_B"
  run_agent "$agent" C "$BASE/${agent}-C" "$PROMPT_C"
done

log "=== Complete ==="
cat "$OUT" | tee -a "$LOG"
