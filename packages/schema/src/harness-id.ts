import { z } from "zod";

export const HarnessIdSchema = z.enum([
  "claude-code",
  "codex",
  "cursor",
  "pi",
  "gemini-cli",
]);
export type HarnessId = z.infer<typeof HarnessIdSchema>;
