import { createI18n } from "./i18n.js";
import {
  AREAS,
  localDay,
  type Task,
  type SourceState,
  type Source,
} from "./model.js";
const PLUGIN = "srahmel.personal-todo";
const companyId =
  document.querySelector<HTMLElement>("#app")?.dataset.companyId ??
  new URLSearchParams(location.search).get("companyId");
const root = document.querySelector<HTMLElement>("#app")!;
let i18n = createI18n(document.documentElement.lang);
const tr = (key: string, values?: Record<string, string | number>) =>
  i18n.t(key, values);
const areaLabel = (key: keyof typeof AREAS) => i18n.message(AREAS[key]);
const labels = {
  open: "Open",
  doing: "In progress",
  waiting: "Waiting",
  done: "Done",
};
const categories = {
  direct: "Ready to do",
  partial: "Partial",
  blocked: "Blocked",
};
const providers = {
  outlook: "Outlook",
  teams: "Teams",
  fyxer: "Fyxer meetings",
};
type Snapshot = {
  tasks: Task[];
  sources: SourceState[];
  lastReport: string | null;
  allSourcesOk: boolean;
  collectorAgentId: string | null;
  routine: { status: string; id: string } | null;
  agents: { id: string; name: string; status: string }[];
};
let data: Snapshot = {
  tasks: [],
  sources: [],
  lastReport: null,
  allSourcesOk: false,
  collectorAgentId: null,
  routine: null,
  agents: [],
};
let kind = "mine",
  view = "open",
  area = "",
  search = "",
  editing: Task | null = null,
  busy = false;
