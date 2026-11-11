export const AREAS = {
  security: "Security",
  infrastructure: "Infrastruktur",
  software: "Software",
  data: "Data",
  finance: "Budget/Finanzen",
  compliance: "Compliance/DSGVO",
  org: "Organisation",
} as const;
export const PROVIDERS = ["outlook", "teams", "fyxer"] as const;
export type Provider = (typeof PROVIDERS)[number];
export type Source = {
  title: string;
  date: string;
  at?: string;
  url?: string;
  provider?: Provider;
  externalId?: string;
};
export type Task = {
  doc_id: string;
  kind: "mine" | "delegated";
  title: string;
  owner?: string;
  due: string | null;
  prio: 1 | 2 | 3;
  status: "open" | "doing" | "waiting" | "done";
  category?: "direct" | "partial" | "blocked";
  area: keyof typeof AREAS;
  areaAuto: boolean;
  help: string;
  needs: string;
  note: string;
  hint: string;
  source: Source;
  sources: Source[];
  autoDone: boolean;
  hr?: boolean;
  createdAt: string;
  updatedAt: string;
  doneAt: string | null;
  revision: number;
  taskKey?: string;
  sourceKeys: string[];
  protectedFields: string[];
  hintAt?: string;
  completionEvidence?: string;
};
export type Candidate = Partial<Task> & {
  title: string;
  source: Source;
  sourceKey: string;
  taskKey: string;
  existingId?: string;
  completionEvidence?: string;
};
export type SourceState = {
  provider: Provider;
  status: "never" | "running" | "ok" | "partial" | "error";
  lastSuccessAt?: string;
  checkedAt?: string;
  message: string;
  coverageFrom?: string;
  coverageTo?: string;
  runId?: string;
  count?: number;
};
export class BoardError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new BoardError(400, "Ungültige Daten.");
  return value as Record<string, unknown>;
}
export function text(value: unknown, max = 4000): string {
  if (typeof value !== "string" || value.length > max)
    throw new BoardError(400, "Text fehlt oder ist zu lang.");
  return value.trim();
}
export function date(value: unknown): string | null {
  if (value === null || value === "") return null;
  const s = text(value, 10);
  const d = new Date(s + "T12:00:00Z");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(s) ||
    !Number.isFinite(d.getTime()) ||
    d.toISOString().slice(0, 10) !== s
  )
    throw new BoardError(400, "Ungültiges Datum.");
  return s;
}
function oneOf<T extends string>(v: unknown, items: readonly T[]): T {
  if (!items.includes(v as T)) throw new BoardError(400, "Ungültige Auswahl.");
  return v as T;
}
export function source(value: unknown): Source {
  const v = object(value);
  const rawDate = text(v.date, 50);
  const sourceDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
    ? date(rawDate)
    : /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(rawDate) &&
        Number.isFinite(Date.parse(rawDate))
      ? localDay(new Date(rawDate))
      : null;
  const s: Source = { title: text(v.title, 500), date: sourceDate! };
  if (!s.title || !s.date)
    throw new BoardError(400, "Die Quelle braucht Titel und Datum.");
  if (v.at) s.at = text(v.at, 100);
  const sourceUrl = v.url ?? v.link;
  if (sourceUrl) {
    let u: URL;
    try {
      u = new URL(text(sourceUrl, 2000));
    } catch {
      throw new BoardError(400, "Ungültiger Quellenlink.");
    }
    if (!["https:", "http:"].includes(u.protocol) || u.username || u.password)
      throw new BoardError(400, "Ungültiger Quellenlink.");
    s.url = u.href;
  }
  if (v.provider) s.provider = oneOf(v.provider, PROVIDERS);
  if (v.externalId) s.externalId = text(v.externalId, 1000);
  return s;
}
export function patch(value: unknown): Partial<Task> {
  const v = object(value);
  const out: Record<string, unknown> = {};
  for (const k of ["title", "owner", "help", "needs", "note", "hint"] as const)
    if (k in v) out[k] = text(v[k], k === "title" ? 500 : 8000);
  if ("title" in out && !out.title)
    throw new BoardError(400, "Gib einen Titel ein.");
  if ("kind" in v) out.kind = oneOf(v.kind, ["mine", "delegated"]);
  if ("status" in v)
    out.status = oneOf(v.status, ["open", "doing", "waiting", "done"]);
  if ("category" in v)
    out.category = oneOf(v.category, ["direct", "partial", "blocked"]);
  if ("area" in v) out.area = oneOf(v.area, Object.keys(AREAS));
  if ("due" in v) out.due = date(v.due);
  if ("prio" in v) {
    if (![1, 2, 3].includes(v.prio as number))
      throw new BoardError(400, "Priorität muss 1, 2 oder 3 sein.");
    out.prio = v.prio;
  }
  if ("hr" in v) {
    if (typeof v.hr !== "boolean")
      throw new BoardError(400, "Ungültiges Personal-Flag.");
    out.hr = v.hr;
  }
  return out as Partial<Task>;
}
export function validateTask(t: Task): Task {
  if (!t.title) throw new BoardError(400, "Gib einen Titel ein.");
  if (t.kind === "delegated") {
    if (!t.owner) throw new BoardError(400, "Gib die zuständige Person an.");
    if (t.status === "doing")
      throw new BoardError(
        400,
        "Aufgaben bei anderen können offen, wartend oder erledigt sein.",
      );
    delete t.category;
  } else {
    delete t.owner;
    t.category ??= "partial";
  }
  return t;
}
export function makeTask(
  id: string,
  value: unknown,
  now: string,
  manual = false,
): Task {
  const p = patch(value);
  const v = object(value);
  return validateTask({
    doc_id: id,
    kind: "mine",
    title: "",
    due: null,
    prio: 2,
    status: "open",
    category: "partial",
    area: "org",
    areaAuto: !manual,
    help: "",
    needs: "",
    note: "",
    hint: "",
    source: source(
      v.source ?? { title: "Manuell angelegt", date: localDay(new Date(now)) },
    ),
    sources: [],
    autoDone: false,
    createdAt: now,
    updatedAt: now,
    revision: 1,
    sourceKeys: [],
    protectedFields: manual ? Object.keys(p) : [],
    ...p,
    doneAt: p.status === "done" ? now : null,
  });
}
export function editTask(old: Task, value: unknown, now: string): Task {
  const p = patch(value);
  const next = validateTask({
    ...old,
    ...p,
    updatedAt: now,
    revision: old.revision + 1,
    protectedFields: [...new Set([...old.protectedFields, ...Object.keys(p)])],
  });
  if ("area" in p) next.areaAuto = false;
  if ("status" in p) {
    next.autoDone = false;
    next.doneAt = p.status === "done" ? now : null;
  }
  return next;
}
export function candidate(value: unknown): Candidate {
  const v = object(value);
  const c = {
    ...patch(v),
    title: text(v.title, 500),
    source: source(v.source),
    sourceKey: text(v.sourceKey, 1500),
    taskKey: text(v.taskKey, 500),
  } as Candidate;
  if (!c.sourceKey || !c.taskKey)
    throw new BoardError(400, "Stabile Quell- und Aufgabenschlüssel fehlen.");
  if (v.existingId) c.existingId = text(v.existingId, 100);
  if (v.completionEvidence)
    c.completionEvidence = text(v.completionEvidence, 4000);
  return c;
}
export function mergeTask(old: Task, c: Candidate, now: string): Task {
  const next = {
    ...old,
    sources: [...old.sources],
    sourceKeys: [...old.sourceKeys],
    protectedFields: [...old.protectedFields],
    revision: old.revision + 1,
    updatedAt: now,
  };
  for (const k of [
    "title",
    "kind",
    "owner",
    "due",
    "prio",
    "category",
    "area",
    "help",
    "needs",
    "hr",
  ] as const) {
    if (c[k] !== undefined && !old.protectedFields.includes(k))
      (next as unknown as Record<string, unknown>)[k] = c[k];
  }
  if (
    c.status === "done" &&
    c.completionEvidence &&
    !old.protectedFields.includes("status")
  ) {
    next.status = "done";
    next.doneAt = old.doneAt ?? now;
    next.autoDone = true;
    next.completionEvidence = c.completionEvidence;
  } else if (
    c.status &&
    c.status !== "done" &&
    old.status !== "done" &&
    !old.protectedFields.includes("status")
  )
    next.status = c.status;
  if (!next.sourceKeys.includes(c.sourceKey)) next.sourceKeys.push(c.sourceKey);
  const identity = (s: Source) =>
    JSON.stringify([
      s.provider ?? "",
      s.externalId ?? "",
      s.title,
      s.date,
      s.at ?? "",
      s.url ?? "",
    ]);
  const same = (s: Source) => identity(s) === identity(c.source);
  if (!same(old.source) && !next.sources.some(same))
    next.sources.push(c.source);
  if (c.hint && c.source.date >= (old.hintAt ?? old.source.date)) {
    next.hint = c.hint;
    next.hintAt = c.source.date;
  }
  if (!old.protectedFields.includes("area")) next.areaAuto = true;
  return validateTask(next);
}
export function localDay(d = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  return ["year", "month", "day"]
    .map((k) => parts.find((p) => p.type === k)!.value)
    .join("-");
}
