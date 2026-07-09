import { z } from "zod";
import { HarnessIdSchema } from "./harness-id.js";

export const ModelCardSchema = z.object({
  id: z.string(),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()).optional().default([]),
});
export type ModelCard = z.infer<typeof ModelCardSchema>;

export const HarnessCardSchema = z.object({
  id: HarnessIdSchema,
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  binaries: z.array(z.string()),
  models: z.array(ModelCardSchema).optional(),
});
export type HarnessCard = z.infer<typeof HarnessCardSchema>;

export const RegistrySchema = z.object({
  harnesses: z.array(HarnessCardSchema).min(1),
});
export type Registry = z.infer<typeof RegistrySchema>;