const expanded = new Set<string>();
try {
  const v = JSON.parse(
    localStorage.getItem("personal-todo-view:" + companyId) ?? "null",
  );
  if (v) {
    if (["mine", "delegated"].includes(v.kind)) kind = v.kind;
    if (["open", "done", "all"].includes(v.view)) view = v.view;
    if (v.area in AREAS) area = v.area;
  }
} catch {}
function remember() {
  try {
    localStorage.setItem(
      "personal-todo-view:" + companyId,
      JSON.stringify({ kind, view, area }),
    );
  } catch {}
}
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string,
) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (className) n.className = className;
  return n;
}
function button(label: string, fn: () => void, className?: string) {
  const b = el("button", label, className);
  b.type = "button";
  b.onclick = fn;
  return b;
}
function dateLabel(value: string) {
  return new Intl.DateTimeFormat(i18n.locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Berlin",
  }).format(new Date(value.length === 10 ? value + "T12:00:00Z" : value));
}
function error(e: unknown) {
  const n = document.querySelector<HTMLElement>("#error")!;
  n.hidden = false;
  n.textContent = i18n.message(e instanceof Error ? e.message : String(e));
}
function clearError() {
  document.querySelector<HTMLElement>("#error")!.hidden = true;
}
async function api(body?: Record<string, unknown>) {
  if (!companyId)
    throw new Error(tr("Open the task board from My tasks in Paperclip."));
  const response = await fetch(
    "/api/plugins/" +
      PLUGIN +
      "/api/board" +
      (body ? "" : "?companyId=" + encodeURIComponent(companyId)),
    {
      method: body ? "POST" : "GET",
      credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify({ ...body, companyId }) : undefined,
    },
  );
  let value;
  try {
    value = await response.json();
  } catch {
    throw new Error(
      tr("Paperclip returned invalid data. Please sign in again."),
    );
  }
  if (!response.ok) throw new Error(value.error ?? tr("The request failed."));
  return value;
}
async function refresh() {
  try {
    data = await api();
    render();
  } catch (e) {
    error(e);
  }
}
async function action(body: Record<string, unknown>) {
  if (busy) return;
  busy = true;
  clearError();
  try {
    await api(body);
    await refresh();
    return true;
  } catch (e) {
    error(e);
    return false;
  } finally {
    busy = false;
  }
}
// The only persistence for tasks is the authenticated Paperclip database.
// onSnapshot re-reads after stream events AND every reconnect to close missed-event gaps.
const db = {
  collection(name: string) {
    if (name !== "tasks") throw new Error("Unbekannte Collection");
    return {
      onSnapshot(listener: () => void) {
        const stream = new EventSource(
          "/api/plugins/" +
            PLUGIN +
            "/bridge/stream/tasks-" +
            encodeURIComponent(companyId ?? "") +
            "?companyId=" +
            encodeURIComponent(companyId ?? ""),
        );
        stream.onopen = listener;
        stream.onmessage = listener;
        for (const name of ["message", "data", "stream:event", "changed"])
          stream.addEventListener(name, listener);
        const onFocus = () => {
          if (!document.hidden) listener();
        };
        document.addEventListener("visibilitychange", onFocus);
        window.addEventListener("focus", onFocus);
        return () => {
          stream.close();
          document.removeEventListener("visibilitychange", onFocus);
          window.removeEventListener("focus", onFocus);
        };
      },
    };
  },
};
root.innerHTML = `<main><div class="heading"><div><h1>Task board</h1><p class="subtitle" id="subtitle">Your tasks from Outlook, Teams, and Fyxer.</p></div><div class="heading-actions"><button id="theme" type="button" aria-label="Switch between light and dark mode">◐</button><button id="add" class="primary" type="button">+ Task</button></div></div><div id="error" class="error" role="alert" hidden></div><div id="notice" class="notice" role="status" hidden></div><div id="stats" class="stats"></div><details class="sources" id="source-panel"><summary id="source-summary"></summary><div id="source-grid" class="source-grid"></div><div id="setup" class="setup"></div></details><div class="controls"><div id="kind-tabs" class="segmented" aria-label="Ownership"></div><div id="status-tabs" class="segmented" aria-label="Task status"></div><select id="area" aria-label="Filter by area"><option value="">All areas</option></select><input id="search" type="search" placeholder="Search: title, person, meeting" aria-label="Search tasks"></div><div id="list" aria-live="polite"></div><p class="footer-note">Sebastian's Task Board · Your edits are preserved during future imports. Delegated tasks are for tracking and do not assign work.</p></main><dialog id="editor" aria-labelledby="editor-title"><div class="dialog-head"><h2 id="editor-title">Edit task</h2><button id="close-editor" type="button" aria-label="Close dialog">×</button></div><form id="task-form"><div class="form-grid"><label class="wide">Task<input name="title" required maxlength="500" placeholder="What is the next concrete step?"></label><label>Ownership<select name="kind"><option value="mine">My task</option><option value="delegated">Delegated</option></select></label><label id="owner-label">Person<input name="owner" maxlength="300"></label><label>Due date<input name="due" type="date"></label><label>Priority<select name="prio"><option value="1">P1 · High</option><option value="2">P2 · Normal</option><option value="3">P3 · Low</option></select></label><label>Status<select name="status"></select></label><label>Area<select name="area"></select></label><label id="category-label">Readiness<select name="category"><option value="direct">Ready to do</option><option value="partial">Partial</option><option value="blocked">Blocked</option></select></label><label class="check-label"><input type="checkbox" name="hr">Personnel</label><label class="wide">Your note<textarea name="note" maxlength="8000" placeholder="Your thoughts and next steps"></textarea></label><label class="wide">How the assistant can help<textarea name="help" maxlength="8000"></textarea></label><label class="wide">Required input / Context<textarea name="needs" maxlength="8000"></textarea></label></div><div id="editor-error" class="error" role="alert" hidden></div><div class="footer"><button id="cancel" type="button">Cancel</button><button type="submit" class="primary">Save</button></div></form></dialog>`;
const selectArea = document.querySelector<HTMLSelectElement>("#area")!;
const form = document.querySelector<HTMLFormElement>("#task-form")!;
const dialog = document.querySelector<HTMLDialogElement>("#editor")!;
// Capture only plugin-owned static copy before any task data or drafts are rendered.
const staticText: [Text, string][] = [];
const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
while (walker.nextNode()) {
  const node = walker.currentNode as Text;
  if (
    node.textContent?.trim() &&
    !["subtitle", "editor-title"].includes(node.parentElement?.id ?? "")
  )
    staticText.push([node, node.textContent]);
}
const staticAttributes: [Element, string, string][] = [];
for (const element of root.querySelectorAll("*"))
  for (const name of ["aria-label", "placeholder"])
    if (element.hasAttribute(name))
      staticAttributes.push([element, name, element.getAttribute(name)!]);
