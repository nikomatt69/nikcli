import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it } from "bun:test";

const testDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-sync-catchup-"));
process.env.NIKCLI_TEST_HOME ??= testDir;
process.env.NIKCLI_DB ??= path.join(testDir, "nikcli.db");

const { Sync, SyncStorage } = await import("@/sync");

// Unique ids per run so the assertions hold even when the process-wide
// database singleton was already opened by another test file.
const run = Math.random().toString(36).slice(2);
const projectID = `proj_sync_catchup_${run}`;

afterAll(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

describe("Sync — incremental catch-up (workspace journal)", () => {
  it("returns only events past fromSeq, in order", async () => {
    const workspaceID = `wrk_${run}_catchup`;

    for (let i = 1; i <= 4; i++) {
      await Sync.emitRaw(projectID, workspaceID, {
        type: "session.status",
        properties: { sessionID: `s${i}` },
      });
    }

    const all = await SyncStorage.getEvents(projectID, workspaceID);
    expect(all.map((record) => record.seq)).toEqual([1, 2, 3, 4]);

    const tail = await SyncStorage.getEvents(projectID, workspaceID, 2);
    expect(tail.map((record) => record.seq)).toEqual([3, 4]);
    expect(tail.map((record) => (record.data as any).properties.sessionID)).toEqual(["s3", "s4"]);
  });

  it("scopes catch-up to the aggregate", async () => {
    const first = `wrk_${run}_a`;
    const second = `wrk_${run}_b`;

    await Sync.emitRaw(projectID, first, { type: "session.created", properties: { id: "a" } });
    await Sync.emitRaw(projectID, second, { type: "session.created", properties: { id: "b" } });

    const events = await SyncStorage.getEvents(projectID, first);
    expect(events).toHaveLength(1);
    expect((events[0].data as any).properties.id).toBe("a");
  });
});
