/** Queue follow-up messages while a harness step is running (Pi steer RPC). */
export class SteerQueue {
  private readonly queue: string[] = [];
  private readonly waiters: Array<(message: string | null) => void> = [];

  /** Enqueue a steer message. Returns false if empty after trim. */
  enqueue(message: string): boolean {
    const trimmed = message.trim();
    if (!trimmed) return false;

    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(trimmed);
    } else {
      this.queue.push(trimmed);
    }
    return true;
  }

  /** Pending messages not yet consumed by a driver. */
  get size(): number {
    return this.queue.length;
  }

  /** Snapshot of queued messages (oldest first). */
  peek(): readonly string[] {
    return [...this.queue];
  }

  /** Wait for the next steer message, or null when aborted. */
  waitNext(signal?: AbortSignal): Promise<string | null> {
    if (this.queue.length > 0) {
      return Promise.resolve(this.queue.shift()!);
    }

    if (signal?.aborted) {
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      const finish = (message: string | null) => {
        signal?.removeEventListener("abort", onAbort);
        resolve(message);
      };

      const onAbort = () => finish(null);

      signal?.addEventListener("abort", onAbort, { once: true });
      this.waiters.push(finish);
    });
  }

  /** Drop all pending messages and reject waiters. */
  clear(): void {
    this.queue.length = 0;
    for (const waiter of this.waiters.splice(0)) {
      waiter(null);
    }
  }
}

export function createSteerQueue(): SteerQueue {
  return new SteerQueue();
}
