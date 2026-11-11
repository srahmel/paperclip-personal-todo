import { randomUUID } from "node:crypto";
import type {
  PluginContext,
  PluginApiRequestInput,
} from "@paperclipai/plugin-sdk";
import {
  BoardError,
  candidate,
  editTask,
  localDay,
  makeTask,
  mergeTask,
  object,
  PROVIDERS,
  text,
  type Provider,
  type SourceState,
  type Task,
} from "./model.js";
type Scope = { companyId: string; userId: string };
type Board = {
  company_id: string;
  user_id: string;
  collector_agent_id: string | null;
  routine_id: string | null;
};
export function createService(ctx: PluginContext) {
  const ns = ctx.db.namespace;
  if (!/^plugin_[a-z0-9_]+$/.test(ns))
    throw new Error("Invalid database namespace");
  const queues = new Map<string, Promise<unknown>>();
  async function serial<T>(s: Scope, fn: () => Promise<T>): Promise<T> {
    const key = s.companyId + ":" + s.userId;
    const previous = queues.get(key) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(fn);
    queues.set(key, next);
    try {
      return await next;
    } finally {
      if (queues.get(key) === next) queues.delete(key);
    }
  }
  const args = (s: Scope) => [s.companyId, s.userId];
  async function board(s: Scope) {
    return (
      (
        await ctx.db.query<Board>(
          `SELECT * FROM ${ns}.boards WHERE company_id=$1 AND user_id=$2`,
          args(s),
        )
      )[0] ?? null
    );
  }
  async function ensure(s: Scope) {
    await ctx.db.execute(
      `INSERT INTO ${ns}.boards(company_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      args(s),
    );
  }
  async function tasks(s: Scope) {
    return (
      await ctx.db.query<{ data: Task }>(
        `SELECT data FROM ${ns}.tasks WHERE company_id=$1 AND user_id=$2 ORDER BY doc_id`,
        args(s),
      )
    ).map((r) => r.data);
  }
  async function sources(s: Scope) {
    const rows = await ctx.db.query<{ data: SourceState }>(
      `SELECT data FROM ${ns}.source_state WHERE company_id=$1 AND user_id=$2`,
      args(s),
    );
    return PROVIDERS.map(
      (provider) =>
        rows.find((r) => r.data.provider === provider)?.data ??
        ({
          provider,
          status: "never",
          message: "Noch nicht geprüft",
        } as SourceState),
    ).map((state) =>
      state.status === "running" &&
      state.checkedAt &&
      Date.now() - Date.parse(state.checkedAt) > 30 * 60 * 1000
        ? {
            ...state,
            status: "error" as const,
            message:
              "Der Import hat für diese Quelle noch keinen Abschluss gemeldet. Bitte prüfe den Routine-Lauf.",
          }
        : state,
    );
  }
  async function beginRun(s: Scope, runId: string) {
    return serial(s, async () => {
      const states = await sources(s);
      if (states.some((state) => state.runId === runId)) return;
      const checkedAt = new Date().toISOString();
      for (const old of states) {
        const state: SourceState = {
          ...old,
          status: "running",
          runId,
          checkedAt,
          message: "Im aktuellen Import noch nicht abgeschlossen.",
        };
        await ctx.db.execute(
          `INSERT INTO ${ns}.source_state(company_id,user_id,provider,data) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(company_id,user_id,provider) DO UPDATE SET data=EXCLUDED.data`,
          [...args(s), state.provider, JSON.stringify(state)],
        );
      }
      changed(s);
    });
  }
  async function collector(companyId: string, agentId: string): Promise<Scope> {
    const b = (
      await ctx.db.query<Board>(
        `SELECT * FROM ${ns}.boards WHERE company_id=$1 AND collector_agent_id=$2`,
        [companyId, agentId],
      )
    )[0];
    if (!b)
      throw new BoardError(
        403,
        "Dieser Agent ist für kein persönliches Board freigegeben.",
      );
    return { companyId, userId: b.user_id };
  }
  function changed(s: Scope) {
    ctx.streams.open("tasks-" + s.companyId, s.companyId);
    ctx.streams.emit("tasks-" + s.companyId, { type: "changed" });
  }
  async function save(s: Scope, t: Task, previous?: number) {
    if (previous === undefined) {
      await ctx.db.execute(
        `INSERT INTO ${ns}.tasks(company_id,user_id,doc_id,revision,data) VALUES($1,$2,$3,$4,$5::jsonb)`,
        [...args(s), t.doc_id, t.revision, JSON.stringify(t)],
      );
    } else {
      const r = await ctx.db.execute(
        `UPDATE ${ns}.tasks SET revision=$4,data=$5::jsonb WHERE company_id=$1 AND user_id=$2 AND doc_id=$3 AND revision=$6`,
        [...args(s), t.doc_id, t.revision, JSON.stringify(t), previous],
      );
      if (r.rowCount !== 1)
        throw new BoardError(
          409,
          "Die Aufgabe wurde inzwischen geändert. Lade sie neu und versuche es erneut.",
        );
    }
  }
  async function audit(s: Scope, action: string) {
    await ctx.activity.log({
      companyId: s.companyId,
      message: action,
      entityType: "personal-todo",
      metadata: { ownerUserId: s.userId },
    });
  }
  async function snapshot(s: Scope, includeAgents = false) {
    const [items, states, b] = await Promise.all([
      tasks(s),
      sources(s),
      board(s),
    ]);
    let routine = null;
    if (b?.routine_id) {
      try {
        const r = await ctx.routines.managed.get("morning-brief", s.companyId);
        routine = r.routine;
      } catch {
        /* Data remains readable when a host lacks routine support. */
      }
    }
    const lastReport =
      states
        .filter((x) => x.lastSuccessAt)
        .map((x) => x.lastSuccessAt!)
        .sort()
        .at(-1) ?? null;
    const allSourcesOk = states.every((x) => x.status === "ok");
    return {
      tasks: items,
      sources: states,
      lastReport,
      allSourcesOk,
      ownerUserId: s.userId,
      collectorAgentId: b?.collector_agent_id ?? null,
      routine,
      agents: includeAgents
        ? (await ctx.agents.list({ companyId: s.companyId, limit: 100 }))
            .filter(
              (x) => !["terminated", "pending_approval"].includes(x.status),
            )
            .map((x) => ({ id: x.id, name: x.name, status: x.status }))
        : [],
    };
  }
  async function ingest(s: Scope, input: unknown) {
    const v = object(input);
    const provider = text(v.provider, 20) as Provider;
    if (!PROVIDERS.includes(provider))
      throw new BoardError(400, "Unbekannte Quelle.");
    if (!Array.isArray(v.tasks) || v.tasks.length > 100)
      throw new BoardError(400, "Importiere höchstens 100 Aufgaben je Aufruf.");
    const candidates = v.tasks.map(candidate);
    for (const c of candidates) {
      c.source.provider = provider;
      if (!c.sourceKey.startsWith(provider + ":"))
        c.sourceKey = provider + ":" + c.sourceKey;
    }
    return serial(s, async () => {
      await ensure(s);
      const existing = await tasks(s);
      const now = new Date().toISOString();
      let created = 0,
        updated = 0;
      const writes: { task: Task; previous?: number }[] = [];
      for (const c of candidates) {
        let old = c.existingId
          ? existing.find((t) => t.doc_id === c.existingId)
          : existing.find((t) => t.sourceKeys.includes(c.sourceKey));
        if (c.existingId && !old)
          throw new BoardError(
            404,
            "Die bestehende Aufgabe gehört nicht zu diesem Board.",
          );
        old ??= existing.find(
          (t) =>
            t.taskKey === c.taskKey &&
            t.kind === (c.kind ?? "mine") &&
            (t.kind !== "delegated" || t.owner === c.owner),
        );
        let t: Task;
        if (old) {
          t = mergeTask(old, c, now);
          updated++;
        } else {
          const prefix =
            (c.kind === "delegated" ? "d" : "m") +
            "-" +
            localDay().replaceAll("-", "") +
            "-";
          const n =
            Math.max(
              0,
              ...existing
                .filter((t) => t.doc_id.startsWith(prefix))
                .map((t) => Number(t.doc_id.slice(prefix.length)) || 0),
            ) + 1;
          t = makeTask(
            prefix + String(n).padStart(2, "0"),
            {
              ...c,
              note: "",
              status:
                c.status === "done" && !c.completionEvidence
                  ? "open"
                  : (c.status ?? "open"),
            },
            now,
          );
          t.taskKey = c.taskKey;
          t.sourceKeys = [c.sourceKey];
          if (t.status === "done") {
            t.autoDone = true;
            t.completionEvidence = c.completionEvidence;
          }
          created++;
        }
        const pending = writes.find((w) => w.task.doc_id === t.doc_id);
        if (pending) pending.task = t;
        else writes.push({ task: t, previous: old?.revision });
        const index = existing.findIndex((x) => x.doc_id === t.doc_id);
        if (index < 0) existing.push(t);
        else existing[index] = t;
      }
      for (const w of writes) await save(s, w.task, w.previous);
      changed(s);
      await audit(
        s,
        "Aufgabenimport: " +
          provider +
          " (" +
          created +
          " neu, " +
          updated +
          " aktualisiert)",
      );
      return { created, updated };
    });
  }
  async function report(s: Scope, input: unknown, runId?: string) {
    const v = object(input);
    const provider = text(v.provider, 20) as Provider;
    if (
      !PROVIDERS.includes(provider) ||
      !["ok", "partial", "error"].includes(String(v.status))
    )
      throw new BoardError(400, "Ungültiger Quellstatus.");
    const parseTime = (k: string) => {
      if (v[k] === undefined) return undefined;
      const t = new Date(text(v[k], 50));
      if (!Number.isFinite(t.getTime()))
        throw new BoardError(400, "Ungültiger Prüfzeitraum.");
      return t.toISOString();
    };
    const from = parseTime("coverageFrom"),
      to = parseTime("coverageTo");
    if (v.status === "ok" && (!from || !to))
      throw new BoardError(
        400,
        "Ein erfolgreicher Import braucht den vollständig geprüften Zeitraum.",
      );
    if (from && to && from > to)
      throw new BoardError(400, "Ungültiger Prüfzeitraum.");
    if (to && to > new Date(Date.now() + 60000).toISOString())
      throw new BoardError(400, "Der geprüfte Zeitraum liegt in der Zukunft.");
    return serial(s, async () => {
      await ensure(s);
      const old = (await sources(s)).find((x) => x.provider === provider)!;
      if (runId && old.runId && old.runId !== runId)
        throw new BoardError(
          409,
          "Dieser Quellenbericht gehört zu einem älteren Importlauf. Lies zuerst den aktuellen Board-Kontext.",
        );
      const now = new Date().toISOString();
      const state: SourceState = {
        ...old,
        provider,
        status: v.status as SourceState["status"],
        message: text(v.message, 2000),
        checkedAt: now,
        coverageFrom: from,
        coverageTo: to,
        runId,
      };
      if (
        typeof v.count === "number" &&
        Number.isInteger(v.count) &&
        v.count >= 0
      )
        state.count = v.count;
      if (v.status === "ok" && to && to >= (old.lastSuccessAt ?? ""))
        state.lastSuccessAt = to;
      await ctx.db.execute(
        `INSERT INTO ${ns}.source_state(company_id,user_id,provider,data) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(company_id,user_id,provider) DO UPDATE SET data=EXCLUDED.data`,
        [...args(s), provider, JSON.stringify(state)],
      );
      changed(s);
      return state;
    });
  }
  async function command(s: Scope, input: unknown) {
    const v = object(input);
    const op = text(v.op, 50);
    if (op === "create")
      return serial(s, async () => {
        await ensure(s);
        const p = object(v.task);
        const id =
          (p.kind === "delegated" ? "d" : "m") +
          "-manual-" +
          Date.now() +
          "-" +
          randomUUID().slice(0, 8);
        const t = makeTask(id, p, new Date().toISOString(), true);
        await save(s, t);
        changed(s);
        await audit(s, "Persönliche Aufgabe angelegt");
        return t;
      });
    if (op === "update")
      return serial(s, async () => {
        const old = (await tasks(s)).find((t) => t.doc_id === v.doc_id);
        if (!old) throw new BoardError(404, "Aufgabe nicht gefunden.");
        if (v.revision !== old.revision)
          throw new BoardError(
            409,
            "Die Aufgabe wurde inzwischen geändert. Lade sie neu; dein Entwurf bleibt erhalten.",
          );
        const t = editTask(old, v.patch, new Date().toISOString());
        await save(s, t, old.revision);
        changed(s);
        await audit(s, "Persönliche Aufgabe bearbeitet");
        return t;
      });
    if (op === "ingest") return ingest(s, v);
    if (op === "report") return report(s, v);
    if (op === "configure")
      return serial(s, async () => {
        const agentId = text(v.agentId, 100);
        const agent = await ctx.agents.get(agentId, s.companyId);
        if (
          !agent ||
          ["terminated", "paused", "pending_approval", "error"].includes(
            agent.status,
          )
        )
          throw new BoardError(400, "Wähle einen verfügbaren Agenten.");
        const others = await ctx.db.query<Board>(
          `SELECT * FROM ${ns}.boards WHERE company_id=$1 AND user_id<>$2 AND routine_id IS NOT NULL`,
          args(s),
        );
        if (others.length)
          throw new BoardError(
            409,
            "Die Import-Routine dieser Organisation ist bereits an ein anderes persönliches Board gebunden.",
          );
        await ensure(s);
        await ctx.db.execute(
          `UPDATE ${ns}.boards SET collector_agent_id=$3 WHERE company_id=$1 AND user_id=$2`,
          [...args(s), agentId],
        );
        const r = await ctx.routines.managed.reconcile(
          "morning-brief",
          s.companyId,
          { assigneeAgentId: agentId },
        );
        await ctx.db.execute(
          `UPDATE ${ns}.boards SET routine_id=$3 WHERE company_id=$1 AND user_id=$2`,
          [...args(s), r.routineId],
        );
        changed(s);
        await audit(s, "Import-Agent und Morning-Brief-Routine eingerichtet");
        return { routineId: r.routineId };
      });
    if (op === "run" || op === "schedule") {
      const b = await board(s);
      if (!b?.collector_agent_id || !b.routine_id)
        throw new BoardError(400, "Richte zuerst deinen Import-Agenten ein.");
      if (op === "schedule") {
        if (typeof v.enabled !== "boolean")
          throw new BoardError(400, "Ungültige Routine-Einstellung.");
        const result = await ctx.routines.managed.update(
          "morning-brief",
          s.companyId,
          { status: v.enabled ? "active" : "paused" },
        );
        changed(s);
        await audit(
          s,
          v.enabled ? "Morning Brief aktiviert" : "Morning Brief pausiert",
        );
        return result;
      }
      const result = await ctx.routines.managed.run(
        "morning-brief",
        s.companyId,
        { assigneeAgentId: b.collector_agent_id },
      );
      changed(s);
      return result;
    }
    throw new BoardError(400, "Unbekannte Aktion.");
  }
  async function api(req: PluginApiRequestInput) {
    const s =
      req.actor.actorType === "user"
        ? {
            companyId: req.companyId,
            userId: req.actor.userId ?? req.actor.actorId,
          }
        : await collector(
            req.companyId,
            req.actor.agentId ?? req.actor.actorId,
          );
    if (!s.userId) throw new BoardError(401, "Melde dich bei Paperclip an.");
    if (req.routeKey === "snapshot") {
      if (req.actor.actorType === "agent" && req.actor.runId)
        await beginRun(s, req.actor.runId);
      return snapshot(s, req.actor.actorType === "user");
    }
    if (req.actor.actorType !== "user") {
      const op = object(req.body).op;
      if (op !== "ingest" && op !== "report")
        throw new BoardError(
          403,
          "Import-Agenten dürfen nur belegte Aufgaben und Quellstatus ergänzen.",
        );
      if (op === "report")
        return report(s, req.body, req.actor.runId ?? undefined);
    }
    return command(s, req.body);
  }
  return { api, snapshot, command, ingest, report, collector, tasks, beginRun };
}
