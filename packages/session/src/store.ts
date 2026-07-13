import crypto from "node:crypto";
import fs from "node:fs/promises";
import type { Decision, HandoffBundle, HarnessId, RhpV1, Todo } from "@relay/schema";
import { emptyRhpV1, RhpV1Schema } from "@relay/schema";
import { atomicWriteFile } from "./_vendor/ide-bridge/atomic-save.js";
import { appendEvent } from "./events.js";
import { captureGitSnapshot } from "./git-snapshot.js";
import { mergeRhpPatch } from "./_vendor/ide-bridge/merge.js";
import {
  activeSessionPath,
  handoffMdPath,
  handoffPath,
  sessionDir,
  sessionPath,
  sessionsRoot,
} from "./paths.js";
import { buildHandoffArtifacts } from "./rhp-builder.js";
import { setActiveSessionId } from "./relay-config.js";

export type SessionStoreOptions = {
  rootDir?: string;
  defaultHarness?: HarnessId;
  includeGitDiffs?: boolean;
};

export type AgentProgress = {
  summary?: string;
  filesTouched?: string[];
};

export class SessionStore {
  private readonly rootDir: string;
  private readonly defaultHarness: HarnessId;
  private readonly includeGitDiffs: boolean;

  constructor(options: SessionStoreOptions = {}) {
    this.rootDir = options.rootDir ?? process.cwd();
    this.defaultHarness = options.defaultHarness ?? "cursor";
    this.includeGitDiffs = options.includeGitDiffs ?? false;
  }

  async start(goal: string): Promise<RhpV1> {
    const sessionId = crypto.randomUUID();
    const session = emptyRhpV1(sessionId, goal, this.defaultHarness);
    await this.save(session);
    await atomicWriteFile(activeSessionPath(this.rootDir), sessionId);
    await setActiveSessionId(this.rootDir, sessionId);
    await appendEvent(this.rootDir, sessionId, {
      event: "session_started",
      goal,
      harness: this.defaultHarness,
    });
    return session;
  }

  /**
   * Spawn an isolated child sub-session under `parentId` (fan-out). The child
   * has its own id, events, and handoff files; the active-session pointer is
   * left untouched so the parent stays active while children run in parallel.
   */
  async startChild(parentId: string, goal: string, harness?: HarnessId): Promise<RhpV1> {
    const parent = await this.requireSession(parentId);
    const childHarness = harness ?? this.defaultHarness;
    const childId = crypto.randomUUID();
    const child: RhpV1 = { ...emptyRhpV1(childId, goal, childHarness), parentId };
    await this.save(child);
    await appendEvent(this.rootDir, childId, {
      event: "child_started",
      goal,
      harness: childHarness,
    });

    const parentUpdate = mergeRhpPatch(parent, {
      childIds: [...(parent.childIds ?? []), childId],
    });
    await this.save(parentUpdate);
    await appendEvent(this.rootDir, parentId, {
      event: "child_spawned",
      childId,
      harness: childHarness,
    });

    return child;
  }

  /**
   * Fold a completed child sub-session back into its parent: decisions are
   * merged (deduped by text) and the child's agent activity is carried over.
   * The child is marked completed.
   */
  async mergeChild(parentId: string, childId: string): Promise<RhpV1> {
    const [parent, child] = await Promise.all([
      this.requireSession(parentId),
      this.requireSession(childId),
    ]);

    const seen = new Set(parent.decisions.map((d) => d.text));
    const newDecisions = child.decisions.filter((d) => !seen.has(d.text));

    const updated = mergeRhpPatch(parent, {
      decisions: [...parent.decisions, ...newDecisions],
      agents: { ...parent.agents, ...child.agents },
    });
    await this.save(updated);

    await this.save(mergeRhpPatch(child, { status: "completed" }));
    await appendEvent(this.rootDir, parentId, {
      event: "child_merged",
      childId,
      mergedDecisions: newDecisions.length,
    });

    return updated;
  }

  /** All product sessions (excluding the active pointer), newest first. */
  async list(): Promise<RhpV1[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(sessionsRoot(this.rootDir));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }

    const sessions = await Promise.all(
      entries.map((entry) => (entry === "active" ? null : this.get(entry).catch(() => null))),
    );
    return sessions
      .filter((session): session is RhpV1 => session !== null)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  /** Make an existing session the active one. */
  async resume(id: string): Promise<RhpV1> {
    const session = await this.requireSession(id);
    await atomicWriteFile(activeSessionPath(this.rootDir), id);
    await setActiveSessionId(this.rootDir, id);
    await appendEvent(this.rootDir, id, {
      event: "session_resumed",
      harness: session.activeHarness,
    });
    return session;
  }

