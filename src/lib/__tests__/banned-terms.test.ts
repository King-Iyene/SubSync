import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import ts from "typescript";

// Nothing a person can read may name the platform or use our internal words (brief 13A, runbook S0.3).
// The scanner reads the code's syntax tree, so only text a person can see is checked: string literals, template text,
// and text inside page markup. Identifiers, imports, comments and database queries are not text.
//   Everywhere:       the platform's name and its host names.
//   All screens, emails, messages and errors: "agency", "sub-account" and "location" (say "client account" or "your team").
//   Exception:        the public pages that speak to agencies as their audience (home, privacy, terms, support)
//                     may say "agency". They may not name the platform or say "sub-account" or "location".
const ROOT = join(process.cwd(), "src");
const PLATFORM = /gohighlevel|highlevel|leadconnector|\bghl\b/i;
const INTERNAL = /\b(agenc(y|ies)|sub-?accounts?|locations?)\b/i;
const AUDIENCE_PAGES = /\/src\/app\/(page|privacy\/page|terms\/page|support\/page)\.tsx$/;

// Code that talks to the platform may name it. These files and folders never reach a screen as text.
const NOT_SCANNED = [/\/src\/lib\/ghl\//, /\/src\/lib\/sync\//, /\/src\/lib\/crypto\.ts$/, /\/src\/lib\/links\.ts$/, /\/src\/lib\/db\.ts$/, /\/src\/lib\/tenant-tables\.ts$/, /\/src\/lib\/route-guards\.ts$/, /\/src\/lib\/safe-log\.ts$/, /\/src\/lib\/analytics\/cleanup-platform\.ts$/];

// Text a machine reads and a person never sees: the webhook's signature header name, and the browser's own `location` object
// in the one-line script that closes the connect popup.
const MACHINE_TEXT = [/^x-ghl-signature$/i, /location[.]origin/];

type Found = { text: string; line: number };
const SQL_TAG = /^(sql(\(\))?|db|tx|[a-z]+\.sql)$/;
const IGNORED_ATTRS = new Set(["className", "key", "htmlFor", "id", "type", "role", "name", "d", "viewBox", "fill", "stroke", "width", "height", "style"]);
// A lowercase word or key such as "agency", "client_view" or "a:b" is an internal code, not a sentence.
const CODE_LIKE = /^[a-z0-9_.:\-/]+$/;

export function visibleText(source: string, fileName = "x.tsx"): Found[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: Found[] = [];
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const add = (text: string, node: ts.Node) => { if (text.trim()) out.push({ text, line: lineOf(node) }); };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isImportTypeNode(node)) return;
    if (ts.isTypeNode(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) return;
    if (ts.isTaggedTemplateExpression(node) && SQL_TAG.test(node.tag.getText(sf))) { node.template.forEachChild(visitInsideSql); return; }
    if (ts.isCallExpression(node) && /\.unsafe$/.test(node.expression.getText(sf))) return;
    if (ts.isJsxAttribute(node) && IGNORED_ATTRS.has(node.name.getText(sf))) return;
    if (ts.isJsxText(node)) add(node.getText(sf), node);
    else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const p = node.parent;
      const comparing = (ts.isBinaryExpression(p) && /^[!=]==?$/.test(p.operatorToken.getText(sf))) || ts.isCaseClause(p) || ts.isElementAccessExpression(p);
      if (!comparing) add(node.text, node);
    } else if (ts.isTemplateExpression(node)) {
      add(node.head.text, node.head);
      node.templateSpans.forEach((s) => add(s.literal.text, s.literal));
    }
    ts.forEachChild(node, visit);
  };
  // Expressions inside a query (${...}) can still hold text, but the query words themselves are not text.
  const visitInsideSql = (node: ts.Node) => { if (ts.isTemplateSpan(node)) visit(node.expression); else ts.forEachChild(node, visitInsideSql); };
  visit(sf);
  return out;
}

