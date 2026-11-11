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
const labels = {
  open: "Offen",
  doing: "In Arbeit",
  waiting: "Wartet",
  done: "Erledigt",
};
const categories = {
  direct: "Direkt machbar",
  partial: "Teilweise",
  blocked: "Blockiert",
};
const providers = {
  outlook: "Outlook",
  teams: "Teams",
  fyxer: "Fyxer-Meetings",
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
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Berlin",
  }).format(new Date(value.length === 10 ? value + "T12:00:00Z" : value));
}
function error(e: unknown) {
  const n = document.querySelector<HTMLElement>("#error")!;
  n.hidden = false;
  n.textContent = e instanceof Error ? e.message : String(e);
}
function clearError() {
  document.querySelector<HTMLElement>("#error")!.hidden = true;
}
async function api(body?: Record<string, unknown>) {
  if (!companyId)
    throw new Error(
      "Öffne das Aufgaben-Board über „Meine Aufgaben“ in Paperclip.",
    );
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
      "Paperclip antwortet nicht mit gültigen Daten. Bitte melde dich erneut an.",
    );
  }
  if (!response.ok)
    throw new Error(value.error ?? "Die Anfrage ist fehlgeschlagen.");
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
root.innerHTML = `<main><div class="heading"><div><h1>Aufgaben-Board</h1><p class="subtitle" id="subtitle">Deine Aufgaben aus Outlook, Teams und Fyxer.</p></div><div class="heading-actions"><button id="theme" type="button" aria-label="Hell- und Dunkelmodus wechseln">◐</button><button id="add" class="primary" type="button">+ Aufgabe</button></div></div><div id="error" class="error" role="alert" hidden></div><div id="notice" class="notice" role="status" hidden></div><div id="stats" class="stats"></div><details class="sources" id="source-panel"><summary id="source-summary"></summary><div id="source-grid" class="source-grid"></div><div id="setup" class="setup"></div></details><div class="controls"><div id="kind-tabs" class="segmented" aria-label="Zuständigkeit"></div><div id="status-tabs" class="segmented" aria-label="Aufgabenstatus"></div><select id="area" aria-label="Bereich filtern"><option value="">Alle Bereiche</option></select><input id="search" type="search" placeholder="Suchen: Titel, Person, Gespräch" aria-label="Aufgaben durchsuchen"></div><div id="list" aria-live="polite"></div><p class="footer-note">Sebastians Aufgaben-Board · Deine Bearbeitungen bleiben bei späteren Imports erhalten. „Bei anderen“ erteilt keinen Ausführungsauftrag.</p></main><dialog id="editor" aria-labelledby="editor-title"><div class="dialog-head"><h2 id="editor-title">Aufgabe bearbeiten</h2><button id="close-editor" type="button" aria-label="Dialog schließen">×</button></div><form id="task-form"><div class="form-grid"><label class="wide">Aufgabe<input name="title" required maxlength="500" placeholder="Was ist der nächste konkrete Schritt?"></label><label>Zuständigkeit<select name="kind"><option value="mine">Meine Aufgabe</option><option value="delegated">Bei anderen</option></select></label><label id="owner-label">Person<input name="owner" maxlength="300"></label><label>Fällig am<input name="due" type="date"></label><label>Priorität<select name="prio"><option value="1">P1 · Hoch</option><option value="2">P2 · Normal</option><option value="3">P3 · Niedrig</option></select></label><label>Status<select name="status"></select></label><label>Bereich<select name="area"></select></label><label id="category-label">Machbarkeit<select name="category"><option value="direct">Direkt machbar</option><option value="partial">Teilweise</option><option value="blocked">Blockiert</option></select></label><label class="check-label"><input type="checkbox" name="hr">Personal</label><label class="wide">Deine Notiz<textarea name="note" maxlength="8000" placeholder="Deine Gedanken und nächsten Schritte"></textarea></label><label class="wide">So kann der Assistent helfen<textarea name="help" maxlength="8000"></textarea></label><label class="wide">Benötigte Angaben / Kontext<textarea name="needs" maxlength="8000"></textarea></label></div><div id="editor-error" class="error" role="alert" hidden></div><div class="footer"><button id="cancel" type="button">Abbrechen</button><button type="submit" class="primary">Speichern</button></div></form></dialog>`;
const selectArea = document.querySelector<HTMLSelectElement>("#area")!;
const form = document.querySelector<HTMLFormElement>("#task-form")!;
const dialog = document.querySelector<HTMLDialogElement>("#editor")!;
for (const [value, label] of Object.entries(AREAS)) {
  selectArea.add(new Option(label, value));
  (form.elements.namedItem("area") as HTMLSelectElement).add(
    new Option(label, value),
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
      .map(([k, v]) => new Option(v, k)),
  );
  status.value = [...status.options].some((o) => o.value === current)
    ? current
    : "open";
}
function openEditor(task: Task | null) {
  editing = task;
  form.reset();
  document.querySelector("#editor-title")!.textContent = task
    ? "Aufgabe bearbeiten"
    : "Neue Aufgabe";
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
    n.textContent = err instanceof Error ? err.message : String(err);
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
      const b = button(label, () => {
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
    { mine: "Meine", delegated: "Bei anderen" },
    kind,
    (v) => (kind = v),
  );
  tabs(
    "status-tabs",
    { open: "Offen", done: "Erledigt", all: "Alle" },
    view,
    (v) => (view = v),
  );
  document.querySelector("#subtitle")!.textContent =
    "Deine Aufgaben aus Outlook, Teams und Fyxer. " +
    (data.lastReport
      ? "Zuletzt erfolgreich geprüft: " + dateLabel(data.lastReport) + "."
      : "Noch kein erfolgreicher Import.");
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
    [mine.length, "Offen", false],
    [mine.filter((t) => t.due && t.due < today).length, "Überfällig", true],
    [mine.filter((t) => t.due === today).length, "Heute fällig", false],
    [mine.filter((t) => t.prio === 1).length, "P1", false],
    [others.length, "Bei anderen offen", false],
    [
      others.filter((t) => t.due && t.due < today).length,
      "davon überfällig",
      true,
    ],
  ];
  const stats = document.querySelector("#stats")!;
  stats.replaceChildren(
    ...items.map(([n, label, red]) => {
      const e = el("div", undefined, "stat" + (red ? " overdue" : ""));
      e.append(el("strong", String(n)), document.createTextNode(label));
      return e;
    }),
  );
}
function renderSources() {
  const summary = document.querySelector("#source-summary")!;
  summary.replaceChildren(
    el("strong", "Quellen & Morning Brief"),
    el(
      "span",
      data.allSourcesOk
        ? "Alle Quellen geprüft"
        : "Quellenprüfung offen oder unvollständig",
      "source-mini",
    ),
  );
  const grid = document.querySelector("#source-grid")!;
  grid.replaceChildren(
    ...data.sources.map((s) => {
      const card = el("div", undefined, "source-card");
      card.append(
        el("strong", providers[s.provider]),
        el(
          "span",
          {
            never: "Noch nicht geprüft",
            running: "Prüfung läuft",
            ok: "Geprüft",
            partial: "Teilweise geprüft",
            error: "Zugriff fehlgeschlagen",
          }[s.status],
          s.status === "ok" ? "ok" : s.status === "error" ? "error-text" : "",
        ),
        el("p", s.message),
      );
      if (s.lastSuccessAt)
        card.append(
          el("div", "Erfolgreich bis " + dateLabel(s.lastSuccessAt), "muted"),
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
  agent.setAttribute("aria-label", "Import-Agent");
  agent.add(new Option("Import-Agent wählen", ""));
  for (const a of data.agents)
    agent.add(new Option(a.name + " · " + a.status, a.id));
  agent.value = data.collectorAgentId ?? "";
  const save = button("Agent einrichten", () => {
    if (agent.value) void action({ op: "configure", agentId: agent.value });
  });
  const run = button(
    "Office & Fyxer jetzt prüfen",
    () => {
      void action({ op: "run" }).then((ok) => {
        if (ok) {
          const n = document.querySelector<HTMLElement>("#notice")!;
          n.hidden = false;
          n.textContent =
            "Der Importauftrag wurde gestartet. Ergebnisse erscheinen hier, sobald sie gespeichert sind.";
        }
      });
    },
    "primary",
  );
  run.disabled = !data.collectorAgentId;
  const enabled = data.routine?.status === "active";
  const schedule = button(
    enabled ? "Morning Brief pausieren" : "Morning Brief aktivieren",
    () => {
      void action({ op: "schedule", enabled: !enabled });
    },
  );
  schedule.disabled = !data.routine;
  setup.replaceChildren(
    el(
      "p",
      "Der Import-Agent liest Outlook, Teams und Fyxer. Die tägliche Routine läuft nach Aktivierung werktags um 09:00 Uhr (Berlin). Deine Quellen werden nur gelesen.",
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
    s.title + " · " + dateLabel(s.date) + (s.at ? " · " + s.at : "");
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
    q = search.trim().toLocaleLowerCase("de");
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
            .toLocaleLowerCase("de")
            .includes(q)),
    )
    .sort(
      (a, b) =>
        a.prio - b.prio ||
        (a.due ?? "9999").localeCompare(b.due ?? "9999") ||
        a.title.localeCompare(b.title, "de"),
    );
  const list = document.querySelector("#list")!;
  list.replaceChildren();
  if (!items.length) {
    const e = el("div", undefined, "empty");
    e.append(
      el(
        "strong",
        data.tasks.length
          ? "Keine passenden Aufgaben"
          : "Dein Aufgaben-Board ist bereit",
      ),
      el(
        "p",
        data.tasks.length
          ? "Passe deine Suche oder Filter an."
          : "Lege eine Aufgabe an oder richte unter „Quellen & Morning Brief“ deinen Import-Agenten ein.",
      ),
    );
    list.append(e);
    return;
  }
  const groups = new Map<string, Task[]>();
  for (const t of items) {
    const group =
      t.status === "done"
        ? "Erledigt"
        : t.due && t.due < today
          ? "Überfällig"
          : t.due === today
            ? "Heute fällig"
            : t.status === "waiting"
              ? "Wartet auf Rückmeldung"
              : t.status === "doing"
                ? "In Arbeit"
                : t.due
                  ? "Anstehend"
                  : "Ohne Termin";
    groups.set(group, [...(groups.get(group) ?? []), t]);
  }
  for (const name of [
    "Überfällig",
    "Heute fällig",
    "In Arbeit",
    "Wartet auf Rückmeldung",
    "Anstehend",
    "Ohne Termin",
    "Erledigt",
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
        t.status === "done"
          ? "„" + t.title + "“ wieder öffnen"
          : "„" + t.title + "“ erledigen",
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
        "Priorität von „" + t.title + "“ ändern, aktuell P" + t.prio,
      );
      const body = el("div", undefined, "task-body");
      body.append(el("div", t.title, "task-title"));
      const badges = el("div", undefined, "badges");
      badges.append(
        el(
          "span",
          AREAS[t.area] + (t.areaAuto ? " ?" : ""),
          "badge area" + (t.areaAuto ? " auto" : ""),
        ),
      );
      if (t.owner) badges.append(el("span", t.owner));
      if (t.due)
        badges.append(
          el(
            "span",
            (t.due < today && t.status !== "done"
              ? "überfällig seit "
              : "fällig ") + dateLabel(t.due),
            "due" + (t.due < today && t.status !== "done" ? " overdue" : ""),
          ),
        );
      if (t.category)
        badges.append(
          el("span", categories[t.category], "badge " + t.category),
        );
      if (t.status !== "open")
        badges.append(el("span", labels[t.status], "badge"));
      if (t.autoDone)
        badges.append(el("span", "Automatisch erledigt", "badge"));
      if (t.hr) badges.append(el("span", "Personal", "badge"));
      badges.append(el("span", t.source.title, "source-mini"));
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
      toggle.setAttribute("aria-label", "Details zu „" + t.title + "“");
      toggle.setAttribute("aria-expanded", String(expanded.has(t.doc_id)));
      row.append(check, prio, body, toggle);
      article.append(row);
      if (expanded.has(t.doc_id)) {
        const details = el("div", undefined, "details");
        const dl = el("dl");
        for (const [label, value] of [
          ["Neuester Stand", t.hint],
          ["Abschlussnachweis", t.autoDone ? t.completionEvidence : ""],
          ["So kann der Assistent helfen", t.help],
          ["Benötigte Angaben / Kontext", t.needs],
          ["Deine Notiz", t.note],
        ])
          if (value) dl.append(el("dt", label), el("dd", value));
        dl.append(el("dt", "Herkunft"));
        const sources = el("dd");
        for (const s of [t.source, ...t.sources]) sources.append(sourceLink(s));
        dl.append(sources);
        details.append(
          dl,
          button("Bearbeiten", () => openEditor(t)),
          el(
            "div",
            t.doc_id + " · geändert " + dateLabel(t.updatedAt),
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