  /** All child sub-sessions spawned from `parentId`, in creation order. */
  async listChildren(parentId: string): Promise<RhpV1[]> {
    const parent = await this.get(parentId);
    if (!parent?.childIds?.length) return [];
    const children = await Promise.all(parent.childIds.map((id) => this.get(id)));
    return children.filter((c): c is RhpV1 => c !== null);
  }

  /**
   * Delete a session's on-disk directory (events, handoff, run-state). Used to
   * tear down ephemeral sessions when the interactive harness quits. Clears the
   * active pointer if it still points at the purged session.
   */
  async purge(id: string): Promise<void> {
    await fs.rm(sessionDir(this.rootDir, id), { recursive: true, force: true });
    try {
      const activeId = (await fs.readFile(activeSessionPath(this.rootDir), "utf8")).trim();
      if (activeId === id) await fs.rm(activeSessionPath(this.rootDir), { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  async getActive(): Promise<RhpV1 | null> {
    try {
      const id = (await fs.readFile(activeSessionPath(this.rootDir), "utf8")).trim();
      return this.get(id);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async get(id: string): Promise<RhpV1 | null> {
    try {
      const raw = await fs.readFile(sessionPath(this.rootDir, id), "utf8");
      return RhpV1Schema.parse(JSON.parse(raw));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async recordDecision(
    id: string,
    text: string,
    rationale?: string,
    harness?: HarnessId,
  ): Promise<RhpV1> {
    const session = await this.requireSession(id);
    const existing = session.decisions.find((d) => d.text === text);
    if (existing) return session;

    const decision: Decision = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      text,
      ...(rationale ? { rationale } : {}),
    };

    const updated = mergeRhpPatch(session, {
      decisions: [...session.decisions, decision],
    });
    await this.save(updated);
    await appendEvent(this.rootDir, id, {
      event: "decision_recorded",
      harness: harness ?? session.activeHarness,
      text,
      ...(rationale ? { rationale } : {}),
    });
    return updated;
  }

  async recordTodo(
    id: string,
    text: string,
    status: Todo["status"] = "pending",
  ): Promise<RhpV1> {
    const session = await this.requireSession(id);
    const todo: Todo = {
      id: crypto.randomUUID(),
      text,
      status,
    };
    const updated = mergeRhpPatch(session, {
      todos: [...session.todos, todo],
    });
    await this.save(updated);
    await appendEvent(this.rootDir, id, {
      event: "todo_recorded",
      text,
      status,
    });
    return updated;
  }

  async recordProgress(id: string, progress: AgentProgress): Promise<RhpV1> {
    const session = await this.requireSession(id);
    const harness = session.activeHarness ?? this.defaultHarness;
    const now = new Date().toISOString();
    const existing = session.agents[harness];
    const updated = mergeRhpPatch(session, {
      agents: {
        [harness]: {
          harness,
          lastActiveAt: now,
          handoffCount: existing?.handoffCount ?? 0,
        },
      },
    });
    await this.save(updated);
    await appendEvent(this.rootDir, id, {
      event: "progress_recorded",
      harness,
      ...progress,
    });
    return updated;
  }

  async prepareHandoff(id: string, to: HarnessId): Promise<HandoffBundle> {
    const session = await this.requireSession(id);
    const git = await captureGitSnapshot(this.rootDir, {
      includeDiffs: this.includeGitDiffs,
    });
    const artifacts = buildHandoffArtifacts(session, to, git ?? undefined);

    const now = new Date().toISOString();
    const sourceHarness = session.activeHarness;
    const updated = mergeRhpPatch(session, {
      activeHarness: to,
      handoffSeq: artifacts.bundle.handoffSeq,
      ...(git ? { git } : {}),
      agents: {
        [to]: {
          harness: to,
          lastActiveAt: now,
          handoffCount: (session.agents[to]?.handoffCount ?? 0) + 1,
        },
        ...(sourceHarness
          ? {
              [sourceHarness]: {
                harness: sourceHarness,
                lastActiveAt: session.agents[sourceHarness]?.lastActiveAt ?? now,
                handoffCount: session.agents[sourceHarness]?.handoffCount ?? 0,
              },
            }
          : {}),
      },
    });

    await this.save(updated);
    await atomicWriteFile(handoffPath(this.rootDir, id), artifacts.handoffJson);
    await atomicWriteFile(handoffMdPath(this.rootDir, id), artifacts.handoffMarkdown);
    await appendEvent(this.rootDir, id, {
      event: "handoff_prepared",
      from: sourceHarness,
      to,
      handoffSeq: artifacts.bundle.handoffSeq,
    });

    return artifacts.bundle;
  }

  private async requireSession(id: string): Promise<RhpV1> {
    const session = await this.get(id);
    if (!session) throw new Error(`Session not found: ${id}`);
    return session;
  }

  private async save(session: RhpV1): Promise<void> {
    await atomicWriteFile(
      sessionPath(this.rootDir, session.sessionId),
      JSON.stringify(session, null, 2),
    );
  }
}
