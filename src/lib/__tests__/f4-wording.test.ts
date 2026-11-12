import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { visibleText } from "../../../tests/fixtures/visible-text.ts";

// Stage F4 (N11): "SLA" is jargon. No screen, email, alert, export, help text or error says it; the words are "your reply target". The scanner reads the
// code's syntax tree, so only text a person can read is checked (string literals, template text, text in page markup). Identifiers such as `slaHours`,
// the alert kind "sla" (lower case, an internal code) and comments are not text.
const ROOT = join(process.cwd(), "src");
const SLA = /\bSLAs?\b/;

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "__tests__") files(p, out); } else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}
const hits = (source: string, name: string) => visibleText(source, name).filter((f) => SLA.test(f.text)).map((f) => `${f.line}: ${f.text.trim().slice(0, 80)}`);

test("the scanner finds the word in text and ignores identifiers, comments and the internal alert code", () => {
  assert.equal(hits('const m = "Waiting past SLA";', "a.ts").length, 1);
  assert.equal(hits("export const A = () => <p>Reply SLA (hours)</p>;", "a.tsx").length, 1);
  assert.equal(hits("const m = `${n} conversations waiting past the SLA`;", "a.ts").length, 1);
  assert.equal(hits('const slaHours = 4; // the SLA\nconst kind = "sla";', "a.ts").length, 0);
  assert.equal(hits('const m = "Waiting past your reply target";', "a.ts").length, 0);
});

test("no screen, alert, email, export, error or help text says SLA", () => {
  const found: string[] = [];
  let scanned = 0;
  for (const file of files(ROOT)) {
    scanned += 1;
    for (const h of hits(readFileSync(file, "utf8"), file)) found.push(`${file.slice(file.indexOf("src"))}:${h}`);
  }
  assert.ok(scanned > 100, `the scan covers the whole app (${scanned} files)`);
  assert.deepEqual(found, [], 'Say "your reply target" instead.');
});

test("the page is called Unanswered messages everywhere a person sees its name, and its reply button says where it goes (rebuilt in stage UNANS)", () => {
  const page = readFileSync(join(ROOT, "app/app/views/inbox.tsx"), "utf8");
  const rows = readFileSync(join(ROOT, "app/app/views/unanswered-rows.tsx"), "utf8");
  const nav = readFileSync(join(ROOT, "app/app/nav.ts"), "utf8");
  assert.match(nav, /id: "inbox", label: "Unanswered messages"/);
  assert.match(page, /<h1[^>]*>Unanswered messages<\/h1>/);
  assert.ok(/label="Reply"/.test(rows) && rows.includes("open them here"), "the reply button says where it goes (inside SubSync; the panel keeps Open in your CRM)");
  assert.ok(!/Inbox zero|Inbox & SLA/.test(page));
  assert.ok(!/tel:/.test(page + rows + readFileSync(join(ROOT, "app/app/views/unanswered-all.tsx"), "utf8") + readFileSync(join(ROOT, "app/app/views/quiet-deals.tsx"), "utf8")), "no call goes to the phone's own dialer (KF-3)");
});

test("the CRM links on the page come from the white-label helper, never a hard-coded host", () => {
  const router = readFileSync(join(ROOT, "lib/api/router.ts"), "utf8");
  const view = router.slice(router.indexOf("async function inboxView"), router.indexOf("async function inboxViews"));
  assert.match(view, /links\.conversation\(/);
  assert.match(readFileSync(join(ROOT, "lib/api/unanswered-routes.ts"), "utf8"), /h\.conversation\(/, "the rebuilt screen builds its links with the same helper");
  for (const f of ["inbox.tsx", "inbox-controls.tsx", "unanswered-rows.tsx", "unanswered-all.tsx", "unanswered-picture.tsx", "quiet-deals.tsx", "comms-sections.tsx"]) assert.ok(!/gohighlevel|leadconnector/i.test(readFileSync(join(ROOT, "app/app/views", f), "utf8")), f);
});

test("the open deals with no contact are on the Pipeline side now, and no longer on the Unanswered messages page", () => {
  const deals = readFileSync(join(ROOT, "app/app/views/deals.tsx"), "utf8");
  const page = readFileSync(join(ROOT, "app/app/views/inbox.tsx"), "utf8") + readFileSync(join(ROOT, "app/app/views/comms-sections.tsx"), "utf8");
  assert.match(deals, /QuietDeals/);
  assert.ok(!/Open deals with no contact/.test(page), "the section moved");
  assert.ok(!/communicationGaps|gaps\./.test(page));
});
