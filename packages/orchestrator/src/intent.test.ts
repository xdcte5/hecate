import { describe, expect, it } from "vitest";
import { classifyIntent } from "./intent.js";

describe("classifyIntent", () => {
  it("treats explanations and questions as chat", () => {
    expect(classifyIntent("explain this to me").intent).toBe("chat");
    expect(classifyIntent("what does this function do?").intent).toBe("chat");
    expect(classifyIntent("how does the router pick a model?").intent).toBe("chat");
    expect(classifyIntent("summarize the codebase").intent).toBe("chat");
  });

  it("treats imperative build/fix work as work", () => {
    expect(classifyIntent("build a portfolio site").intent).toBe("work");
    expect(classifyIntent("fix the failing test").intent).toBe("work");
    expect(classifyIntent("add an auth endpoint").intent).toBe("work");
    expect(classifyIntent("refactor the session store").intent).toBe("work");
  });

  it("prefers work when a question also demands a change", () => {
    expect(classifyIntent("why is login broken, fix it").intent).toBe("work");
  });

  it("defaults ambiguous prompts to work", () => {
    expect(classifyIntent("the navbar on mobile").intent).toBe("work");
  });
});
