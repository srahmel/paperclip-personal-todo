# Sebastian's Task Board

Personal tasks from **Outlook, Microsoft Teams, and Fyxer meetings**, directly in Paperclip. Track your own and delegated tasks with due dates, priorities, areas, sources, notes, and live updates.

## Installation

Requirements: Node.js 24.11 or later, pnpm 9.15.4, and a self-hosted Paperclip instance with plugin databases, custom API routes, and managed routines. Built with the official SDK **2026.1106.0**. The plugin runs as trusted code inside your Paperclip instance.

```sh
git clone https://github.com/srahmel/paperclip-personal-todo.git
cd paperclip-personal-todo
pnpm install --frozen-lockfile
pnpm build
paperclipai auth login --instance-admin --api-base http://127.0.0.1:3100
paperclipai plugin install . --api-base http://127.0.0.1:3100
paperclipai plugin inspect srahmel.personal-todo --api-base http://127.0.0.1:3100
```

**My tasks** appears in the sidebar. The organization-scoped route is `/<organization-prefix>/personal-todo`.

If your server uses a different `PAPERCLIP_HOME`, set it for the CLI as well. An existing browser session does not automatically authenticate the CLI. Revoke and remove an installation-only CLI credential afterward with `paperclipai auth logout`.

Local installations remain linked to this directory. `pnpm dev` rebuilds changes, and Paperclip reloads updated worker files. Reload the browser page after UI changes if needed. Changes to manifest declarations may require a plugin upgrade; existing routines are not silently reset, preserving manual settings.

## UI language and appearance

The embedded board follows Paperclip's declared document language and watches for changes. English and German labels are available, including accessible labels, validation messages, and date formatting. Unsupported or invalid locales fall back to English. The current host version declares English; its small German translation catalog does not provide a fully translated German Paperclip UI or a language selector.

The board does not choose a separate language from the browser or task content. Changing the host language updates labels in place and preserves unsaved form values. Task titles, notes, source messages, and imported content retain their original language. The standalone HTML file defaults to English; a hosting application can set its document's `lang` attribute. The isolated preview accepts `?companyId=preview&lang=de` for German checks. Add `&controls=1` to exercise live language changes with a preview-only selector.

Colors, typography, compact task rows, tabs, and controls follow Paperclip's design. Inside Paperclip, the board uses the host's current color tokens and Inter font. Light/dark theme changes apply without reloading. The standalone HTML keeps its embedded IBM Plex fonts and its own theme button.

Code comments and README documentation are always written in English.

## Sources and Morning Brief

1. Expand **Sources & Morning Brief** in the board.
2. Select an existing authorized import agent and click **Set up agent**.
3. **Check Office & Fyxer now** starts a visible Paperclip task.
4. After checking source access, click **Enable Morning Brief** if desired. It runs Monday through Friday at 09:00 in `Europe/Berlin`; new routines start paused.

The collector uses its existing access. The plugin contains no OAuth secrets and does not request new source permissions. Access available in Codex does not automatically establish access for a separate Paperclip agent run.

| Source  | Collector access                                                                                                                                              |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Outlook | Existing direct Codex Outlook tools, or OWA in the agent's own Brave profile. Read-only. No aggregator or new Paperclip Outlook connection.                   |
| Teams   | Existing direct Teams tools or an existing authorized Teams web session. Read-only.                                                                           |
| Fyxer   | Existing `search_context`, `find_recordings`, `get_recording`, and, when needed, `get_transcript` tools. Check meeting action items and concrete commitments. |

Each source is checked independently. Missing access, search limits, or incomplete pagination appear as errors or partial imports. Only a fully checked coverage period advances the last successful checkpoint. A new collector run initially marks sources as being checked; a missing completion report becomes incomplete after 30 minutes.

The first import checks the last 30 days. Subsequent imports use each source's last successful checkpoint with a two-day overlap. Split long periods into smaller windows. Existing agent rules exclude unrelated organizations and account contexts. The plugin does not share or send source content.

Optional access profiles for **Softeria Microsoft 365 MCP** and **Microsoft Playwright MCP** are documented in [Integrations](docs/integrations.md). These templates are disabled and contain no credentials.

## Data and editing

- Each task is a separate JSON document in the `tasks` PostgreSQL table within the host-isolated plugin schema.
- All queries are scoped to the organization and authenticated user. An explicitly selected collector can read and import into its bound board only.
- Manually changed fields are protected from import overwrites. Notes are never replaced by source content. Completed tasks are not automatically reopened.
- Stable `sourceKey` values prevent repeated imports of the same mention. `taskKey` and optional `existingId` connect confidently identical tasks across sources. The collector determines task identity; ambiguous cases remain separate.
- Automatic completion requires explicit `completionEvidence`, stored with the task and displayed in the board.
- Browser edits use revision numbers. Concurrent updates produce a conflict and preserve your draft.
- `localStorage` contains only tab and area selections, always with error handling. Tasks are never stored there.
- Streams contain invalidations only. The UI then reloads user-scoped tasks, including after reconnection.
- Delegated tasks are for tracking and do not assign execution work to another person.

The single managed Morning Brief routine per organization can be bound to exactly one personal board. Other users receive their own empty views and cannot read that private board.

The `hr` flag is a label, not an additional permission boundary within your board. Visibility is controlled by the user/collector binding.

## Tools and API

The plugin registers these tools for its bound import agent:

- `srahmel.personal-todo:list_tasks`
- `srahmel.personal-todo:upsert_tasks`
- `srahmel.personal-todo:report_source`

The API is exposed at `/api/plugins/srahmel.personal-todo/api/board`. `GET` takes `companyId` as a query parameter; `POST` takes `companyId` and `op` in JSON. The host authenticates board users or agents. User IDs supplied in request data never grant access.

For CLI adapters that do not expose plugin tools directly, use `scripts/import_tasks.py`. It uses only environment variables supplied by the Paperclip run and does not log keys:

```sh
python scripts/import_tasks.py list
python scripts/import_tasks.py upsert --payload /path/to/tasks.json
python scripts/import_tasks.py report --payload /path/to/source-status.json
```

For example, `upsert` accepts synthetic task data in this format. German task content is independent of the UI language:

```json
{
  "provider": "fyxer",
  "tasks": [
    {
      "title": "Prüfe die Projektfreigabe",
      "kind": "mine",
      "sourceKey": "recording-example:action-1",
      "taskKey": "example-project-approval",
      "due": null,
      "prio": 2,
      "area": "software",
      "category": "partial",
      "source": { "title": "Beispielbesprechung", "date": "2026-11-01" }
    }
  ]
}
```

## HTML artifact and development

The board uses vanilla TypeScript/JavaScript, HTML, and CSS. The build creates **one standalone HTML file**, `dist/aufgaben-board.html`, with embedded IBM Plex fonts. A small React shell embeds the same file as a trusted plugin page. Personal authentication and storage still require the Paperclip host; an ordinary isolated Paperclip HTML artifact preview does not allow API access.

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm dev
pnpm preview
```

`tests/service.spec.ts` checks real SQL against PGlite: deduplication, revision conflicts, user/organization boundaries, collector access, completion evidence, and independent source status. `tests/i18n.spec.ts` checks locale resolution, translation placeholders, accessible labels, and source-content preservation. `scripts/preview.ts` serves synthetic data only on port 3318 (override with `PERSONAL_TODO_PREVIEW_PORT`), without connecting to production sources or Paperclip databases.

This repository contains source code and synthetic test data. Real tasks, emails, transcripts, sessions, and credentials belong only in the running instance.