function localizeStaticCopy() {
  for (const [node, key] of staticText) node.textContent = tr(key);
  for (const [element, name, key] of staticAttributes)
    element.setAttribute(name, tr(key));
  document.title = tr("Sebastian's Task Board");
}
localizeStaticCopy();
for (const [value, label] of Object.entries(AREAS)) {
  selectArea.add(new Option(i18n.message(label), value));
  (form.elements.namedItem("area") as HTMLSelectElement).add(
    new Option(i18n.message(label), value),
  );
}
selectArea.value = area;
selectArea.onchange = () => {
  area = selectArea.value;
  remember();
  renderList();
};
document.querySelector<HTMLInputElement>("#search")!.oninput = (e) => {
  search = (e.target as HTMLInputElement).value;
  renderList();
};
document.querySelector<HTMLButtonElement>("#theme")!.onclick = () => {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === "dark"
    : matchMedia("(prefers-color-scheme:dark)").matches;
  document.documentElement.dataset.theme = dark ? "light" : "dark";
};
function field(name: string) {
  return form.elements.namedItem(name) as
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
}
function adjustForm() {
  const delegated = field("kind").value === "delegated";
  document.querySelector<HTMLElement>("#owner-label")!.hidden = !delegated;
  (field("owner") as HTMLInputElement).required = delegated;
  document.querySelector<HTMLElement>("#category-label")!.hidden = delegated;
  const status = field("status") as HTMLSelectElement;
  const current = status.value;
  status.replaceChildren(
    ...Object.entries(labels)
      .filter(([k]) => !delegated || k !== "doing")
      .map(([k, v]) => new Option(tr(v), k)),
  );
  status.value = [...status.options].some((o) => o.value === current)
    ? current
    : "open";
}
function openEditor(task: Task | null) {
  editing = task;
  form.reset();
  document.querySelector("#editor-title")!.textContent = task
    ? tr("Edit task")
    : tr("New task");
  const defaults = { kind, prio: 2, area: "org", category: "partial", ...task };
  for (const name of [
    "title",
    "kind",
    "owner",
    "due",
    "prio",
    "area",
    "category",
    "note",
    "help",
    "needs",
  ])
    field(name).value = String(
      (defaults as Record<string, unknown>)[name] ?? "",
    );
  (field("hr") as HTMLInputElement).checked = !!task?.hr;
  adjustForm();
  field("status").value = task?.status ?? "open";
  document.querySelector<HTMLElement>("#editor-error")!.hidden = true;
  dialog.showModal();
  field("title").focus();
}
field("kind").onchange = adjustForm;
for (const id of ["close-editor", "cancel"])
  document.querySelector<HTMLButtonElement>("#" + id)!.onclick = () =>
    dialog.close();
document.querySelector<HTMLButtonElement>("#add")!.onclick = () =>
  openEditor(null);
