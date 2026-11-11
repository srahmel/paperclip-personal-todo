# Optional MCP access profiles

The board remains the shared task database. Office and Fyxer remain separate sources. MCP servers belong to the import agent; the board does not need Microsoft tokens or browser sessions.

[mcp.example.json](../integrations/mcp.example.json) is a **disabled template**. Plugin startup does not load it, install an agent connection, or grant access. npm versions are pinned to the verified versions.

## Softeria Microsoft 365

[Softeria/ms-365-mcp-server](https://github.com/Softeria/ms-365-mcp-server) accesses Microsoft Graph directly. It supports Outlook and, in organization mode, Teams. The prepared command uses `--org-mode`, `--read-only`, and an explicit allowlist of read tools for messages, chats, and channels. This profile excludes calendars, files, contacts, sending, and administration.

Before signing in, inspect the derived permissions using the same options plus `--list-permissions`. Microsoft sign-in and any required administrator consent are separate steps. Existing Codex/OWA sessions do not authenticate Softeria; do not copy tokens from them. Read-only mode limits the tools offered, but does not retroactively narrow a previously issued token.

Active organization rules take precedence. If Outlook is restricted to OWA and direct Codex Outlook tools, leave Softeria prepared until a specific exception for this collector is authorized and the governing agent rule is updated. Do not create an aggregator-based Outlook connection or an automatic Paperclip connection request.

After authorization and sign-in, verify the account mapping, read a small message page and a known Teams thread, then report `provider: outlook` or `provider: teams` to the board. Inaccessible channels remain a partial import and must not be reported as fully checked.

## Microsoft Playwright MCP

[microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) provides browser automation. Use the integrated browser first for general websites. For the required OWA exception, an existing agent-owned Brave profile can be accessed through its CDP endpoint.

Replace `REPLACE_WITH_OWN_AGENT_CDP_PORT` in the template with the **agent's own** running endpoint. Reuse an existing profile without restarting it. Do not launch another browser against the same profile directory. If no profile is running, use the prescribed agent launcher in headless mode, then use its actual CDP endpoint.

Playwright is not a technically read-only data connector. Existing action approvals still apply. Do not export cookies/storage, read credentials, use global input, or activate/focus a headless window. Do not send messages, complete Fyxer tasks, or change settings. Request focused user assistance for 2FA or a failed sign-in.

The CDP command is prepared as a configuration option; this does not establish a verified production Microsoft sign-in through the template.

## Fyxer remains independent

Neither Softeria nor Playwright replaces the Fyxer source. Use existing Fyxer tools for action items, recordings, and evidenced status changes. When search context is available but recording/transcript details are not, evidenced tasks may still be added; the source remains **partially checked**. Do not bypass missing detail permissions through session/token extraction or an invented API.

## Consistent imports

The same contract applies to every access path: first call `list_tasks` or the HTTP helper's `list` command, add evidenced tasks with stable source keys, then report the actual coverage period and status for each source. Use small pages and time windows for large mailboxes, saving progress between them. Do not load entire mailboxes or transcripts into one tool output.

## Verified permission scope

The prepared Softeria command was checked with `--list-permissions` without signing in. It reported only `Mail.Read`, `Chat.ReadBasic`, `ChatMessage.Read`, `Team.ReadBasic.All`, `Channel.ReadBasic.All`, and `ChannelMessage.Read.All`, with no disabled tools or write permissions. This verifies the configuration, not an existing Microsoft consent grant.
