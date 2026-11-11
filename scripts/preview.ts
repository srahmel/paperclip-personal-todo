// Isolated visual test host. Synthetic data only; never connects to Paperclip or Office.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type {
  PluginContext,
  PluginApiRequestInput,
} from "@paperclipai/plugin-sdk";
import { createService } from "../src/service.js";
import { localDay } from "../src/model.js";
const ns = "plugin_personal_todo_f8dc7ec3ac",
  db = new PGlite();
await db.exec("CREATE SCHEMA " + ns);
await db.exec(
  await readFile(
    new URL("../migrations/001_tasks.sql", import.meta.url),
    "utf8",
  ),
);
const clients = new Set<import("node:http").ServerResponse>();
const ctx = {
  db: {
    namespace: ns,
    query: async (s: string, p?: unknown[]) => (await db.query(s, p)).rows,
    execute: async (s: string, p?: unknown[]) => ({
      rowCount: (await db.query(s, p)).affectedRows ?? 0,
    }),
  },
  streams: {
    open() {},
    emit(_channel: string, data: unknown) {
      for (const c of clients)
        c.write("data: " + JSON.stringify(data) + "\n\n");
    },
  },
  activity: { async log() {} },
  agents: {
    async list() {
      return [{ id: "preview-importer", name: "Import-Agent", status: "idle" }];
    },
    async get(id: string) {
      return { id, status: "idle" };
    },
  },
  routines: {
    managed: {
      async get() {
        return { routine: { id: "preview-routine", status: "paused" } };
      },
      async reconcile() {
        return { routineId: "preview-routine" };
      },
      async update() {
        return {};
      },
      async run() {
        return { id: "preview-run" };
      },
    },
  },
} as unknown as PluginContext;
const service = createService(ctx),
  scope = { companyId: "preview", userId: "preview-user" },
  today = localDay();
const rows = [
  {
    title: "Prüfe den Budgetentwurf für das kommende Quartal",
    area: "finance",
    prio: 1,
    category: "partial",
    due: "2020-01-01",
    hint: "Die aktualisierten Zahlen liegen zur Entscheidung vor.",
  },
  {
    title: "Bestätige den Termin für die Infrastruktur-Abstimmung",
    area: "infrastructure",
    prio: 2,
    category: "direct",
    due: today,
  },
  {
    title: "Kläre die Zuständigkeit für den Sicherheitsbericht",
    area: "security",
    prio: 1,
    category: "blocked",
    status: "waiting",
    due: null,
  },
  {
    title: "Ergänze die Datenschutzprüfung für das neue Portal",
    area: "compliance",
    prio: 2,
    category: "partial",
    due: null,
    hr: true,
  },
  {
    title: "Prüfe das Datenmodell der Serviceberichte",
    area: "data",
    prio: 2,
    category: "direct",
    due: null,
    status: "doing",
  },
  {
    title:
      "Bereite die nächste Software-Abnahme mit einem bewusst längeren Titel für die mobile Ansicht vor",
    area: "software",
    prio: 3,
    category: "partial",
    due: null,
  },
  {
    title: "Bestätige die Übergabe im Team",
    area: "org",
    prio: 2,
    category: "direct",
    due: null,
    status: "done",
    completionEvidence: "Im Test bestätigt",
  },
  {
    title: "Liefere die aktualisierte Ressourcenplanung",
    area: "org",
    prio: 1,
    kind: "delegated",
    owner: "Alex Beispiel",
    due: "2020-01-01",
    status: "waiting",
  },
  {
    title: "Stelle die technischen Unterlagen bereit",
    area: "software",
    prio: 2,
    kind: "delegated",
    owner: "Kim Beispiel",
    due: null,
  },
];
await service.ingest(scope, {
  provider: "fyxer",
  tasks: rows.map((r, i) => ({
    ...r,
    taskKey: "demo-" + i,
    sourceKey: "demo-" + i,
    source: {
      title: "Beispielbesprechung · Testdaten",
      date: today,
      url: "https://example.com/meeting",
      at: "12:30",
    },
    help: "Ich kann die vorhandenen Informationen strukturieren und eine Entscheidungsvorlage vorbereiten.",
    needs: "Deine Entscheidung zum nächsten Schritt.",
  })),
});
for (const provider of ["outlook", "teams", "fyxer"])
  await service.report(scope, {
    provider,
    status: provider === "teams" ? "partial" : "ok",
    coverageFrom: "2020-01-01T00:00:00Z",
    coverageTo: new Date().toISOString(),
    message:
      provider === "teams"
        ? "Testfall: Ein Thread ist noch nicht geprüft."
        : "Synthetische Testdaten, keine echten Nachrichten.",
    count: provider === "fyxer" ? 9 : 0,
  });
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url!, "http://127.0.0.1");
    if (url.pathname.includes("/bridge/stream/")) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      });
      res.write(":ok\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    if (url.pathname.endsWith("/api/board")) {
      let body = "";
      for await (const chunk of req) {
        body += String(chunk);
        if (body.length > 1000000) throw new Error("Too large");
      }
      const value = await service.api({
        routeKey: req.method === "GET" ? "snapshot" : "command",
        companyId: "preview",
        actor: {
          actorType: "user",
          actorId: "preview-user",
          userId: "preview-user",
        },
        body: body ? JSON.parse(body) : {},
        query: {},
      } as PluginApiRequestInput);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(value));
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(await readFile(new URL("../dist/ui/board.html", import.meta.url)));
  } catch (e) {
    res.writeHead((e as { status?: number }).status ?? 500, {
      "Content-Type": "application/json",
    });
    res.end(JSON.stringify({ error: (e as Error).message }));
  }
});
server.listen(3318, "127.0.0.1", () =>
  console.log("Isolated preview: http://127.0.0.1:3318/?companyId=preview"),
);
async function stop() {
  for (const c of clients) c.end();
  server.close();
  await db.close();
  process.exit();
}
process.on("SIGINT", () => {
  void stop();
});
process.on("SIGTERM", () => {
  void stop();
});
