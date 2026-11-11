import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import type {
  PluginContext,
  PluginApiRequestInput,
} from "@paperclipai/plugin-sdk";
import { createService } from "../src/service.js";
import {
  candidate,
  editTask,
  makeTask,
  mergeTask,
  source,
} from "../src/model.js";
import manifest from "../src/manifest.js";
import { pluginManifestV1Schema } from "@paperclipai/shared";
let db: PGlite, service: ReturnType<typeof createService>;
const ns = "plugin_personal_todo_f8dc7ec3ac",
  scope = { companyId: "org-a", userId: "owner-a" };
const input = {
  provider: "outlook",
  tasks: [
    {
      title: "Prüfe die Freigabe",
      sourceKey: "message-1:action-1",
      taskKey: "release-approval",
      area: "software",
      due: "2020-12-01",
      source: {
        title: "Projektfreigabe",
        date: "2020-11-10",
        externalId: "message-1",
      },
    },
  ],
};
const context = {
  db: {
    namespace: ns,
    query: async (sql: string, params?: unknown[]) =>
      (await db.query(sql, params)).rows,
    execute: async (sql: string, params?: unknown[]) => ({
      rowCount: (await db.query(sql, params)).affectedRows ?? 0,
    }),
  },
  streams: { open: vi.fn(), emit: vi.fn() },
  activity: { log: vi.fn(async () => {}) },
  agents: {
    list: vi.fn(async () => []),
    get: vi.fn(async (id: string) => ({ id, status: "idle" })),
  },
  routines: {
    managed: {
      reconcile: vi.fn(async () => ({ routineId: "routine-1" })),
      get: vi.fn(async () => ({
        routine: { id: "routine-1", status: "paused" },
      })),
      update: vi.fn(async () => ({ id: "routine-1", status: "active" })),
      run: vi.fn(async () => ({ id: "run-1" })),
    },
  },
} as unknown as PluginContext;
beforeAll(async () => {
  db = new PGlite();
  await db.exec("CREATE SCHEMA " + ns);
  await db.exec(
    await readFile(
      new URL("../migrations/001_tasks.sql", import.meta.url),
      "utf8",
    ),
  );
}, 30000);
beforeEach(async () => {
  await db.exec(`TRUNCATE ${ns}.tasks,${ns}.boards,${ns}.source_state`);
  service = createService(context);
});
afterAll(async () => {
  await db.close();
});
describe("persistent personal tasks", () => {
  it("supports the authenticated CLI import contract and tracks its run", async () => {
    await service.command(scope, { op: "configure", agentId: "agent-a" });
    const request = {
      companyId: scope.companyId,
      actor: {
        actorType: "agent",
        actorId: "agent-a",
        agentId: "agent-a",
        runId: "run-a",
      },
      query: {},
    } as PluginApiRequestInput;
    const snapshot = (await service.api({
      ...request,
      routeKey: "snapshot",
    })) as { sources: { status: string }[] };
    expect(snapshot.sources.every((s) => s.status === "running")).toBe(true);
    await service.api({
      ...request,
      routeKey: "command",
      body: { op: "ingest", ...input },
    });
    await service.api({
      ...request,
      routeKey: "command",
      body: {
        op: "report",
        provider: "outlook",
        status: "partial",
        message: "Weitere Seiten offen",
      },
    });
    const next = await service.snapshot(scope);
    expect(next.tasks).toHaveLength(1);
    expect(next.sources.find((s) => s.provider === "outlook")).toMatchObject({
      status: "partial",
      runId: "run-a",
    });
  });
  it("fences stale source reports and keeps successful coverage across new runs", async () => {
    await service.report(scope, {
      provider: "fyxer",
      status: "ok",
      message: "Gelesen",
      coverageFrom: "2020-01-01T00:00:00Z",
      coverageTo: "2020-01-02T00:00:00Z",
    });
    await service.beginRun(scope, "old-run");
    await service.beginRun(scope, "new-run");
    await expect(
      service.report(
        scope,
        { provider: "fyxer", status: "error", message: "alt" },
        "old-run",
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (await service.snapshot(scope)).sources.find(
        (s) => s.provider === "fyxer",
      ),
    ).toMatchObject({
      status: "running",
      lastSuccessAt: "2020-01-02T00:00:00.000Z",
    });
  });
  it("rejects empty tasks even when the title property is omitted", async () => {
    await expect(
      service.command(scope, { op: "create", task: {} }),
    ).rejects.toMatchObject({ status: 400 });
    expect(await service.tasks(scope)).toHaveLength(0);
  });
  it("stores one document per task, deduplicates retries and merges source mentions", async () => {
    await service.ingest(scope, input);
    await service.ingest(scope, input);
    await service.ingest(scope, {
      provider: "fyxer",
      tasks: [
        {
          ...input.tasks[0],
          sourceKey: "recording-1:item-2",
          source: { title: "Projektbesprechung", date: "2020-11-11" },
          hint: "Freigabe wartet auf dich",
        },
      ],
    });
    const tasks = await service.tasks(scope);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].doc_id).toMatch(/^m-\d{8}-01$/);
    expect(tasks[0].sourceKeys).toHaveLength(2);
    expect(tasks[0].sources).toHaveLength(1);
    expect(tasks[0].hint).toBe("Freigabe wartet auf dich");
  });
  it("preserves personal edits, notes and completion across imports and worker restart", async () => {
    await service.ingest(scope, input);
    let t = (await service.tasks(scope))[0];
    await service.command(scope, {
      op: "update",
      doc_id: t.doc_id,
      revision: t.revision,
      patch: {
        note: "Meine Überlegung",
        prio: 1,
        status: "done",
        area: "data",
      },
    });
    await service.ingest(scope, {
      provider: "teams",
      tasks: [
        {
          ...input.tasks[0],
          sourceKey: "chat-1:item-1",
          prio: 3,
          status: "open",
          area: "finance",
          note: "replace",
          hint: "Neuer belegter Stand",
        },
      ],
    });
    t = (await createService(context).tasks(scope))[0];
    expect(t).toMatchObject({
      note: "Meine Überlegung",
      prio: 1,
      status: "done",
      area: "data",
      areaAuto: false,
      autoDone: false,
      hint: "Neuer belegter Stand",
    });
  });
  it("isolates users and companies, ignoring caller-supplied user IDs", async () => {
    await service.ingest(scope, input);
    expect(await service.tasks({ ...scope, userId: "another-user" })).toEqual(
      [],
    );
    expect(
      await service.tasks({ ...scope, companyId: "another-company" }),
    ).toEqual([]);
    const response = (await service.api({
      routeKey: "snapshot",
      companyId: "org-a",
      actor: { actorType: "user", actorId: "user-b", userId: "user-b" },
      query: { userId: "owner-a" },
      body: { userId: "owner-a" },
    } as unknown as PluginApiRequestInput)) as { tasks: unknown[] };
    expect(response.tasks).toEqual([]);
    await expect(
      service.collector("org-a", "unassigned"),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("binds only the selected collector and prevents agent-driven manual edits", async () => {
    await service.command(scope, { op: "configure", agentId: "agent-a" });
    expect(await service.collector("org-a", "agent-a")).toEqual(scope);
    await expect(service.collector("org-b", "agent-a")).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      service.api({
        routeKey: "command",
        companyId: "org-a",
        actor: { actorType: "agent", actorId: "agent-a", agentId: "agent-a" },
        body: { op: "create", task: { title: "spoof" } },
      } as PluginApiRequestInput),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("rejects stale browser edits instead of overwriting concurrent work", async () => {
    const t = (await service.command(scope, {
      op: "create",
      task: { title: "Prüfe den Bericht" },
    })) as { doc_id: string; revision: number };
    const results = await Promise.allSettled([
      service.command(scope, {
        op: "update",
        doc_id: t.doc_id,
        revision: t.revision,
        patch: { note: "A" },
      }),
      service.command(scope, {
        op: "update",
        doc_id: t.doc_id,
        revision: t.revision,
        patch: { note: "B" },
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      (results.find((r) => r.status === "rejected") as PromiseRejectedResult)
        .reason.status,
    ).toBe(409);
  });
  it("requires explicit evidence for automatic completion and never reopens completed work", async () => {
    await service.ingest(scope, {
      provider: "outlook",
      tasks: [{ ...input.tasks[0], status: "done" }],
    });
    let t = (await service.tasks(scope))[0];
    expect(t.status).toBe("open");
    await service.ingest(scope, {
      provider: "outlook",
      tasks: [
        {
          ...input.tasks[0],
          status: "done",
          completionEvidence: "Bestätigte Erledigung in Nachricht 2",
        },
      ],
    });
    await service.ingest(scope, {
      provider: "outlook",
      tasks: [{ ...input.tasks[0], status: "open" }],
    });
    t = (await service.tasks(scope))[0];
    expect(t.status).toBe("done");
    expect(t.autoDone).toBe(true);
    expect(t.doneAt).toBeTruthy();
  });
  it("does not advance source coverage after errors or incomplete searches", async () => {
    const base = {
      provider: "fyxer",
      coverageFrom: "2020-11-01T00:00:00Z",
      coverageTo: "2020-11-10T23:59:59Z",
      message: "Vollständig gelesen",
    };
    await service.report(scope, { ...base, status: "ok" });
    await service.report(scope, {
      ...base,
      status: "partial",
      coverageTo: "2020-11-11T23:59:59Z",
      message: "Suchlimit erreicht",
    });
    const s = await service.snapshot(scope);
    expect(s.sources.find((s) => s.provider === "fyxer")).toMatchObject({
      status: "partial",
      lastSuccessAt: "2020-11-10T23:59:59.000Z",
    });
    expect(s.allSourcesOk).toBe(false);
    expect(s.sources.find((s) => s.provider === "outlook")?.status).toBe(
      "never",
    );
    await expect(
      service.report(scope, {
        provider: "outlook",
        status: "ok",
        message: "ok",
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it("serializes duplicate candidates in one batch without duplicate documents", async () => {
    await service.ingest(scope, {
      provider: "outlook",
      tasks: [
        input.tasks[0],
        { ...input.tasks[0], hint: "Zusätzlicher Stand" },
      ],
    });
    expect(await service.tasks(scope)).toHaveLength(1);
    await service.ingest(scope, {
      provider: "outlook",
      tasks: [input.tasks[0], input.tasks[0]],
    });
    expect(await service.tasks(scope)).toHaveLength(1);
  });
  it("validates the full batch before writing, and rejects foreign existing IDs", async () => {
    await expect(
      service.ingest(scope, {
        provider: "outlook",
        tasks: [input.tasks[0], { ...input.tasks[0], due: "2020-02-30" }],
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(await service.tasks(scope)).toEqual([]);
    await expect(
      service.ingest(scope, {
        provider: "fyxer",
        tasks: [{ ...input.tasks[0], existingId: "foreign-id" }],
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
describe("task validation", () => {
  it("normalizes provider timestamps and source links without relaxing due-date validation", () => {
    expect(
      source({
        title: "Besprechung",
        date: "2020-11-10T23:30:00Z",
        link: "https://example.com/source",
      }),
    ).toMatchObject({ date: "2020-11-11", url: "https://example.com/source" });
    expect(() =>
      makeTask(
        "id",
        { title: "Prüfe X", due: "2020-11-10T23:30:00Z" },
        "2020-11-10T00:00:00Z",
      ),
    ).toThrow();
  });
  it("passes the host manifest validator", () => {
    expect(pluginManifestV1Schema.safeParse(manifest).success).toBe(true);
  });
  it("rejects executable or malformed source URLs", () => {
    expect(() =>
      source({ title: "mail", date: "2020-01-01", url: "javascript:alert(1)" }),
    ).toThrow();
    expect(() => source({ title: "mail", date: "2020-02-30" })).toThrow();
  });
  it("enforces delegated ownership and delegated statuses", () => {
    expect(() =>
      makeTask(
        "id",
        { title: "Prüfe X", kind: "delegated" },
        "2020-01-01T00:00:00Z",
      ),
    ).toThrow();
    const t = makeTask(
      "id",
      { title: "Prüfe X", kind: "delegated", owner: "Alex" },
      "2020-01-01T00:00:00Z",
    );
    expect(t.category).toBeUndefined();
    expect(() =>
      editTask(t, { status: "doing" }, "2020-01-02T00:00:00Z"),
    ).toThrow();
  });
  it("does not let old source evidence overwrite newer hints", () => {
    const now = "2020-11-11T00:00:00Z",
      t = makeTask(
        "id",
        {
          title: "Prüfe X",
          hint: "Neu",
          source: { title: "A", date: "2020-11-11" },
        },
        now,
      );
    const c = candidate({
      ...input.tasks[0],
      hint: "Alt",
      source: { title: "B", date: "2020-11-10" },
    });
    expect(mergeTask(t, c, now).hint).toBe("Neu");
  });
  it("declares each independent source in the actual routine instructions", () => {
    const prompt = manifest.routines![0].description!;
    for (const name of [
      "Outlook",
      "Teams",
      "Fyxer",
      "report_source",
      "upsert_tasks",
    ])
      expect(prompt).toContain(name);
  });
});
