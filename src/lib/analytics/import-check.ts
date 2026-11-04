// "Check before you import" (stage CLEANUP). Pure: a CSV someone is about to import is compared with the contacts a client account already has, so people already in the
// CRM are not imported twice. The file is read in memory for one request and never stored. Nothing is written anywhere.

import { foldEmail, normName, normPhone } from "./dedupe.ts";
import { EMAIL_SHAPE, phoneDigits } from "./quality.ts";
import { nameSimilarity } from "./name-match.ts";

export const MAX_ROWS = 5000;
export const MAX_BYTES = 1_500_000;

/** Parses CSV text (quotes, commas inside quotes, "" for a quote, CRLF or LF). Returns rows of cells. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === "," || c === ";" || c === "\t") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

export type Columns = { name: number; first: number; last: number; email: number; phone: number };

const find = (head: string[], re: RegExp) => head.findIndex((h) => re.test(h.toLowerCase().replace(/[^a-z ]/g, " ").trim()));

/** Which column is the name, email and phone, read from the header row ("Email", "E-mail address", "Mobile phone", "First name"...). -1 when there is none. */
export function detectColumns(head: string[]): Columns {
  return {
    first: find(head, /^(first ?name|firstname|given name|forename)$/), last: find(head, /^(last ?name|lastname|surname|family name)$/),
    name: find(head, /^(name|full ?name|contact ?name|contact)$/), email: find(head, /e ?mail/), phone: find(head, /phone|mobile|cell|tel/),
  };
}

export type Existing = { id: string; name: string; email: string | null; phone: string | null };
export type Verdict = "exists" | "maybe" | "again" | "new" | "invalid";
export type CheckedRow = { row: number; name: string; email: string; phone: string; verdict: Verdict; why: string; match: { id: string; name: string } | null };
export type Check = {
  total: number; counts: Record<Verdict, number>; rows: CheckedRow[]; columns: Columns; found: { name: boolean; email: boolean; phone: boolean };
  /** An error in words when the file cannot be read as a list of people; null otherwise. */
  problem: string | null;
};

const EMPTY: Check = { total: 0, counts: { exists: 0, maybe: 0, again: 0, new: 0, invalid: 0 }, rows: [], columns: { name: -1, first: -1, last: -1, email: -1, phone: -1 }, found: { name: false, email: false, phone: false }, problem: null };

/**
 * Compares each row of the file with the account's contacts: "exists" (the same email or phone number), "maybe" (a similar name, nothing else to go on),
 * "again" (the same person twice in the file), "invalid" (an email or number that cannot work) and "new". The first match wins in that order.
 */
export function checkImport(text: string, existing: readonly Existing[]): Check {
  if (text.length > MAX_BYTES) return { ...EMPTY, problem: "That file is too big to check here. Split it into files of 5,000 rows or fewer." };
  const rows = parseCsv(text);
  if (rows.length < 2) return { ...EMPTY, problem: "The file needs a header row (Name, Email, Phone) and at least one person." };
  const head = rows[0];
  const col = detectColumns(head);
  const found = { name: col.name >= 0 || col.first >= 0, email: col.email >= 0, phone: col.phone >= 0 };
  if (!found.name && !found.email && !found.phone) return { ...EMPTY, columns: col, problem: "SubSync could not find a Name, Email or Phone column in the first row. Rename the headings and try again." };
  const body = rows.slice(1, MAX_ROWS + 1);

  const byEmail = new Map<string, Existing>();
  const byPhone = new Map<string, Existing>();
  const byName = new Map<string, Existing[]>();
  for (const e of existing) {
    const em = foldEmail(e.email);
    if (em && !byEmail.has(em)) byEmail.set(em, e);
    const ph = normPhone(e.phone);
    if (ph && !byPhone.has(ph)) byPhone.set(ph, e);
    const nm = normName(e.name);
    if (nm.includes(" ")) (byName.get(nm.split(" ").slice(-1)[0]) ?? byName.set(nm.split(" ").slice(-1)[0], []).get(nm.split(" ").slice(-1)[0])!).push(e);
  }
  const seen = new Set<string>();
  const counts = { exists: 0, maybe: 0, again: 0, new: 0, invalid: 0 };
  const out: CheckedRow[] = [];
  body.forEach((cells, i) => {
    const get = (n: number) => (n >= 0 ? (cells[n] ?? "").trim() : "");
    const name = col.name >= 0 ? get(col.name) : `${get(col.first)} ${get(col.last)}`.trim();
    const email = get(col.email);
    const phone = get(col.phone);
    let verdict: Verdict = "new";
    let why = "Not in this account yet.";
    let match: CheckedRow["match"] = null;
    const em = foldEmail(email);
    const ph = normPhone(phone);
    if ((email && !EMAIL_SHAPE.test(email)) || (phone && (phoneDigits(phone) < 7 || phoneDigits(phone) > 15))) {
      verdict = "invalid"; why = email && !EMAIL_SHAPE.test(email) ? "The email address cannot work." : "The phone number is too short or too long.";
    } else if (em && byEmail.has(em)) { const m = byEmail.get(em)!; verdict = "exists"; why = "Same email as a contact already in this account."; match = { id: m.id, name: m.name }; }
    else if (ph && byPhone.has(ph)) { const m = byPhone.get(ph)!; verdict = "exists"; why = "Same phone number as a contact already in this account."; match = { id: m.id, name: m.name }; }
    else {
      const key = em ? "e:" + em : ph ? "p:" + ph : "";
      if (key && seen.has(key)) { verdict = "again"; why = "The same person appears earlier in this file."; }
      else {
        const last = normName(name).split(" ").slice(-1)[0];
        const m = last && name.includes(" ") ? (byName.get(last) ?? []).find((e) => nameSimilarity(name, e.name).kind !== "none") : undefined;
        if (m) { verdict = "maybe"; why = "A contact with a similar name is already here. Check before importing."; match = { id: m.id, name: m.name }; }
      }
      if (key) seen.add(key);
    }
    counts[verdict]++;
    out.push({ row: i + 2, name, email, phone, verdict, why, match });
  });
  return { total: body.length, counts, rows: out, columns: col, found, problem: rows.length - 1 > MAX_ROWS ? `Only the first ${MAX_ROWS.toLocaleString("en-US")} rows were checked.` : null };
}

/** The rows that are safe to import: new people and nobody else, as CSV text. */
export function cleanCsv(check: Check): string {
  const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return ["Name,Email,Phone", ...check.rows.filter((r) => r.verdict === "new").map((r) => [r.name, r.email, r.phone].map(q).join(","))].join("\n");
}
