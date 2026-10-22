#!/usr/bin/env python3
"""Aggregate Harbor mini-bench metrics: accuracy, latency, tokens, cost.

Scans job directories for trial_result.json (or result.json) files.

Usage:
  python3 scripts/harbor/summarize-results.py jobs/mini-bench
  python3 scripts/harbor/summarize-results.py jobs/mini-bench/claude-code-20260715-101500
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def load_json(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return None


def find_trial_results(root: Path) -> list[Path]:
    names = ("trial_result.json", "result.json")
    found: list[Path] = []
    for name in names:
        found.extend(root.rglob(name))
    return sorted(set(found))


def metrics_from_trial(data: dict) -> dict:
    timing = data.get("timing") or {}
    usage = data.get("usage_info") or data.get("usage") or {}
    reward = data.get("reward")
    if reward is None:
        reward = data.get("score")
    status = data.get("status", "unknown")

    agent_sec = timing.get("agent_time_sec") or timing.get("agent_duration_sec")
    total_sec = timing.get("total_time_sec") or timing.get("wall_time_sec")

    prompt_tok = usage.get("prompt_tokens") or usage.get("input_tokens")
    completion_tok = usage.get("completion_tokens") or usage.get("output_tokens")
    total_cost = usage.get("total_cost") or usage.get("cost")

    return {
        "reward": reward,
        "success": reward == 1 or reward == 1.0 or status == "completed" and reward not in (0, 0.0),
        "status": status,
        "agent_sec": agent_sec,
        "total_sec": total_sec,
        "prompt_tokens": prompt_tok,
        "completion_tokens": completion_tok,
        "total_cost": total_cost,
    }


def summarize_job(job_dir: Path) -> dict | None:
    trials = find_trial_results(job_dir)
    if not trials:
        return None

    rows = [metrics_from_trial(load_json(p) or {}) for p in trials]
    n = len(rows)
    successes = sum(1 for r in rows if r.get("success"))
    agent_times = [r["agent_sec"] for r in rows if r.get("agent_sec") is not None]
    costs = [r["total_cost"] for r in rows if r.get("total_cost") is not None]
    prompt_tok = [r["prompt_tokens"] for r in rows if r.get("prompt_tokens") is not None]
    completion_tok = [r["completion_tokens"] for r in rows if r.get("completion_tokens") is not None]

    def avg(vals: list[float]) -> float | None:
        return sum(vals) / len(vals) if vals else None

    def total(vals: list[float]) -> float | None:
        return sum(vals) if vals else None

    return {
        "job": job_dir.name,
        "trials": n,
        "success_rate": successes / n if n else 0,
        "avg_agent_sec": avg(agent_times),
        "sum_agent_sec": total(agent_times),
        "sum_prompt_tokens": total(prompt_tok),
        "sum_completion_tokens": total(completion_tok),
        "sum_cost_usd": total(costs),
    }


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    root = Path(sys.argv[1]).expanduser().resolve()
    if not root.exists():
        print(f"Path not found: {root}")
        sys.exit(1)

    # If path is a single job (has trials subdirs or result files), summarize one.
    job_dirs: list[Path]
    if find_trial_results(root):
        job_dirs = [root]
    else:
        job_dirs = sorted([p for p in root.iterdir() if p.is_dir()])

    summaries = []
    for job_dir in job_dirs:
        s = summarize_job(job_dir)
        if s:
            summaries.append(s)

    if not summaries:
        print(f"No trial_result.json files under {root}")
        print("Run mini-bench.sh first, or pass a specific job directory.")
        sys.exit(1)

    headers = [
        "job",
        "trials",
        "success%",
        "avg_agent_s",
        "sum_agent_s",
        "prompt_tok",
        "completion_tok",
        "cost_usd",
    ]
    print("\t".join(headers))
    for s in summaries:
        print(
            "\t".join(
                [
                    s["job"],
                    str(s["trials"]),
                    f"{100 * s['success_rate']:.1f}",
                    f"{s['avg_agent_sec']:.1f}" if s["avg_agent_sec"] else "-",
                    f"{s['sum_agent_sec']:.1f}" if s["sum_agent_sec"] else "-",
                    str(int(s["sum_prompt_tokens"])) if s["sum_prompt_tokens"] else "-",
                    str(int(s["sum_completion_tokens"])) if s["sum_completion_tokens"] else "-",
                    f"{s['sum_cost_usd']:.4f}" if s["sum_cost_usd"] else "-",
                ]
            )
        )

    print("\nView trajectories: harbor view <job-dir>")


if __name__ == "__main__":
    main()
