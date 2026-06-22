import { describe, expect, it } from "bun:test";

describe("Workspace lifecycle", () => {
  it("does not add duplicate SIGTERM handlers when the module is imported again", async () => {
    await import("../../src/workspace/index");
    const afterFirst = process.listenerCount("SIGTERM");
    await import("../../src/workspace/index");
    expect(process.listenerCount("SIGTERM")).toBe(afterFirst);
  });
});