export function violations(source: string, fileName: string): string[] {
  const n = "/" + fileName.replace(/\\/g, "/").replace(/^\/+/, "");
  const audience = AUDIENCE_PAGES.test(n);
  const hits: string[] = [];
  for (const f of visibleText(source, fileName)) {
    const t = f.text.trim();
    if (MACHINE_TEXT.some((re) => re.test(t))) continue;
    if (PLATFORM.test(t)) { hits.push(`${f.line}: names the platform: ${t.slice(0, 90)}`); continue; }
    if (CODE_LIKE.test(t)) continue;
    const m = INTERNAL.exec(t);
    if (m && !(audience && /^agenc/i.test(m[0]))) hits.push(`${f.line}: says "${m[0]}": ${t.slice(0, 90)}`);
  }
  return hits;
}

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "__tests__") files(p, out); } else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}

test("the scanner catches the platform's name and our internal words in text, and ignores code, queries and comments", () => {
  assert.equal(violations('const m = "Open it in GoHighLevel";', "a.ts").length, 1);
  assert.equal(violations("const m = `Sign in to HighLevel first`;", "a.ts").length, 1);
  assert.equal(violations("export const A = () => <p>Open the contact in GHL</p>;", "a.tsx").length, 1);
  assert.equal(violations('throw new Error("leadconnectorhq failed");', "a.ts").length, 1);
  assert.equal(violations('const m = "Connected to your agency.";', "a.ts").length, 1);
  assert.equal(violations('const m = "Bad location";', "a.ts").length, 1);
  assert.equal(violations("export const A = () => <b>Sub-accounts</b>;", "a.tsx").length, 1);
  assert.equal(violations("export const A = () => <p>\n  Your agency\n  is connected\n</p>;", "a.tsx").length, 1, "text on several lines is still found");
  assert.equal(violations("const m = `Hi ${name}, your agency is ready`;", "a.ts").length, 1);
  assert.equal(violations('import { ghlFetch } from "../ghl/http.ts";\nconst x = ghlFetch(1); // talks to GoHighLevel\n/* GHL notes */', "a.ts").length, 0, "imports, identifiers and comments are fine");
  assert.equal(violations('const r = await sql()`select location_id from locations where installation_id = ${id}`;', "a.ts").length, 0, "database queries are not text");
  assert.equal(violations('if (ctx.kind === "agency") go("agency");', "a.ts").length, 0, "internal codes are not text");
  assert.equal(violations('const [a] = await sql()`select 1 where x = ${"Your agency"}`;', "a.ts").length, 1, "text inside a query expression still counts");
  assert.equal(violations('const m = "Open it in your CRM";', "a.ts").length, 0);
});

test("public pages that speak to agencies may say agency, but never name the platform or say sub-account or location", () => {
  assert.equal(violations("export default () => <p>For agencies that book appointments</p>;", "src/app/page.tsx").length, 0);
  assert.equal(violations("export default () => <p>For agencies that book appointments</p>;", "src/app/installed/page.tsx").length, 1);
  assert.equal(violations("export default () => <p>Works in every sub-account</p>;", "src/app/page.tsx").length, 1);
  assert.equal(violations("export default () => <p>Built on GoHighLevel</p>;", "src/app/privacy/page.tsx").length, 1);
});

test("no screen, email, message, error or help text names the platform or uses our internal words", () => {
  const found: string[] = [];
  let scanned = 0;
  for (const file of files(ROOT)) {
    const n = file.replace(/\\/g, "/");
    if (NOT_SCANNED.some((re) => re.test(n))) continue;
    scanned += 1;
    for (const h of violations(readFileSync(file, "utf8"), n)) found.push(`${n.slice(n.indexOf("/src/") + 1)}:${h}`);
  }
  assert.ok(scanned > 80, `the scan covers pages, views, messages and templates (${scanned} files)`);
  assert.deepEqual(found, [], 'Say "your CRM", "client account" or "your team" instead.');
});
