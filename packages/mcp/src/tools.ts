import type { HandoffBundle, HarnessId, Registry, RhpV1 } from "@relay/schema";
import { HarnessIdSchema } from "@relay/schema";
import { SessionStore } from "@relay/session";
import { loadRegistry } from "@relay/registry";

/**
 * Pure tool handlers for the relay-mcp mesh fabric. Each takes a project root
 * and typed args, calls into the Mesh Brain packages (`@relay/session`,
 * `@relay/registry`), and returns plain data. The stdio server wraps these;
 * keeping them SDK-free makes the fabric unit-testable.
 */

export interface ToolContext {
  rootDir: string;
}

function store(ctx: ToolContext): SessionStore {
  return new SessionStore({ rootDir: ctx.rootDir });
}

async function resolveSession(ctx: ToolContext, sessionId?: string): Promise<RhpV1> {
  const s = store(ctx);
  const session = sessionId ? await s.get(sessionId) : await s.getActive();
  if (!session) {
    throw new Error(
      sessionId ? `No session found: ${sessionId}` : "No active session. Run `relay session start`.",
    );
  }
  return session;
}

export interface SessionGetArgs {
  sessionId?: string;
}
export async function sessionGet(ctx: ToolContext, args: SessionGetArgs = {}): Promise<RhpV1> {
  return resolveSession(ctx, args.sessionId);
}

export interface RecordDecisionArgs {
  text: string;
  rationale?: string;
  sessionId?: string;
}
export async function sessionRecordDecision(
  ctx: ToolContext,
  args: RecordDecisionArgs,
): Promise<RhpV1> {
  const session = await resolveSession(ctx, args.sessionId);
  return store(ctx).recordDecision(session.sessionId, args.text, args.rationale);
}

export interface RecordProgressArgs {
  summary?: string;
  filesTouched?: string[];
  sessionId?: string;
}
export async function sessionRecordProgress(
  ctx: ToolContext,
  args: RecordProgressArgs,
): Promise<RhpV1> {
  const session = await resolveSession(ctx, args.sessionId);
  const progress: { summary?: string; filesTouched?: string[] } = {};
  if (args.summary !== undefined) progress.summary = args.summary;
  if (args.filesTouched !== undefined) progress.filesTouched = args.filesTouched;
  return store(ctx).recordProgress(session.sessionId, progress);
}

export interface HandoffPrepareArgs {
  to: HarnessId;
  sessionId?: string;
}
export async function handoffPrepare(
  ctx: ToolContext,
  args: HandoffPrepareArgs,
): Promise<HandoffBundle> {
  const to = HarnessIdSchema.parse(args.to);
  const session = await resolveSession(ctx, args.sessionId);
  return store(ctx).prepareHandoff(session.sessionId, to);
}

export async function registryList(ctx: ToolContext): Promise<Registry> {
  return loadRegistry(ctx.rootDir);
}
