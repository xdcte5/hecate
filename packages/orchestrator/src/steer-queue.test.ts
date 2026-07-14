import { describe, expect, it } from "vitest";
import { createSteerQueue } from "./steer-queue.js";

describe("SteerQueue", () => {
  it("enqueues and drains messages in order", async () => {
    const queue = createSteerQueue();
    expect(queue.enqueue("first")).toBe(true);
    expect(queue.enqueue("second")).toBe(true);
    expect(queue.size).toBe(2);
    expect(queue.peek()).toEqual(["first", "second"]);

    await expect(queue.waitNext()).resolves.toBe("first");
    await expect(queue.waitNext()).resolves.toBe("second");
    expect(queue.size).toBe(0);
  });

  it("rejects empty messages", () => {
    const queue = createSteerQueue();
    expect(queue.enqueue("   ")).toBe(false);
    expect(queue.size).toBe(0);
  });

  it("delivers to a waiting consumer immediately", async () => {
    const queue = createSteerQueue();
    const next = queue.waitNext();
    expect(queue.enqueue("while running")).toBe(true);
    await expect(next).resolves.toBe("while running");
    expect(queue.size).toBe(0);
  });

  it("returns null on abort while waiting", async () => {
    const queue = createSteerQueue();
    const controller = new AbortController();
    const next = queue.waitNext(controller.signal);
    controller.abort();
    await expect(next).resolves.toBeNull();
  });

  it("clears pending messages and waiters", async () => {
    const queue = createSteerQueue();
    const waiting = queue.waitNext();
    queue.clear();
    expect(queue.size).toBe(0);
    await expect(waiting).resolves.toBeNull();
  });
});
