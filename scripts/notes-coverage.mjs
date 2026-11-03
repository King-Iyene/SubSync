// Keeps docs/NOTES_COVERAGE.md: one row per review note (N1 to N104) and per buyer-review finding, with the stage that handles it and a status.
//   node scripts/notes-coverage.mjs init            build the table from docs/KING_REVIEW_NOTES.md headings and the stage map below
//   node scripts/notes-coverage.mjs set N15 DONE-TONIGHT "evidence text"
//   node scripts/notes-coverage.mjs counts          print the number of rows per status
// Statuses: DONE-TONIGHT, PLANNED-LATER, NEEDS-KING, PARKED, NOT-A-CODE-ITEM.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const NOTES = "docs/KING_REVIEW_NOTES.md";
const OUT = "docs/NOTES_COVERAGE.md";
const STATUSES = ["DONE-TONIGHT", "PLANNED-LATER", "NEEDS-KING", "PARKED", "NOT-A-CODE-ITEM"];

// [stage(s), initial status, reason when it is not simply planned]
const MAP = {
  N1: ["F5, F1, F8", "PLANNED-LATER"], N2: ["F5", "PLANNED-LATER"], N3: ["D0, D1", "PLANNED-LATER"], N4: ["F9, F5, F8", "PLANNED-LATER"],
  N5: ["F2, F4, F9, F8", "PLANNED-LATER"], N6: ["F1, F5", "PLANNED-LATER"], N7: ["F5, F6, D1", "PLANNED-LATER"], N8: ["F1, F5, D0", "PLANNED-LATER"],
  N9: ["D1, F5", "PLANNED-LATER"], N10: ["D0, D1", "PLANNED-LATER"], N11: ["F4, F5", "PLANNED-LATER"], N12: ["F4", "PLANNED-LATER"],
  N13: ["F4", "PLANNED-LATER"], N14: ["F4, D0", "PLANNED-LATER"], N15: ["F1, F4", "PLANNED-LATER"], N16: ["F1 (item 3), F5", "PLANNED-LATER"],
  N17: ["none (progress note)", "NOT-A-CODE-ITEM", "an observation that earlier fixes landed"], N18: ["F2", "PLANNED-LATER"],
  N19: ["D0, D1", "PLANNED-LATER"], N20: ["F10", "PLANNED-LATER"], N21: ["F2, F8", "PLANNED-LATER"], N22: ["F2", "PLANNED-LATER"],
  N23: ["F2, D1", "PLANNED-LATER"], N24: ["F3", "PLANNED-LATER"], N25: ["F3", "PLANNED-LATER"], N26: ["F3", "PLANNED-LATER"],
  N27: ["T1 (never tonight)", "NEEDS-KING", "King must define setter and closer before T1 starts"], N28: ["D0", "PLANNED-LATER"],
  N29: ["D0, D1, F5", "PLANNED-LATER"], N30: ["F2", "PLANNED-LATER"], N31: ["none (keep list)", "NOT-A-CODE-ITEM", "things to keep, no change"],
  N32: ["E2a (E1 later), D0", "PLANNED-LATER"], N33: ["S0.4", "PLANNED-LATER"], N34: ["D0", "PLANNED-LATER"], N35: ["F10, D0", "PLANNED-LATER"],
  N36: ["P1 (never tonight), D0 pattern", "PLANNED-LATER"], N37: ["F1, P1", "PLANNED-LATER"], N38: ["F1, P1", "PLANNED-LATER"], N39: ["F1, P1", "PLANNED-LATER"],
  N40: ["W1 (never tonight)", "PLANNED-LATER"], N41: ["R1", "PARKED", "waits for evidence and King's decision"], N42: ["F9", "PLANNED-LATER"],
  N43: ["none (observations; menu in D0, junk data in F1)", "NOT-A-CODE-ITEM", "observations folded into D0 and F1"],
  N44: ["F1, D0, D1", "PLANNED-LATER"], N45: ["F1", "PLANNED-LATER"], N46: ["F1", "PLANNED-LATER"], N47: ["F1, F2", "PLANNED-LATER"], N48: ["S0.2b, F1", "PLANNED-LATER"],
  N49: ["F10", "PLANNED-LATER"], N50: ["D0, F10", "PLANNED-LATER"], N51: ["F10 (read-only part), W1 (never tonight)", "PLANNED-LATER"], N52: ["D0, D1", "PLANNED-LATER"],
  N53: ["F10", "PLANNED-LATER"], N54: ["F10", "PLANNED-LATER"], N55: ["F10", "PLANNED-LATER"], N56: ["C1", "PLANNED-LATER"], N57: ["R1", "PARKED", "needs financial scopes and evidence first"],
  N58: ["C1, F5", "PLANNED-LATER"], N59: ["C1b (never tonight)", "PLANNED-LATER"], N60: ["C1", "PLANNED-LATER"], N61: ["T1 (never tonight)", "PLANNED-LATER"],
  N62: ["F1, C1 (observations)", "PLANNED-LATER"], N63: ["C1, D0", "PLANNED-LATER"], N64: ["F1 (capability matrix), F8 (scope experience); release in Z2 (King)", "PLANNED-LATER"],
  N65: ["E5 (never tonight)", "PLANNED-LATER"], N66: ["R1", "PARKED", "waits for evidence"], N67: ["C2 (never tonight)", "PLANNED-LATER"], N68: ["C2", "PLANNED-LATER"],
  N69: ["C2", "PLANNED-LATER"], N70: ["C2", "PLANNED-LATER"], N71: ["C2", "PLANNED-LATER"], N72: ["C1, D1", "PLANNED-LATER"], N73: ["S0.2b (N48), C1, C2", "PLANNED-LATER"],
  N74: ["S0.4, D0", "PLANNED-LATER"], N75: ["F8 (Trust page); Z2, Z3 (King)", "PLANNED-LATER"], N76: ["F8, D0, D1", "PLANNED-LATER"], N77: ["F8 (wording), E2a", "PLANNED-LATER"],
  N78: ["F2", "PLANNED-LATER"], N79: ["F9", "PLANNED-LATER"], N80: ["S0.4, F9", "PLANNED-LATER"], N81: ["S0.4, F8", "PLANNED-LATER"], N82: ["S0.2b (item 4)", "PLANNED-LATER"],
  N83: ["S0.2b, F8", "PLANNED-LATER"], N84: ["S0.2b, F8", "PLANNED-LATER"], N85: ["F8, F6, D1", "PLANNED-LATER"], N86: ["F8", "PLANNED-LATER"], N87: ["F8", "PLANNED-LATER"],
  N88: ["CLAUDE.md principles", "NOT-A-CODE-ITEM", "operating principles, saved in CLAUDE.md"], N89: ["F8, D1", "PLANNED-LATER"],
  N90: ["none (status note)", "NOT-A-CODE-ITEM", "a status note"], N91: ["E0 (copy), E1 later", "PLANNED-LATER"], N92: ["E0, F9", "PLANNED-LATER"], N93: ["S0.2b, E0, E2a", "PLANNED-LATER"],
  N94: ["E0", "PLANNED-LATER"], N95: ["E0", "PLANNED-LATER"], N96: ["E0, E2b", "PLANNED-LATER"], N97: ["E2b", "PLANNED-LATER"], N98: ["E0, F9, F10", "PLANNED-LATER"],
  N99: ["E0 (with F2 and F4 tests)", "PLANNED-LATER"], N100: ["none (CFO view)", "NOT-A-CODE-ITEM", "scope advice, already applied in the roadmap order"],
  N101: ["E1 (never tonight)", "PLANNED-LATER"], N102: ["E0, E2a, E2b, F8", "PLANNED-LATER"], N103: ["E0, E2a", "PLANNED-LATER"], N104: ["E0, E2b", "PLANNED-LATER"],
};

