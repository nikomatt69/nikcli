import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { Database } from "@/database/database";
import { Sync, type SyncEventRecord } from "@/sync";
import { SyncProjector, type WorkspaceState } from "@/sync/projector";
import { SyncSnapshot } from "@/sync/snapshot";
import { SyncReducer } from "@/sync/reducer";
import { Outbox } from "@/sync/outbox";
import { syncSnapshot } from "@/sync/sync.sql";
import { and, eq } from "drizzle-orm";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let tempDir: string;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "nikcli-sync-test-"));
  process.env.NIKCLI_DB = join(tempDir, "test.db");
  process.env.XDG_DATA_HOME = tempDir;
  // Force a fresh open
  (Database as any)._singleton = undefined;
});

afterAll(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

describe("Sync — unified event log", () => {
  it("emitRaw appends to sync_event and assigns a monotonic seq", async () => {
    const projectID = "test_proj_seq";
    const aggregate = "wrk_test_seq";

    const e1 = await Sync.emitRaw(projectID, aggregate, {
      type: "workspace.test",
      i: 0,
    });
    const e2 = await Sync.emitRaw(projectID, aggregate, {
      type: "workspace.test",
      i: 1,
    });
    const e3 = await Sync.emitRaw(projectID, aggregate, {
      type: "workspace.test",
      i: 2,
    });

    expect(e1.seq).toBe(1);
    expect(e2.seq).toBe(2);
    expect(e3.seq).toBe(3);

    const events = await Sync.readAggregate(aggregate);
    expect(events).toHaveLength(3);
  });

  it("stamps workspace_id / origin / origin_seq on append", async () => {
    const projectID = "test_proj_stamp";
    const aggregate = "wrk_stamp";

    const e = await Sync.emitRaw(
      projectID,
      aggregate,
      { type: "workspace.created" },
      { workspaceID: aggregate, origin: "remote:cli-1", originSeq: 42 },
    );
    expect(e.id).toBeTruthy();
    // Read back from DB
    const events = await Sync.getEvents(projectID, aggregate);
    expect(events).toHaveLength(1);
    const row = events[0];
    expect(row.workspaceId).toBe(aggregate);
    expect(row.origin).toBe("remote:cli-1");
    expect(row.originSeq).toBe(42);
  });
});

describe("SyncProjector — pure reducer", () => {
  it("workspace projector updates state on workspace.created", () => {
    const initial: WorkspaceState = {
      id: "wrk_x",
      projectID: "proj_x",
      name: "",
      branch: null,
      config: null,
      lastTouchedAt: 0,
    };
    const event: SyncEventRecord = {
      id: "syn_1",
      projectId: "proj_x",
      aggregate: "wrk_x",
      seq: 1,
      type: "raw",
      data: {
        type: "workspace.created",
        name: "my-workspace",
        branch: "main",
        config: { type: "worktree", directory: "/tmp" },
      },
      timestamp: 1000,
    };
    const next = SyncProjector.workspace(initial, event);
    expect(next.name).toBe("my-workspace");
    expect(next.branch).toBe("main");
    expect(next.lastTouchedAt).toBe(1000);
  });

  it("ignores unknown event types", () => {
    const initial: WorkspaceState = {
      id: "wrk_x",
      projectID: "proj_x",
      name: "preset",
      branch: null,
      config: null,
      lastTouchedAt: 0,
    };
    const event: SyncEventRecord = {
      id: "syn_1",
      projectId: "proj_x",
      aggregate: "wrk_x",
      seq: 1,
      type: "raw",
      data: { type: "unknown.event" },
      timestamp: 9999,
    };
    const next = SyncProjector.workspace(initial, event);
    expect(next).toEqual(initial);
  });
});

describe("SyncReducer — replay with snapshot cache", () => {
  it("replays from seq=0 when no snapshot exists", async () => {
    const projectID = "test_proj_replay";
    const aggregate = "wrk_replay";

    await Sync.emitRaw(projectID, aggregate, {
      type: "workspace.created",
      name: "alpha",
    });
    await Sync.emitRaw(projectID, aggregate, {
      type: "workspace.statusChanged",
      status: "connected",
    });

    const { state, lastSeq } =
      await SyncReducer.replayWithSnapshot<WorkspaceState>(
        { projectID, aggregate, aggregateID: aggregate },
        {
          id: aggregate,
          projectID,
          name: "",
          branch: null,
          config: null,
          lastTouchedAt: 0,
        },
        [SyncProjector.workspace],
      );
    expect(state.name).toBe("alpha");
    expect(state.status).toBe("connected");
    expect(lastSeq).toBeGreaterThanOrEqual(2);
  });

  it("skips already-replayed events via snapshot", async () => {
    const projectID = "test_proj_snapshot";
    const aggregate = "wrk_snapshot";
    const key = { projectID, aggregate, aggregateID: aggregate };

    // First 3 events
    await Sync.emitRaw(projectID, aggregate, {
      type: "workspace.created",
      name: "beta",
    });
    await Sync.emitRaw(projectID, aggregate, {
      type: "workspace.statusChanged",
      status: "connected",
    });
    await Sync.emitRaw(projectID, aggregate, {
      type: "workspace.statusChanged",
      status: "error",
    });

    // Cold-start replay
    const first = await SyncReducer.replayWithSnapshot<WorkspaceState>(
      key,
      {
        id: aggregate,
        projectID,
        name: "",
        branch: null,
        config: null,
        lastTouchedAt: 0,
      },
      [SyncProjector.workspace],
    );
    expect(first.state.status).toBe("error");
    expect(first.lastSeq).toBe(3);

    // 4th event after the snapshot
    await Sync.emitRaw(projectID, aggregate, {
      type: "workspace.statusChanged",
      status: "connected",
    });

    // Replay again — should only see the 4th event because of the snapshot
    const second = await SyncReducer.replayWithSnapshot<WorkspaceState>(
      key,
      {
        id: aggregate,
        projectID,
        name: "",
        branch: null,
        config: null,
        lastTouchedAt: 0,
      },
      [SyncProjector.workspace],
    );
    expect(second.state.status).toBe("connected");
    expect(second.lastSeq).toBe(4);
  });

  it("falls back to full replay on snapshot corruption", async () => {
    const projectID = "test_proj_corrupt";
    const aggregate = "wrk_corrupt";
    const key = { projectID, aggregate, aggregateID: aggregate };

    await Sync.emitRaw(projectID, aggregate, {
      type: "workspace.created",
      name: "gamma",
    });
    // Manually corrupt the snapshot row in the DB
    const db = Database.syncDb();
    db.update(syncSnapshot)
      .set({ state: "not-json{" })
      .where(
        and(
          eq(syncSnapshot.projectId, projectID),
          eq(syncSnapshot.aggregate, aggregate),
          eq(syncSnapshot.aggregateId, aggregate),
        ),
      )
      .run();

    const { state } = await SyncReducer.replayWithSnapshot<WorkspaceState>(
      key,
      {
        id: aggregate,
        projectID,
        name: "",
        branch: null,
        config: null,
        lastTouchedAt: 0,
      },
      [SyncProjector.workspace],
    );
    expect(state.name).toBe("gamma");
  });
});

describe("Outbox — pending push queue", () => {
  it("enqueues and reports counts", () => {
    const target = "https://s.nikcli.store";
    Outbox.enqueue("syn_aaa", target);
    Outbox.enqueue("syn_bbb", target);
    Outbox.enqueue("syn_ccc", target);

    const status = Outbox.status(target);
    expect(status.pending).toBeGreaterThanOrEqual(3);
  });

  it("is idempotent on (eventId, target)", () => {
    const target = "https://s.nikcli.store";
    const before = Outbox.status(target).pending;
    Outbox.enqueue("syn_idempotent", target);
    Outbox.enqueue("syn_idempotent", target);
    Outbox.enqueue("syn_idempotent", target);
    const after = Outbox.status(target).pending;
    expect(after - before).toBe(1);
  });

  it("drain marks sent on successful push", async () => {
    const target = "https://s.nikcli.store";
    const eventId = "syn_drain_test";
    Outbox.enqueue(eventId, target);

    const result = await Outbox.drain(target, async () => ({ ok: true }), 10);
    expect(result.sent).toBeGreaterThanOrEqual(1);
  });
});
