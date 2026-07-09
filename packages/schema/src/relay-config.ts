import { z } from "zod";

export const RelayConfigSchema = z.object({
  version: z.literal("1").default("1"),
  activeSessionId: z.string().optional(),
});
export type RelayConfig = z.infer<typeof RelayConfigSchema>;

export function emptyRelayConfig(): RelayConfig {
  return { version: "1" };
}