const BUYER = [
  ["UX-01", "S1", "Win rate and forecast built on 6 closed deals", "F1"], ["UX-02", "S1", "Two different open pipeline numbers", "F1"],
  ["UX-03", "S1", "Meeting notes page states something no longer true", "F8"], ["UX-04", "S1", "First screen headline is one test deal", "F1, F5"],
  ["UX-05", "S1", "Agency user opened inside a client account lands on the agency view", "F5"], ["UX-06", "S2", "Sync-running banner on almost every load", "S0.4"],
  ["UX-07", "S2", "Clipping at narrow widths", "D0, D1"], ["UX-08", "S2", "Clients page mostly n/a", "C1"], ["UX-09", "S2", "Visual sameness", "D0, D1"],
  ["UX-10", "S2", "Too much text before the content", "D0, D1"], ["UX-11", "S2", "Navigation has 20 items", "D0"], ["UX-12", "S2", "Call lists spins for more than 5 seconds", "F10"],
  ["UX-13", "S2", "Persistent filter bar pushes content down", "F5, D0"], ["S3-a", "S3", "Team shows unresolved names (Team member ZWol)", "F2 (N21)"],
  ["S3-b", "S3", "Duplicates tile shows a scary exact-match number from test data", "C2 (never tonight)"], ["S3-c", "S3", "Meeting notes explainer uses numbered steps for tools most users lack", "F8, E2a"],
  ["S0-none", "S0", "No S0 blocker confirmed in the review (nothing to fix)", "none"],
];

