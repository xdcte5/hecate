"""Harbor custom agent: Relay orchestrator for Terminal-Bench 2.0.

Mount the Relay repo into the container (read-only is fine for source):
  --mounts type=bind,source=$HOME/Projects/relay,target=/opt/relay,readonly

Run:
  harbor run -d terminal-bench@2.0 \\
    --agent relay_agent:RelayAgent \\
    --agent-import-path $HOME/Projects/relay/scripts/harbor/relay_agent.py \\
    -m anthropic/claude-sonnet-4-6 \\
    -l 10 -n 2 --debug \\
    --ae RELAY_ROOT=/opt/relay
"""

from __future__ import annotations

import os
import shlex
from typing import override

from harbor.agents.installed.base import BaseInstalledAgent, with_prompt_template
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext


class RelayAgent(BaseInstalledAgent):
    """Runs Relay processPrompt inside the task container."""

    SUPPORTS_ATIF: bool = False

    @staticmethod
    @override
    def name() -> str:
        return "relay"

    @override
    async def install(self, environment: BaseEnvironment) -> None:
        relay_root = os.environ.get("RELAY_ROOT", "/opt/relay")

        await self.exec_as_root(
            environment,
            command=(
                "if command -v apt-get &>/dev/null; then "
                "apt-get update && apt-get install -y curl git procps ca-certificates; "
                "elif command -v apk &>/dev/null; then "
                "apk add --no-cache curl git procps bash nodejs npm; "
                "fi"
            ),
            env={"DEBIAN_FRONTEND": "noninteractive"},
        )

        # Node 22 + pnpm (Relay monorepo)
        await self.exec_as_agent(
            environment,
            command=(
                "set -euo pipefail; "
                "if ! command -v node &>/dev/null || [ \"$(node -p process.versions.node.split('.')[0])\" -lt 20 ]; then "
                "curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.2/install.sh | bash; "
                'export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; '
                "nvm install 22 && nvm alias default 22; "
                "fi; "
                'export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" || true; '
                "corepack enable && corepack prepare pnpm@latest --activate; "
                "node --version && pnpm --version"
            ),
        )

        # Claude Code + Codex (Relay failover targets)
        await self.exec_as_agent(
            environment,
            command=(
                "set -euo pipefail; "
                'export PATH="$HOME/.local/bin:$PATH"; '
                'export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" || true; '
                "if ! command -v claude &>/dev/null; then "
                "curl -fsSL https://downloads.claude.ai/claude-code-releases/bootstrap.sh | bash -s --; "
                "fi; "
                "if ! command -v codex &>/dev/null; then "
                "npm install -g @openai/codex@latest; "
                "fi; "
                'export PATH="$HOME/.local/bin:$PATH"; '
                "claude --version && codex --version"
            ),
        )

        # Build Relay once (copy mount to writable dir if needed)
        await self.exec_as_agent(
            environment,
            command=(
                f"set -euo pipefail; "
                f'RELAY_SRC="{shlex.quote(relay_root)}"; '
                'RELAY_WORK="$HOME/relay"; '
                'export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" || true; '
                'if [ -f "$RELAY_SRC/packages/cli/dist/index.js" ]; then '
                '  RELAY_CLI="$RELAY_SRC/packages/cli/dist/index.js"; '
                "else "
                '  rm -rf "$RELAY_WORK"; cp -a "$RELAY_SRC" "$RELAY_WORK"; '
                '  cd "$RELAY_WORK" && pnpm install --frozen-lockfile && pnpm build; '
                '  RELAY_CLI="$RELAY_WORK/packages/cli/dist/index.js"; '
                "fi; "
                'echo "$RELAY_CLI" > "$HOME/.relay-cli-path"; '
                "test -f \"$(cat $HOME/.relay-cli-path)\""
            ),
            env={"RELAY_ROOT": relay_root},
        )

    @with_prompt_template
    @override
    async def run(
        self,
        instruction: str,
        environment: BaseEnvironment,
        context: AgentContext,
    ) -> None:
        relay_cli = "$(cat $HOME/.relay-cli-path)"
        quoted = shlex.quote(instruction)

        env = {
            "PATH": "$HOME/.local/bin:$PATH",
            "ANTHROPIC_API_KEY": self._get_env("ANTHROPIC_API_KEY") or "",
            "OPENAI_API_KEY": self._get_env("OPENAI_API_KEY") or "",
            "CI": "true",
            "NO_COLOR": "1",
        }

        await self.exec_as_agent(
            environment,
            command=(
                "set -euo pipefail; "
                'export PATH="$HOME/.local/bin:$PATH"; '
                'export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" || true; '
                f'RELAY_CLI={relay_cli}; '
                'if [ ! -d relay ]; then '
                '  node "$RELAY_CLI" init --all-harnesses; '
                "fi; "
                "sed -i.bak 's/requireGitSnapshotOnHandoff: true/requireGitSnapshotOnHandoff: false/' relay/session-policy.yaml 2>/dev/null || "
                "sed -i '' 's/requireGitSnapshotOnHandoff: true/requireGitSnapshotOnHandoff: false/' relay/session-policy.yaml 2>/dev/null || true; "
                f'node "$RELAY_CLI" harbor-exec {quoted} --agents claude-code,codex'
            ),
            env=env,
        )
