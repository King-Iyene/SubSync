// Long content in several parts (INTEGRATIONS_SPEC section 8, stage E2b item 3). Pure.
//
// The CRM limits the length of a note, a conversation comment and a field. Content longer than 90 percent of the limit is split at paragraph
// boundaries into "Part 1 of N" items, so nothing is cut off in the middle of a sentence and nothing is lost. A transcript that would need more than
// three parts is not written at all: a link to it in the meeting tool is saved instead, and the note says so.

/** A piece is split once it is longer than this share of the limit, so a small difference in how the CRM counts characters never loses text. */
export const SPLIT_SHARE = 0.9;
/** A transcript needing more parts than this becomes a link. */
export const MAX_TRANSCRIPT_PARTS = 3;
/** Room kept in every part for its "Part 12 of 12" line and the blank line after it. */
const HEADER_ROOM = 20;
/** Nothing is split into pieces smaller than this, whatever limit was passed in. */
const MIN_LIMIT = 200;

/** The most characters one item may hold before it is split. */
export const usableChars = (limit: number): number => Math.floor(Math.max(limit, MIN_LIMIT) * SPLIT_SHARE);

const SEPARATORS = ["\n\n", "\n", ". ", "; ", ", ", " "] as const;

type Atom = { text: string; /** What was between this atom and the one before it in the original text. */ sep: string };

/** One piece cut into atoms none longer than `budget`, at the best boundary available: a line, a sentence, a clause, a word, and only then anywhere. */
function atomsOf(piece: string, budget: number, level = 0): Atom[] {
  if (piece.length <= budget) return [{ text: piece, sep: "" }];
  if (level >= SEPARATORS.length) {
    const out: Atom[] = [];
    for (let i = 0; i < piece.length; i += budget) out.push({ text: piece.slice(i, i + budget), sep: "" });
    return out;
  }
  const sep = SEPARATORS[level];
  const raw = piece.split(sep);
  if (raw.length === 1) return atomsOf(piece, budget, level + 1);
  const newline = sep.startsWith("\n");
  const glue = newline ? sep : sep.endsWith(" ") ? " " : "";
  const out: Atom[] = [];
  raw.forEach((bit, i) => {
    // Punctuation stays at the end of its bit, so joining the atoms again gives the original text.
    const text = i < raw.length - 1 && !newline ? bit + sep.trimEnd() : bit;
    atomsOf(text, budget, level + 1).forEach((a, j) => out.push({ text: a.text, sep: j === 0 ? (i === 0 ? "" : glue) : a.sep }));
  });
  return out;
}

/**
 * The text as ordered pieces, none longer than `budget`. Whole paragraphs are kept together; a paragraph is cut only when it alone is longer than a
 * piece, and then at a line, a sentence or a word. Pieces are filled in order, so a part never starts a new item while the last one has room.
 * Exported for the tests.
 */
export function packParagraphs(text: string, budget: number): string[] {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const atoms: Atom[] = [];
  paragraphs.forEach((p, k) => atomsOf(p, budget).forEach((a, j) => atoms.push({ text: a.text, sep: j === 0 ? (k === 0 ? "" : "\n\n") : a.sep })));
  const pieces: string[] = [];
  let cur = "";
  for (const a of atoms) {
    const next = cur ? cur + a.sep + a.text : a.text;
    if (next.length <= budget) cur = next;
    else { if (cur) pieces.push(cur); cur = a.text; }
  }
  if (cur) pieces.push(cur);
  return pieces.map((x) => x.trim()).filter(Boolean);
}

/**
 * Splits `text` for an item that holds at most `limit` characters. Up to 90 percent of the limit it stays one item, unchanged. Longer, it becomes
 * "Part 1 of N" ... "Part N of N", split at paragraph boundaries (then lines, sentences and words only when one paragraph alone is too long).
 */
export function splitIntoParts(text: string, limit: number): string[] {
  const body = text.trim();
  const usable = usableChars(limit);
  if (body.length <= usable) return [body];
  const pieces = packParagraphs(body, usable - HEADER_ROOM);
  if (pieces.length <= 1) return pieces.length ? [pieces[0]] : [""];
  return pieces.map((p, i) => `Part ${i + 1} of ${pieces.length}\n\n${p}`);
}

export type TranscriptPlan = { kind: "parts"; parts: string[] } | { kind: "link"; neededParts: number };

/** A transcript that fits in `maxParts` parts is split like any other text; a longer one becomes a link (the caller writes the link text). */
export function planTranscript(text: string, limit: number, maxParts: number = MAX_TRANSCRIPT_PARTS): TranscriptPlan {
  const parts = splitIntoParts(text, limit);
  return parts.length > maxParts ? { kind: "link", neededParts: parts.length } : { kind: "parts", parts };
}

/** Removes the "Part i of N" line from a part (the tests and the preview use it to put the text back together). */
export const withoutPartHeader = (part: string): string => part.replace(/^Part \d+ of \d+\n\n/, "");
