import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import { createService } from "./service.js";
import { BoardError } from "./model.js";
import { tools } from "./manifest.js";

let service: ReturnType<typeof createService>;

const plugin = definePlugin({
  async setup(ctx) {
    service = createService(ctx);
    for (const tool of tools)
      ctx.tools.register(tool.name, tool as never, async (params, run) => {
        try {
          const s = await service.collector(run.companyId, run.agentId);
          if (tool.name === "list_tasks") await service.beginRun(s, run.runId);
          const data =
            tool.name === "list_tasks"
              ? await service.snapshot(s)
              : tool.name === "upsert_tasks"
                ? await service.ingest(s, params)
                : await service.report(s, params, run.runId);
          return { data, content: JSON.stringify(data) };
        } catch (e) {
          return {
            error:
              e instanceof BoardError
                ? e.message
                : "Der Import konnte nicht gespeichert werden. Prüfe das Plugin-Protokoll.",
          };
        }
      });
  },

  async onApiRequest(req) {
    try {
      return {
        body: await service.api(req),
        headers: { "Cache-Control": "no-store" },
      };
    } catch (e) {
      return {
        status: e instanceof BoardError ? e.status : 500,
        body: {
          error:
            e instanceof BoardError
              ? e.message
              : "Die Aktion konnte nicht gespeichert werden. Bitte erneut versuchen.",
        },
        headers: { "Cache-Control": "no-store" },
      };
    }
  },

  async onIdleDrain() {
    return "none" as const;
  },

  async onHealth() {
    return { status: "ok", message: "Plugin worker is running" };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