form.onsubmit = async (e) => {
  e.preventDefault();
  const submit = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
  submit.disabled = true;
  const p: Record<string, unknown> = {};
  for (const name of [
    "title",
    "kind",
    "owner",
    "due",
    "prio",
    "status",
    "area",
    "category",
    "note",
    "help",
    "needs",
  ]) {
    if (
      (name === "owner" && field("kind").value === "mine") ||
      (name === "category" && field("kind").value === "delegated")
    )
      continue;
    let value: unknown = field(name).value.trim();
    if (name === "due") value = value || null;
    if (name === "prio") value = Number(value);
    if (
      !editing ||
      value !== (editing as unknown as Record<string, unknown>)[name]
    )
      p[name] = value;
  }
  const hr = (field("hr") as HTMLInputElement).checked;
  if (!editing || hr !== !!editing.hr) p.hr = hr;
  try {
    await api(
      editing
        ? {
            op: "update",
            doc_id: editing.doc_id,
            revision: editing.revision,
            patch: p,
          }
        : { op: "create", task: p },
    );
    dialog.close();
    await refresh();
  } catch (err) {
    const n = document.querySelector<HTMLElement>("#editor-error")!;
    n.hidden = false;
    n.textContent = i18n.message(
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    submit.disabled = false;
  }
};
function tabs(
  id: string,
  values: Record<string, string>,
  selected: string,
  set: (s: string) => void,
) {
  const holder = document.querySelector("#" + id)!;
  holder.replaceChildren(
    ...Object.entries(values).map(([key, label]) => {
      const b = button(tr(label), () => {
        set(key);
        remember();
        render();
      });
      b.setAttribute("aria-pressed", String(key === selected));
      return b;
    }),
  );
}
function render() {
  tabs(
    "kind-tabs",
    { mine: tr("Mine"), delegated: tr("Delegated") },
    kind,
    (v) => (kind = v),
  );
  tabs(
    "status-tabs",
    { open: tr("Open"), done: tr("Done"), all: tr("All") },
    view,
    (v) => (view = v),
  );
  document.querySelector("#subtitle")!.textContent =
    tr("Your tasks from Outlook, Teams, and Fyxer.") +
    " " +
    (data.lastReport
      ? tr("Last successful check: {date}.", {
          date: dateLabel(data.lastReport),
        })
      : tr("No successful import yet."));
  renderStats();
  renderSources();
  renderList();
}
function renderStats() {
  const today = localDay(),
    mine = data.tasks.filter((t) => t.kind === "mine" && t.status !== "done"),
    others = data.tasks.filter(
      (t) => t.kind === "delegated" && t.status !== "done",
    );
  const items: [
    [number, string, boolean],
    [number, string, boolean],
    [number, string, boolean],
    [number, string, boolean],
    [number, string, boolean],
    [number, string, boolean],
  ] = [
    [mine.length, tr("Open"), false],
    [mine.filter((t) => t.due && t.due < today).length, tr("Overdue"), true],
    [mine.filter((t) => t.due === today).length, tr("Due today"), false],
    [mine.filter((t) => t.prio === 1).length, "P1", false],
    [others.length, tr("Delegated and open"), false],
    [
      others.filter((t) => t.due && t.due < today).length,
      tr("of these overdue"),
      true,
    ],
  ];
  const stats = document.querySelector("#stats")!;
  stats.replaceChildren(
    ...items.map(([n, label, red]) => {
      const e = el("div", undefined, "stat" + (red ? " overdue" : ""));
      e.append(
        el("strong", new Intl.NumberFormat(i18n.locale).format(n)),
        document.createTextNode(label),
      );
      return e;
    }),
  );
}
function renderSources() {
  const summary = document.querySelector("#source-summary")!;
  summary.replaceChildren(
    el("strong", tr("Sources & Morning Brief")),
    el(
      "span",
      data.allSourcesOk
        ? tr("All sources checked")
        : tr("Source checks pending or incomplete"),
      "source-mini",
    ),
  );
  const grid = document.querySelector("#source-grid")!;
  grid.replaceChildren(
    ...data.sources.map((s) => {
      const card = el("div", undefined, "source-card");
      card.append(
        el("strong", tr(providers[s.provider])),
        el(
          "span",
          {
            never: tr("Not checked yet"),
            running: tr("Check in progress"),
            ok: tr("Checked"),
            partial: tr("Partially checked"),
            error: tr("Access failed"),
          }[s.status],
          s.status === "ok" ? "ok" : s.status === "error" ? "error-text" : "",
        ),
        el("p", i18n.message(s.message)),
      );
      if (s.lastSuccessAt)
        card.append(
          el(
            "div",
            tr("Checked through {date}", { date: dateLabel(s.lastSuccessAt) }),
            "muted",
          ),
        );
      if (s.coverageFrom && s.coverageTo)
        card.append(
          el(
            "div",
            dateLabel(s.coverageFrom) + " – " + dateLabel(s.coverageTo),
            "source-mini",
          ),
        );
      return card;
    }),
  );
  const setup = document.querySelector("#setup")!;
  const agent = el("select");
  agent.setAttribute("aria-label", tr("Import agent"));
  agent.add(new Option(tr("Select import agent"), ""));
  for (const a of data.agents)
    agent.add(
      new Option(
        a.name +
          " · " +
          tr(a.status.charAt(0).toUpperCase() + a.status.slice(1)),
        a.id,
      ),
    );
  agent.value = data.collectorAgentId ?? "";
  const save = button(tr("Set up agent"), () => {
    if (agent.value) void action({ op: "configure", agentId: agent.value });
  });
  const run = button(
    tr("Check Office & Fyxer now"),
    () => {
      void action({ op: "run" }).then((ok) => {
        if (ok) {
          const n = document.querySelector<HTMLElement>("#notice")!;
          n.hidden = false;
          n.textContent = tr(
            "The import has started. Results appear here as soon as they are saved.",
          );
        }
      });
    },
    "primary",
  );
  run.disabled = !data.collectorAgentId;
  const enabled = data.routine?.status === "active";
  const schedule = button(
    enabled ? tr("Pause Morning Brief") : tr("Enable Morning Brief"),
    () => {
      void action({ op: "schedule", enabled: !enabled });
    },
  );
  schedule.disabled = !data.routine;
  setup.replaceChildren(
    el(
      "p",
      tr(
        "The import agent reads Outlook, Teams, and Fyxer. Once enabled, the daily routine runs on weekdays at 09:00 (Berlin). Your sources are read-only.",
      ),
    ),
    agent,
    save,
    run,
    schedule,
  );
}
function sourceLink(s: Source) {
  const row = el("div");
  const label =
    (s.title === "Manuell angelegt" ? tr("Manually created") : s.title) +
    " · " +
    dateLabel(s.date) +
    (s.at ? " · " + s.at : "");
  if (s.url) {
    const a = el("a", label, "source-link");
    a.href = s.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    row.append(a);
  } else row.textContent = label;
  return row;
}
function renderList() {
  const today = localDay(),
    q = search.trim().toLocaleLowerCase(i18n.locale);
  const items = data.tasks
    .filter(
      (t) =>
        t.kind === kind &&
        (view === "all" ||
          (view === "done" ? t.status === "done" : t.status !== "done")) &&
        (!area || t.area === area) &&
        (!q ||
          [
            t.title,
            t.owner,
            t.note,
            t.hint,
            t.help,
            t.needs,
            t.source.title,
            ...t.sources.map((s) => s.title),
          ]
            .join(" ")
            .toLocaleLowerCase(i18n.locale)
            .includes(q)),
    )
    .sort(
      (a, b) =>
        a.prio - b.prio ||
        (a.due ?? "9999").localeCompare(b.due ?? "9999") ||
        a.title.localeCompare(b.title, i18n.locale),
    );
  const list = document.querySelector("#list")!;
  list.replaceChildren();
  if (!items.length) {
    const e = el("div", undefined, "empty");
    e.append(
      el(
        "strong",
        data.tasks.length
          ? tr("No matching tasks")
          : tr("Your task board is ready"),
      ),
      el(
        "p",
        data.tasks.length
          ? tr("Adjust your search or filters.")
          : tr(
              "Add a task or set up your import agent under Sources & Morning Brief.",
            ),
      ),
    );
    list.append(e);
    return;
  }
  const groups = new Map<string, Task[]>();
  for (const t of items) {
    const group =
      t.status === "done"
        ? tr("Done")
        : t.due && t.due < today
          ? tr("Overdue")
          : t.due === today
            ? tr("Due today")
            : t.status === "waiting"
              ? tr("Waiting for a reply")
              : t.status === "doing"
                ? tr("In progress")
                : t.due
                  ? tr("Upcoming")
                  : tr("No due date");
    groups.set(group, [...(groups.get(group) ?? []), t]);
  }
  for (const name of [
    tr("Overdue"),
    tr("Due today"),
    tr("In progress"),
    tr("Waiting for a reply"),
    tr("Upcoming"),
    tr("No due date"),
    tr("Done"),
  ]) {
    const tasks = groups.get(name);
    if (!tasks) continue;
    list.append(el("h2", name + " · " + tasks.length, "group-title"));
    for (const t of tasks) {
      const article = el(
        "article",
        undefined,
        "task" + (t.status === "done" ? " done" : ""),
      );
      const row = el("div", undefined, "task-row");
      const check = el("input");
      check.type = "checkbox";
      check.checked = t.status === "done";
      check.setAttribute(
        "aria-label",
        tr(
          t.status === "done" ? "Reopen “{title}”" : "Mark “{title}” as done",
          { title: t.title },
        ),
      );
      check.onchange = () => {
        void action({
          op: "update",
          doc_id: t.doc_id,
          revision: t.revision,
          patch: { status: check.checked ? "done" : "open" },
        }).then((ok) => {
          if (!ok) check.checked = t.status === "done";
        });
      };
      const prio = button(
        "P" + t.prio,
        () => {
          void action({
            op: "update",
            doc_id: t.doc_id,
            revision: t.revision,
            patch: { prio: t.prio === 3 ? 1 : t.prio + 1 },
          });
        },
        "prio p" + t.prio,
      );
      prio.setAttribute(
        "aria-label",
        tr("Change priority of “{title}”, currently P{priority}", {
          title: t.title,
          priority: t.prio,
        }),
      );
      const body = el("div", undefined, "task-body");
      body.append(el("div", t.title, "task-title"));
      const badges = el("div", undefined, "badges");
      badges.append(
        el(
          "span",
          areaLabel(t.area) + (t.areaAuto ? " ?" : ""),
          "badge area" + (t.areaAuto ? " auto" : ""),
        ),
      );
      if (t.owner) badges.append(el("span", t.owner));
      if (t.due)
        badges.append(
          el(
            "span",
            tr(
              t.due < today && t.status !== "done"
                ? "overdue since {date}"
                : "due {date}",
              { date: dateLabel(t.due) },
            ),
            "due" + (t.due < today && t.status !== "done" ? " overdue" : ""),
          ),
        );
      if (t.category)
        badges.append(
          el("span", tr(categories[t.category]), "badge " + t.category),
        );
      if (t.status !== "open")
        badges.append(el("span", tr(labels[t.status]), "badge"));
      if (t.autoDone)
        badges.append(el("span", tr("Automatically completed"), "badge"));
      if (t.hr) badges.append(el("span", tr("Personnel"), "badge"));
      badges.append(
        el(
          "span",
          t.source.title === "Manuell angelegt"
            ? tr("Manually created")
            : t.source.title,
          "source-mini",
        ),
      );
      body.append(badges);
      const toggle = button(
        "",
        () => {
          if (expanded.has(t.doc_id)) expanded.delete(t.doc_id);
          else expanded.add(t.doc_id);
          renderList();
        },
        "expand",
      );
      toggle.setAttribute(
        "aria-label",
        tr("Details for “{title}”", { title: t.title }),
      );
      toggle.setAttribute("aria-expanded", String(expanded.has(t.doc_id)));
      row.append(check, prio, body, toggle);
      article.append(row);
      if (expanded.has(t.doc_id)) {
        const details = el("div", undefined, "details");
        const dl = el("dl");
        for (const [label, value] of [
          [tr("Latest update"), t.hint],
          [tr("Completion evidence"), t.autoDone ? t.completionEvidence : ""],
          [tr("How the assistant can help"), t.help],
          [tr("Required input / Context"), t.needs],
          [tr("Your note"), t.note],
        ])
          if (value) dl.append(el("dt", label), el("dd", value));
        dl.append(el("dt", tr("Sources")));
        const sources = el("dd");
        for (const s of [t.source, ...t.sources]) sources.append(sourceLink(s));
        dl.append(sources);
        details.append(
          dl,
          button(tr("Edit"), () => openEditor(t)),
          el(
            "div",
            t.doc_id +
              " · " +
              tr("updated {date}", { date: dateLabel(t.updatedAt) }),
            "source-mini",
          ),
        );
        article.append(details);
      }
      list.append(article);
    }
  }
}
let refreshPending = false;
// Language changes update labels in place, preserving unsaved form values and notes.
const languageObserver = new MutationObserver(() => {
  const next = createI18n(document.documentElement.lang);
  if (next.locale === i18n.locale) return;
  i18n = next;
  localizeStaticCopy();
  for (const select of [selectArea, field("area") as HTMLSelectElement])
    for (const option of select.options)
      option.textContent = option.value
        ? areaLabel(option.value as keyof typeof AREAS)
        : tr("All areas");
  adjustForm();
  document.querySelector("#editor-title")!.textContent = tr(
    editing ? "Edit task" : "New task",
  );
  render();
});
languageObserver.observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["lang"],
});
window.addEventListener("pagehide", () => languageObserver.disconnect(), {
  once: true,
});
async function invalidate() {
  if (refreshPending) return;
  refreshPending = true;
  try {
    await refresh();
  } finally {
    refreshPending = false;
  }
}
render();
void refresh();
if (companyId) {
  const unsub = db.collection("tasks").onSnapshot(() => {
    void invalidate();
  });
  window.addEventListener("pagehide", unsub, { once: true });
}
