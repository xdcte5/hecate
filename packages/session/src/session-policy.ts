import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  resolveSessionPolicyGovernance,
  SessionPolicySchema,
  type SessionPolicyGovernance,
} from "@relay/schema";

export const SESSION_POLICY_RELATIVE_PATH = join("relay", "session-policy.yaml");

const DEFAULT_POLICY: SessionPolicyGovernance = resolveSessionPolicyGovernance({
  routing: [],
  failover: ["cursor"],
});

export async function loadSessionPolicyGovernance(
  rootDir: string,
): Promise<SessionPolicyGovernance> {
  try {
    const content = await readFile(join(rootDir, SESSION_POLICY_RELATIVE_PATH), "utf8");
    const policy = SessionPolicySchema.parse(parseYaml(content));
    return resolveSessionPolicyGovernance(policy);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return DEFAULT_POLICY;
    }
    throw error;
  }
}
