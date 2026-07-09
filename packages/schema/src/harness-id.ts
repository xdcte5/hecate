import { z } from "zod";

export const HarnessIdSchema = z.enum(["claude-code", "codex", "cursor", "pi"]);
export type HarnessId = z.infer<typeof HarnessIdSchema>;
