import { z } from "zod";
import { HarnessIdSchema } from "./harness-id.js";

export const ModelCardSchema = z.object({
  id: z.string(),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()).optional().default([]),
  /** How good this model is at breaking work into steps (0-10). Drives the planner hierarchy. */
  planning: z.number().min(0).max(10).optional(),
  /** How good this model is at natural-language conversation/explanation (0-10). */
  conversation: z.number().min(0).max(10).optional(),
  /** Special capability tags (e.g. native-tool-loop, extensions) beyond free-text strengths. */
  capabilities: z.array(z.string()).optional(),
});
export type ModelCard = z.infer<typeof ModelCardSchema>;

export const HarnessCardSchema = z.object({
  id: HarnessIdSchema,
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  binaries: z.array(z.string()),
  models: z.array(ModelCardSchema).optional(),
  /** How good this harness is at planning/decomposition (0-10). */
  planning: z.number().min(0).max(10).optional(),
  /** How good this harness is at conversational answers (0-10). */
  conversation: z.number().min(0).max(10).optional(),
  /**
   * Distinctive capabilities that routing should honor directly rather than via
   * failover — e.g. Pi's `native-tool-loop` and `extensions`. A step whose
   * requiredCapabilities include one of these is assigned to this harness.
   */
  capabilities: z.array(z.string()).optional(),
});
export type HarnessCard = z.infer<typeof HarnessCardSchema>;

export const RegistrySchema = z.object({
  harnesses: z.array(HarnessCardSchema).min(1),
});
export type Registry = z.infer<typeof RegistrySchema>;
