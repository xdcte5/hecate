import { z } from "zod";

export const HarnessIdSchema = z.enum([
  "claude-code",
  "codex",
  "cursor",
  "pi",
  "antigravity",
]);
export type HarnessId = z.infer<typeof HarnessIdSchema>;
