import { afterEach, describe, expect, test } from "bun:test";
import { NativeUI } from "../../src/native-ui";

afterEach(() => NativeUI.closeAll());

describe("NativeUI", () => {
  test("updates a contextual surface in place", () => {
    const opened = NativeUI.open({
      id: "progress",
      kind: "popover",
      title: "Analyzing",
      controls: [],
      dismissible: true,
      anchor: { x: 0, y: 0, width: 0, height: 0 },
      placement: "bottom",
      metadata: { sessionID: "session-1", agent: "build" },
    });
    const updated = NativeUI.update({ ...opened, title: "Testing" });
    expect(NativeUI.list()).toEqual([updated]);
  });

  test("resolves waits from native host actions", async () => {
    const pending = NativeUI.wait(
      (event) => event.type === "control-activated",
      { timeoutMs: 500 },
    );
    NativeUI.dispatch({
      type: "control-activated",
      surfaceId: "review",
      controlId: "approve",
      action: { type: "invoke", action: "approve" },
    });
    expect(await pending).toMatchObject({
      type: "control-activated",
      controlId: "approve",
    });
  });
});
