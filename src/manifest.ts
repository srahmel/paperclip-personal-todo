import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import { IMPORT_PROMPT } from "./import-prompt.js";
import { fileURLToPath } from "node:url";
export const collectorInstructions =
  IMPORT_PROMPT +
  "\nFalls der CLI-Adapter die Plugin-Werkzeuge nicht direkt anbietet, verwende stattdessen den mitgelieferten HTTP-Helper: " +
  fileURLToPath(new URL("../scripts/import_tasks.py", import.meta.url)) +
  ". Führe ihn mit python aus. Zuerst list, dann upsert --payload <UTF-8-JSON-Datei> mit provider/tasks und abschließend report --payload <UTF-8-JSON-Datei> mit provider/status/message/coverageFrom/coverageTo/count. Der Helper verwendet ausschließlich die vorhandenen PAPERCLIP_API_URL, PAPERCLIP_COMPANY_ID, PAPERCLIP_API_KEY und PAPERCLIP_RUN_ID aus deinem Lauf. Schlüssel nie ausgeben oder in Dateien/Argumente kopieren. Kein neuer Zugang ist nötig. Er meldet technische Unerreichbarkeit ausdrücklich; einen fehlgeschlagenen Schreibzugriff nicht als gespeichert ausgeben.";
export const PLUGIN_ID = "srahmel.personal-todo";
export const tools = [
  {
    name: "list_tasks",
    displayName: "Aufgaben vor dem Import lesen",
    description:
      "Liest Aufgaben und Quellstatus des für diesen Agenten freigegebenen persönlichen Boards.",
    parametersSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "upsert_tasks",
    displayName: "Aufgaben aus Office oder Fyxer ergänzen",
    description:
      "Entdoppelt belegte Aufgaben. Manuelle Notizen und Änderungen bleiben erhalten.",
    parametersSchema: {
      type: "object",
      properties: {
        provider: { enum: ["outlook", "teams", "fyxer"] },
        tasks: {
          type: "array",
          maxItems: 100,
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              sourceKey: { type: "string" },
              taskKey: { type: "string" },
              existingId: { type: "string" },
              kind: { enum: ["mine", "delegated"] },
              owner: { type: "string" },
              due: { type: ["string", "null"] },
              prio: { enum: [1, 2, 3] },
              status: { enum: ["open", "doing", "waiting", "done"] },
              category: { enum: ["direct", "partial", "blocked"] },
              area: {
                enum: [
                  "security",
                  "infrastructure",
                  "software",
                  "data",
                  "finance",
                  "compliance",
                  "org",
                ],
              },
              hint: { type: "string" },
              help: { type: "string" },
              needs: { type: "string" },
              hr: { type: "boolean" },
              completionEvidence: { type: "string" },
              source: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  date: { type: "string" },
                  url: { type: "string" },
                  at: { type: "string" },
                  externalId: { type: "string" },
                },
                required: ["title", "date"],
              },
            },
            required: ["title", "sourceKey", "taskKey", "source"],
          },
        },
      },
      required: ["provider", "tasks"],
      additionalProperties: false,
    },
  },
  {
    name: "report_source",
    displayName: "Quellenprüfung melden",
    description:
      "Meldet tatsächliche Abdeckung und Fehler je Quelle; nur vollständig erfolgreiche Abfragen verschieben den Prüfzeitpunkt.",
    parametersSchema: {
      type: "object",
      properties: {
        provider: { enum: ["outlook", "teams", "fyxer"] },
        status: { enum: ["ok", "partial", "error"] },
        message: { type: "string" },
        coverageFrom: { type: "string" },
        coverageTo: { type: "string" },
        count: { type: "integer", minimum: 0 },
      },
      required: ["provider", "status", "message"],
      additionalProperties: false,
    },
  },
] as const;
const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Sebastians Aufgaben-Board",
  description:
    "Persönliche Aufgaben aus Outlook, Teams und Fyxer mit Quellen, Fristen und manueller Bearbeitung.",
  author: "srahmel",
  categories: ["ui", "automation"],
  capabilities: [
    "database.namespace.migrate",
    "database.namespace.read",
    "database.namespace.write",
    "api.routes.register",
    "ui.page.register",
    "ui.sidebar.register",
    "agent.tools.register",
    "agents.read",
    "routines.managed",
    "activity.log.write",
  ],
  entrypoints: { worker: "./dist/worker.js", ui: "./dist/ui" },
  database: { namespaceSlug: "personal_todo", migrationsDir: "migrations" },
  apiRoutes: [
    {
      routeKey: "snapshot",
      method: "GET",
      path: "/board",
      auth: "board-or-agent",
      capability: "api.routes.register",
      companyResolution: { from: "query", key: "companyId" },
    },
    {
      routeKey: "command",
      method: "POST",
      path: "/board",
      auth: "board-or-agent",
      capability: "api.routes.register",
      companyResolution: { from: "body", key: "companyId" },
    },
  ],
  tools: tools as unknown as PaperclipPluginManifestV1["tools"],
  routines: [
    {
      routineKey: "morning-brief",
      title: "Aufgaben-Board: Morning Brief (Office + Fyxer)",
      description: collectorInstructions,
      status: "paused",
      priority: "medium",
      concurrencyPolicy: "coalesce_if_active",
      catchUpPolicy: "skip_missed",
      triggers: [
        {
          kind: "schedule",
          label: "Werktags morgens",
          enabled: true,
          cronExpression: "0 9 * * 1-5",
          timezone: "Europe/Berlin",
          signingMode: null,
          replayWindowSec: null,
        },
      ],
    },
  ],
  ui: {
    slots: [
      {
        type: "page",
        id: "board",
        displayName: "Meine Aufgaben",
        exportName: "BoardPage",
        routePath: "personal-todo",
      },
      {
        type: "sidebar",
        id: "board-link",
        displayName: "Meine Aufgaben",
        exportName: "BoardSidebar",
      },
    ],
  },
};
export default manifest;
