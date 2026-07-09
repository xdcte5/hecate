import type { HarnessId } from "@relay/schema";
import type { RelaySource } from "./source.js";

/** One file an adapter wants written, path repo-relative with POSIX separators. */
export interface GeneratedFile {
  path: string;
  content: string;
}

/**
 * Cross-cutting context passed into every adapter at build time. Session
 * inject (Sprint 2) rides here so adapters stay pure functions of their input.
 */
export interface BuildContext {
  /**
   * Relative path to the active session's HANDOFF.md, or null when there is
   * no active session. Adapters weave this into their instruction output so a
   * freshly-launched harness reads the current Product Session first.
   */
  handoffPointer: string | null;
}

export const emptyBuildContext: BuildContext = { handoffPointer: null };

/**
 * An adapter transpiles the canonical `relay/` source into one harness's
 * native file layout. Adapters are pure: same source + context ⇒ same files,
 * in deterministic order (required for golden tests).
 */
export interface Adapter {
  readonly harness: HarnessId;
  generate(source: RelaySource, ctx: BuildContext): GeneratedFile[];
}

/**
 * Shared helpers for concrete adapters. Subclasses implement {@link generate}.
 */
export abstract class BaseAdapter implements Adapter {
  abstract readonly harness: HarnessId;
  abstract generate(source: RelaySource, ctx: BuildContext): GeneratedFile[];

  /** Instructions for this harness: per-harness override, else the base file. */
  protected instructionsFor(source: RelaySource): string {
    return source.instructionsByHarness[this.harness] ?? source.instructions ?? "";
  }

  /**
   * Shared session-inject footer for `AGENTS.md`-based harnesses (Codex, Pi).
   * Keeping it identical means both adapters emit a byte-identical `AGENTS.md`
   * from shared instructions, so a `build --all` never conflicts on that path.
   */
  protected agentsSessionFooter(ctx: BuildContext): string | null {
    if (!ctx.handoffPointer) return null;
    return `## Active session\n\nRead \`${ctx.handoffPointer}\` first for current context.`;
  }

  /** Join sections with a single blank line, trimming trailing whitespace. */
  protected joinSections(...sections: Array<string | null | undefined>): string {
    const body = sections
      .map((s) => (s ?? "").replace(/\s+$/, ""))
      .filter((s) => s.length > 0)
      .join("\n\n");
    return body.length > 0 ? `${body}\n` : "";
  }
}
