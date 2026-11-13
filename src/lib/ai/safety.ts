// The safety layer for every AI job (docs/AI_AGENTS_PLAN.md section 3). Pure. The model writes words; every number comes from our own SQL. An output is shown only when it passes:
//   1. the number check: every number in the words was in the input we sent;  2. the banned-claim list (nothing "sent", "fixed" or promised, no links, no addresses, no vendor words);
//   3. the length limit.  For jobs that return JSON, `validateJson` checks the shape first. Outputs are suggestions only: nothing here, or anywhere an agent runs, writes to the CRM or messages a lead.

const WORDS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, twenty: 20, thirty: 30, fifty: 50, hundred: 100, thousand: 1000, million: 1_000_000, dozen: 12, half: 0.5 };

const norm = (raw: string): string => {
  const n = Number(raw.replace(/[,$%]/g, ""));
  return Number.isFinite(n) ? String(n) : raw;
};

/** Every number written in the text, as a normalised string: 1,200 and $1200 and 1200.0 are all "1200". */
export function numbersIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) out.push(norm(m[0]));
  return out;
}

/** Spelled-out numbers (two to a million). "one" is left alone because it is ordinary speech ("no one", "one of"). */
const spelled = (text: string): string[] => [...text.toLowerCase().matchAll(/\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|fifty|hundred|thousand|million|dozen|half)\b/g)].map((m) => String(WORDS[m[1]]));

/** Numbers in `output` that were not in `input`. Empty means the output passes. Spelled-out numbers count too. */
export function numbersNotInInput(input: string, output: string): string[] {
  const allowed = new Set([...numbersIn(input), ...spelled(input)]);
  return [...numbersIn(output), ...spelled(output)].filter((n) => !allowed.has(n));
}

const BANNED: Array<[RegExp, string]> = [
  [/\b(guarantee[ds]?|promise[ds]?|definitely will|certain to|100 ?%)/i, "a promise"],
  [/\b(we|i|subsync)\s+(have\s+|has\s+|already\s+)?(sent|messaged|emailed|texted|called|contacted|fixed|changed|updated|deleted|merged|replied)\b/i, "a claim that something was done"],
  [/\b(has|have|was|were)\s+(been\s+)?(automatically\s+)?(sent|fixed|deleted|merged|replied to)\b/i, "a claim that something was done"],
  [/https?:\/\/|www\./i, "a link"],
  [/[\w.+-]+@[\w-]+\.[\w.]+/, "an email address"],
  [/\b(gohighlevel|highlevel|ghl|leadconnector)\b/i, "a vendor name"],
  [/\b(as an ai|language model)\b/i, "talk about being an AI"],
];

/** The first banned thing found, in plain words, or null. */
export function bannedClaim(text: string): string | null {
  for (const [re, why] of BANNED) if (re.test(text)) return why;
  return null;
}

export type Verdict = { ok: true } | { ok: false; reason: string };

/** The post-check for a words-only output. `input` is exactly what was sent (every string the model saw). */
export function checkWords(input: string, output: string, maxChars: number): Verdict {
  const text = output.trim();
  if (!text) return { ok: false, reason: "The AI sent back nothing." };
  if (text.length > maxChars) return { ok: false, reason: "The AI wrote more than the limit." };
  const extra = numbersNotInInput(input, text);
  if (extra.length) return { ok: false, reason: `The AI wrote a number we did not give it (${extra.slice(0, 3).join(", ")}), so we did not show it.` };
  const banned = bannedClaim(text);
  if (banned) return { ok: false, reason: `The AI wrote ${banned}, so we did not show it.` };
  return { ok: true };
}

// ---------------- structured output (for the jobs that return JSON) ----------------

/** A small schema: enough to check the shape of a model answer without a library. */
export type Schema =
  | { type: "string"; maxLength?: number; enum?: readonly string[] }
  | { type: "number"; min?: number; max?: number; integer?: boolean }
  | { type: "boolean" }
  | { type: "array"; items: Schema; maxItems?: number }
  | { type: "object"; props: Record<string, Schema>; optional?: readonly string[] };

export function validateJson(value: unknown, s: Schema, path = "answer"): Verdict {
  const bad = (why: string): Verdict => ({ ok: false, reason: `The AI answer was not in the expected shape (${path}: ${why}).` });
  switch (s.type) {
    case "string":
      if (typeof value !== "string") return bad("not text");
      if (s.maxLength !== undefined && value.length > s.maxLength) return bad("too long");
      if (s.enum && !s.enum.includes(value)) return bad("not an allowed value");
      return { ok: true };
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) return bad("not a number");
      if (s.integer && !Number.isInteger(value)) return bad("not a whole number");
      if ((s.min !== undefined && value < s.min) || (s.max !== undefined && value > s.max)) return bad("out of range");
      return { ok: true };
    case "boolean": return typeof value === "boolean" ? { ok: true } : bad("not yes or no");
    case "array": {
      if (!Array.isArray(value)) return bad("not a list");
      if (s.maxItems !== undefined && value.length > s.maxItems) return bad("too many items");
      for (const [i, v] of value.entries()) { const r = validateJson(v, s.items, `${path}[${i}]`); if (!r.ok) return r; }
      return { ok: true };
    }
    case "object": {
      if (!value || typeof value !== "object" || Array.isArray(value)) return bad("not an object");
      const o = value as Record<string, unknown>;
      for (const [k, sub] of Object.entries(s.props)) {
        if (!(k in o)) { if (s.optional?.includes(k)) continue; return bad(`missing ${k}`); }
        const r = validateJson(o[k], sub, `${path}.${k}`); if (!r.ok) return r;
      }
      return { ok: true };
    }
  }
}

/** Pulls the one JSON object out of an answer (models sometimes wrap it in a code fence). Null when there is none. */
export function parseJsonAnswer(text: string): unknown | null {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(t); } catch { /* try the first object in the text */ }
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; } }
  return null;
}

/** Every string value inside a JSON answer, joined: the number check and the banned list run on this for JSON jobs. */
export function stringsOf(v: unknown): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(stringsOf).join(" \n");
  if (v && typeof v === "object") return Object.values(v).map(stringsOf).join(" \n");
  return "";
}
