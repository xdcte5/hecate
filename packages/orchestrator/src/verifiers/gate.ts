import type { GateVerdict, VerifiableStep } from "./types.js";
import { runVerifiers } from "./compose.js";

export async function verifyThenAct(
  step: VerifiableStep,
  cwd: string,
  onPass: () => Promise<void>,
  options: Parameters<typeof runVerifiers>[2] = {},
): Promise<GateVerdict> {
  const verdict = await runVerifiers(step, cwd, options);
  if (verdict.recommendation === "ACT") {
    await onPass();
  }
  return verdict;
}
