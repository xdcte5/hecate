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
  sessionPath,
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
