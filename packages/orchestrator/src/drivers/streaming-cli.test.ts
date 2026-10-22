import { describe, expect, it } from "vitest";
import {
  accumulateUsage,
  parseUsageFromPiEvent,
  parseUsageFromSessionStats,
  parseUsageFromStreamLine,
} from "./streaming-cli.js";

describe("parseUsageFromStreamLine", () => {
  it("parses Claude stream-json result usage", () => {
    const line = JSON.stringify({
      type: "result",
      subtype: "success",
      total_cost_usd: 0.0123,
      usage: { input_tokens: 150, output_tokens: 70 },
    });

    expect(parseUsageFromStreamLine(line)).toEqual({
      inputTokens: 150,
      outputTokens: 70,
      costUsd: 0.0123,
    });
  });

  it("parses Codex turn.completed usage", () => {
    const line = JSON.stringify({
      type: "turn.completed",
      usage: {
        input_tokens: 24763,
        cached_input_tokens: 24448,
        output_tokens: 122,
      },
    });

    expect(parseUsageFromStreamLine(line)).toEqual({
      inputTokens: 24763,
      outputTokens: 122,
    });
  });

  it("returns null for non-usage lines", () => {
    expect(parseUsageFromStreamLine('{"type":"assistant","message":{}}')).toBeNull();
    expect(parseUsageFromStreamLine("plain text")).toBeNull();
    expect(parseUsageFromStreamLine("{not json")).toBeNull();
  });

  it("prefers the latest turn.completed when called repeatedly", () => {
    const first = JSON.stringify({
      type: "turn.completed",
      usage: { input_tokens: 100, output_tokens: 10 },
    });
    const second = JSON.stringify({
      type: "turn.completed",
      usage: { input_tokens: 200, output_tokens: 20 },
    });

    expect(parseUsageFromStreamLine(first)).toEqual({
      inputTokens: 100,
      outputTokens: 10,
    });
    expect(parseUsageFromStreamLine(second)).toEqual({
      inputTokens: 200,
      outputTokens: 20,
    });
  });
});

describe("parseUsageFromSessionStats", () => {
  it("parses authoritative usage from get_session_stats response", () => {
    const response = {
      type: "response",
      command: "get_session_stats",
      success: true,
      data: {
        tokens: { input: 50000, output: 10000, cacheRead: 40000, total: 105000 },
        cost: 0.45,
        contextUsage: { tokens: 60000, contextWindow: 200000, percent: 30 },
      },
    };

    expect(parseUsageFromSessionStats(response)).toEqual({
      inputTokens: 50000,
      outputTokens: 10000,
      costUsd: 0.45,
    });
  });

  it("returns null for failed or malformed session stats responses", () => {
    expect(
      parseUsageFromSessionStats({
        type: "response",
        command: "get_session_stats",
        success: false,
        error: "unavailable",
      }),
    ).toBeNull();
    expect(parseUsageFromSessionStats({ type: "response", command: "prompt", success: true })).toBeNull();
    expect(parseUsageFromSessionStats({ type: "response", command: "get_session_stats", success: true })).toBeNull();
  });
});

describe("parseUsageFromPiEvent", () => {
  it("parses assistant message_end usage from Pi RPC events", () => {
    const event = {
      type: "message_end",
      message: {
        role: "assistant",
        usage: {
          input: 120,
          output: 45,
          cost: {
            total: 0.0025,
          },
        },
      },
    };

    expect(parseUsageFromPiEvent(event)).toEqual({
      inputTokens: 120,
      outputTokens: 45,
      costUsd: 0.0025,
    });
  });

  it("ignores non-assistant message_end events", () => {
    expect(
      parseUsageFromPiEvent({
        type: "message_end",
        message: { role: "user", usage: { input: 10, output: 0 } },
      }),
    ).toBeNull();
  });
});

describe("accumulateUsage", () => {
  it("sums token and cost fields across Pi turns", () => {
    expect(
      accumulateUsage(
        { inputTokens: 100, outputTokens: 20, costUsd: 0.01 },
        { inputTokens: 50, outputTokens: 10, costUsd: 0.005 },
      ),
    ).toEqual({
      inputTokens: 150,
      outputTokens: 30,
      costUsd: 0.015,
    });
  });
});
