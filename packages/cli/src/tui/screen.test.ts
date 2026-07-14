import { describe, expect, it } from "vitest";
import { AltScreen, defaultScreenSize } from "./screen.js";

describe("AltScreen", () => {
  it("reports default screen size with sane minimums", () => {
    const size = defaultScreenSize();
    expect(size.cols).toBeGreaterThanOrEqual(40);
    expect(size.rows).toBeGreaterThanOrEqual(12);
  });

  it("starts inactive until enter is called", () => {
    const screen = new AltScreen();
    expect(screen.isActive()).toBe(false);
  });

  it("tracks active state through enter and exit", () => {
    const writes: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    const screen = new AltScreen();
    screen.enter();
    expect(screen.isActive()).toBe(true);
    expect(writes.some((w) => w.includes("\x1b[?1049h"))).toBe(true);

    screen.exit();
    expect(screen.isActive()).toBe(false);
    expect(writes.some((w) => w.includes("\x1b[?1049l"))).toBe(true);

    process.stdout.write = original;
  });
});