const clean = (t) => t.replace(/\s*\[(KING|MINE|READING)[^\]]*\]/g, "").replace(/\s*\((the big one|very important|strategic decision|needs research|extends N8|strategic and risky|decision with guardrails|and the answer on "industry"|and the answer on .industry.)\)/gi, "").replace(/\|/g, "/").trim();

function init() {
  const lines = readFileSync(NOTES, "utf8").replace(/\r\n/g, "\n").split("\n");
  const rows = [];
  for (const l of lines) {
    const m = l.match(/^### (N\d+)\.\s+(.*)$/);
    if (m) rows.push({ id: m[1], title: clean(m[2]).slice(0, 110), stage: "", status: "", note: "" });
  }
  const ids = rows.map((r) => Number(r.id.slice(1)));
  for (let n = 1; n <= 104; n++) if (!ids.includes(n)) throw new Error(`note N${n} not found in ${NOTES}`);
  for (const r of rows) {
    const m = MAP[r.id];
    if (!m) throw new Error(`no stage map for ${r.id}`);
    r.stage = m[0]; r.status = m[1]; r.note = m[2] ?? "";
  }
  for (const [id, sev, title, stage] of BUYER) rows.push({ id, title: `[${sev}] ${title}`, stage, status: id === "S0-none" ? "NOT-A-CODE-ITEM" : "PLANNED-LATER", note: id === "S0-none" ? "the review found no S0" : "" });
  write(rows);
  console.log(`built ${rows.length} rows`);
}

function parse() {
  const rows = [];
  for (const l of readFileSync(OUT, "utf8").replace(/\r\n/g, "\n").split("\n")) {
    const c = l.split("|").map((x) => x.trim());
    if (c.length >= 7 && /^(N\d+|UX-\d+|S3-[a-c]|S0-none|KF-\d+)$/.test(c[1])) rows.push({ id: c[1], title: c[2], stage: c[3], status: c[4], note: c[5] });
  }
  return rows;
}

function write(rows) {
  const head = existsSync(OUT) ? readFileSync(OUT, "utf8").split("<!-- TABLE -->")[0] : `# Notes coverage ledger\n\nOne row for every review note (N1 to N104) and every buyer-review finding. Maintained with \`node scripts/notes-coverage.mjs\`. Statuses: DONE-TONIGHT (with evidence in the last column), PLANNED-LATER (the stage is named), NEEDS-KING (the item is in docs/NEEDS_KING.md), PARKED (the reason is given), NOT-A-CODE-ITEM (a decision, a question or an observation).\n\nORPHANS (notes with no stage in docs/ROADMAP_V2.md): none found.\n\n`;
  const table = ["<!-- TABLE -->", "| ID | Title | Stage | Status | Evidence or reason |", "| --- | --- | --- | --- | --- |", ...rows.map((r) => `| ${r.id} | ${r.title} | ${r.stage} | ${r.status} | ${r.note} |`)].join("\n");
  writeFileSync(OUT, head + table + "\n");
}

function counts() {
  const rows = parse();
  const by = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const r of rows) by[r.status] = (by[r.status] ?? 0) + 1;
  console.log(`rows: ${rows.length}`, JSON.stringify(by));
  return by;
}

const [cmd, a, b, c] = process.argv.slice(2);
if (cmd === "init") init();
else if (cmd === "set") {
  if (!STATUSES.includes(b)) throw new Error(`status must be one of ${STATUSES.join(", ")}`);
  const rows = parse();
  const r = rows.find((x) => x.id === a);
  if (!r) throw new Error(`no row ${a}`);
  r.status = b; r.note = (c ?? "").replace(/\|/g, "/");
  write(rows);
  counts();
} else if (cmd === "add") {
  const rows = parse();
  if (rows.find((x) => x.id === a)) throw new Error(`${a} already exists`);
  const [title, stage, status] = [b, c, process.argv[6]];
  rows.push({ id: a, title, stage, status, note: process.argv[7] ?? "" });
  write(rows);
  counts();
} else if (cmd === "counts") counts();
else console.log("usage: init | set <ID> <STATUS> [evidence] | counts");
