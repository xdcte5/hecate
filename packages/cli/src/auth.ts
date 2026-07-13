import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { HarnessId } from "@relay/schema";

/**
 * Thin login model: Relay never stores credentials. Each harness owns its own
 * auth (its CLI's own login flow / token store). Relay only *orchestrates*
 * those native logins and records which harnesses the user has logged into, so
 * the mesh can route around unauthenticated agents.
 */

export interface HarnessAuthRecord {
  authenticated: boolean;
  /** ISO timestamp of the last successful `relay login`. */
  at?: string;
  /** How auth was established — always the harness's own CLI for now. */
  method: "native-cli";
}

export interface AuthState {
  version: 1;
  harnesses: Partial<Record<HarnessId, HarnessAuthRecord>>;
}

export const AUTH_RELATIVE = join(".relay", "auth.json");

export function authPath(cwd: string): string {
  return join(cwd, AUTH_RELATIVE);
}

export function emptyAuthState(): AuthState {
  return { version: 1, harnesses: {} };
}

export async function readAuthState(cwd: string): Promise<AuthState> {
  try {
    const raw = await readFile(authPath(cwd), "utf8");
    const parsed = JSON.parse(raw) as Partial<AuthState>;
    return {
      version: 1,
      harnesses: parsed.harnesses ?? {},
    };
  } catch {
    return emptyAuthState();
  }
}

export async function writeAuthState(cwd: string, state: AuthState): Promise<void> {
  await mkdir(join(cwd, ".relay"), { recursive: true });
  await writeFile(authPath(cwd), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export async function recordAuth(
  cwd: string,
  harness: HarnessId,
  authenticated: boolean,
): Promise<void> {
  const state = await readAuthState(cwd);
  state.harnesses[harness] = {
    authenticated,
    method: "native-cli",
    ...(authenticated ? { at: new Date().toISOString() } : {}),
  };
  await writeAuthState(cwd, state);
}

/**
 * How to log into each harness. `login` args are passed to the harness binary
 * with the terminal inherited so the user completes the native flow. These are
 * sensible defaults; a project can override them in `relay/orchestrator.yaml`
 * (see login.loginArgsFor).
 */
export const DEFAULT_LOGIN_ARGS: Record<HarnessId, string[]> = {
  "claude-code": ["/login"],
  codex: ["login"],
  cursor: ["login"],
  pi: ["auth", "login"],
  antigravity: [],
};
