// Share a report (pure rules, unit tested). A report screen builds a small document of what it shows; the server freezes it as it is now, with names hidden unless the owner chose
// to include them, and keeps it behind an unguessable token. The shared page shows only this document. Nothing here reads the database.

export const REPORT_SHARE_CHOICES = [1, 7, 14, 30] as const;
export const REPORT_SHARE_DEFAULT_DAYS = 14;
/** 24 random bytes = 192 bits, written as 32 URL-safe characters. */
export const REPORT_ID = /^[A-Za-z0-9_-]{32}$/;
export const REPORT_KINDS = ["today", "weekly", "clients", "speed", "other"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

/** A piece of text, or text that names a person or a client account (hidden unless the owner chose to include names). */
export type Cell = string | { pii: string; as?: "account" | "person" };
export type DocSection = {
  heading: string;
  lines?: Cell[];
  stats?: Array<{ label: string; value: Cell; note?: string }>;
  table?: { columns: string[]; rows: Cell[][] };
};
export type ReportDocInput = { title: string; scope: Cell; period?: string | null; brandName?: string | null; sections: DocSection[]; notes?: string[] };
/** What is stored and shown: plain text only. */
export type StoredReport = {
  v: 1; kind: ReportKind; title: string; scope: string; period: string | null; brandName: string | null; takenAt: string; namesIncluded: boolean;
  sections: Array<{ heading: string; lines: string[]; stats: Array<{ label: string; value: string; note: string | null }>; table: { columns: string[]; rows: string[][] } | null }>;
  notes: string[];
};

export const MAX_BYTES = 64 * 1024;
const LIM = { title: 120, text: 300, sections: 12, lines: 40, stats: 12, cols: 8, rows: 60, notes: 10 } as const;

export const validReportId = (id: unknown): id is string => typeof id === "string" && REPORT_ID.test(id);
export const choiceDays = (v: unknown): number => (typeof v === "number" && (REPORT_SHARE_CHOICES as readonly number[]).includes(v) ? v : REPORT_SHARE_DEFAULT_DAYS);
export const isReportKind = (v: unknown): v is ReportKind => typeof v === "string" && (REPORT_KINDS as readonly string[]).includes(v);

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Turns cells into text. Hidden names become "Client account N" (the same account always gets the same number) or "Name hidden". */
function resolver(includeNames: boolean) {
  const aliases = new Map<string, string>();
  return (c: Cell | undefined): string => {
    if (typeof c === "string") return clean(c, LIM.text);
    if (!c || typeof c !== "object" || typeof c.pii !== "string") return "";
    if (includeNames) return clean(c.pii, LIM.text);
    if (c.as === "account") {
      const key = clean(c.pii, LIM.text).toLowerCase();
      if (!aliases.has(key)) aliases.set(key, `Client account ${aliases.size + 1}`);
      return aliases.get(key)!;
    }
    return "Name hidden";
  };
}

export type Frozen = { ok: true; report: StoredReport } | { ok: false; error: string };

/** Validates what the browser sent and freezes it. Everything is cut to a fixed size, control characters are removed, and nothing is ever treated as markup or a link. */
export function freezeReport(input: unknown, kind: ReportKind, includeNames: boolean, now: Date): Frozen {
  if (!input || typeof input !== "object") return { ok: false, error: "There is nothing to share." };
  const d = input as Partial<ReportDocInput>;
  const title = clean(d.title, LIM.title);
  if (!title) return { ok: false, error: "The report has no title." };
  if (!Array.isArray(d.sections) || d.sections.length === 0) return { ok: false, error: "The report is empty." };
  const text = resolver(includeNames);
  const sections = d.sections.slice(0, LIM.sections).map((s) => {
    const sec = (s ?? {}) as Partial<DocSection>;
    const cols = Array.isArray(sec.table?.columns) ? sec.table!.columns.slice(0, LIM.cols).map((c) => clean(c, 60)) : [];
    return {
      heading: clean(sec.heading, LIM.title),
      lines: Array.isArray(sec.lines) ? sec.lines.slice(0, LIM.lines).map(text).filter(Boolean) : [],
      stats: Array.isArray(sec.stats) ? sec.stats.slice(0, LIM.stats).map((x) => ({ label: clean(x?.label, 80), value: text(x?.value), note: clean(x?.note, LIM.text) || null })).filter((x) => x.label && x.value) : [],
      table: cols.length > 0 && Array.isArray(sec.table?.rows) ? { columns: cols, rows: sec.table!.rows.slice(0, LIM.rows).map((r) => (Array.isArray(r) ? r.slice(0, cols.length).map(text) : [])) } : null,
    };
  }).filter((s) => s.heading || s.lines.length || s.stats.length || s.table);
  if (sections.length === 0) return { ok: false, error: "The report is empty." };
  const report: StoredReport = {
    v: 1, kind, title, scope: text(d.scope) || "Report", period: clean(d.period, 100) || null, brandName: clean(d.brandName, 80) || null, takenAt: now.toISOString(), namesIncluded: includeNames,
    sections, notes: Array.isArray(d.notes) ? d.notes.slice(0, LIM.notes).map((n) => clean(n, LIM.text)).filter(Boolean) : [],
  };
  if (JSON.stringify(report).length > MAX_BYTES) return { ok: false, error: "The report is too large to share." };
  return { ok: true, report };
}

/** The words next to a link on the screen. */
export const expiryWords = (expiresAt: Date, now = new Date()): string => {
  const days = Math.ceil((expiresAt.getTime() - now.getTime()) / 86_400_000);
  return days <= 0 ? "expired" : days === 1 ? "expires within a day" : `expires in ${days} days`;
};
