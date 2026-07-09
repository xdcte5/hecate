import { z } from "zod";
import { HarnessIdSchema } from "./harness-id.js";

export const HarnessCardSchema = z.object({
  id: HarnessIdSchema,
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  binaries: z.array(z.string()),
});
export type HarnessCard = z.infer<typeof HarnessCardSchema>;

export const RegistrySchema = z.object({
  harnesses: z.array(HarnessCardSchema).min(1),
});
export type Registry = z.infer<typeof RegistrySchema>;
