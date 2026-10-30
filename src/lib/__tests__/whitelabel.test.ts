import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { parseSsoUser } from "../ghl/sso.ts";
import { deepLinks, DEFAULT_APP_DOMAIN, validDomain } from "../links.ts";

test("links use the agency's own domain and fall back to the default only when none is known", () => {
  assert.equal(deepLinks("crm.brandedagency.com").contact("LOC1", "C1"), "https://crm.brandedagency.com/v2/location/LOC1/contacts/detail/C1");
  assert.equal(deepLinks("crm.brandedagency.com").conversation("LOC1", "X"), "https://crm.brandedagency.com/v2/location/LOC1/conversations/conversations/X");
  assert.ok(deepLinks(null).account("LOC1").startsWith(`https://${DEFAULT_APP_DOMAIN}/`));
  assert.ok(deepLinks("not a domain").account("LOC1").startsWith(`https://${DEFAULT_APP_DOMAIN}/`), "a bad domain never reaches a link");
  assert.ok(deepLinks("evil.com/x?").account("LOC1").startsWith(`https://${DEFAULT_APP_DOMAIN}/`), "paths and queries are refused");
});

test("only a plain host name is accepted as a domain", () => {
  assert.equal(validDomain(" CRM.Agency.com "), "crm.agency.com");
  for (const bad of ["https://crm.agency.com", "crm.agency.com/path", "crm agency.com", "localhost", "crm.agency.com:8080", "", null, 42, "-bad.com", "a".repeat(260) + ".com"]) assert.equal(validDomain(bad), null, String(bad));
});

test("the white-label domain is read from the sign-in details", () => {
  assert.equal(parseSsoUser({ userId: "u", whitelabelDetails: { domain: "app.brand.io", logoUrl: "https://x/y.png" } }).whitelabelDomain, "app.brand.io");
  assert.equal(parseSsoUser({ userId: "u", whitelabelDetails: { domain: "https://app.brand.io/login" } }).whitelabelDomain, null, "a URL is not a domain");
  assert.equal(parseSsoUser({ userId: "u" }).whitelabelDomain, null);
  assert.equal(parseSsoUser(null).whitelabelDomain, null);
});

// ---- nothing a person can read may name the platform (brief 13A)
const ROOT = join(process.cwd(), "src");
const BANNED = /gohighlevel|highlevel|leadconnector|\bghl\b/i;

function files(dir: string, keep: (p: string) => boolean, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "__tests__") files(p, keep, out); } else if (keep(p)) out.push(p);
  }
  return out;
}

// Code that talks to the platform is allowed to name it (addresses, header names, import paths). What is
// scanned is everything that can reach a screen, an email or an assistant: pages, views, messages,
// digests, templates and tool descriptions.
const SCANNED = (p: string) => {
  const n = p.replace(/\\/g, "/");
  if (!/\.(ts|tsx)$/.test(n)) return false;
  if (/\/src\/lib\/(ghl|sync|crypto)/.test(n) || /\/src\/lib\/links\.ts$/.test(n)) return false;
  if (/\/src\/app\/api\/(oauth|webhooks)\//.test(n) || /\/src\/lib\/analytics\/cleanup-platform\.ts$/.test(n)) return false;
  return /\/src\/app\//.test(n) || /\/src\/lib\/(analytics|api|mcp|demo|connections|notify|dns|access|entitlements|flags)/.test(n);
};

function visibleText(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(import|export)\b.*\bfrom\b/.test(line) && !/^\s*\/\//.test(line))
    .map((line) => line.replace(/(^|\s)\/\/.*$/, ""))
    .join("\n");
}

// Quoted text and screen text can be read; identifiers and import paths cannot.
const QUOTED = /(["'`])(?:\\.|(?!\1).)*\1/g;

function findHits(source: string): string[] {
  const hits: string[] = [];
  visibleText(source).split("\n").forEach((line, i) => {
    const quoted = line.match(QUOTED) ?? [];
    const jsx = /<[A-Za-z]/.test(line) || />[^<>]*[A-Za-z][^<>]*</.test(line) ? [line] : [];
    for (const s of [...quoted, ...jsx]) {
      if (BANNED.test(s) && !/^["'`](@\/|\.{1,2}\/)/.test(s)) hits.push(`${i + 1}: ${line.trim().slice(0, 120)}`);
    }
  });
  return hits;
}

test("the scanner really catches the platform's name in strings and screen text, and ignores code that must name it", () => {
  assert.equal(findHits('const m = "Open it in GoHighLevel";').length, 1);
  assert.equal(findHits("const m = `Sign in to HighLevel first`;").length, 1);
  assert.equal(findHits("return <p>Open the contact in GHL</p>;").length, 1);
  assert.equal(findHits('throw new Error("leadconnectorhq failed");').length, 1);
  assert.equal(findHits('import { ghlFetch } from "../ghl/http.ts";\nconst x = ghlFetch(1); // talks to GoHighLevel\n/* GHL notes */').length, 0, "imports, identifiers and comments are fine");
  assert.equal(findHits('const m = "Open it in your CRM";').length, 0);
});

test("no screen, email, message or help text names the platform", () => {
  const hits: string[] = [];
  let scanned = 0;
  for (const file of files(ROOT, SCANNED)) {
    scanned += 1;
    for (const h of findHits(readFileSync(file, "utf8"))) hits.push(`${file.slice(ROOT.length + 1)}:${h}`);
  }
  assert.ok(scanned > 60, `the scan covers the pages, views, messages and templates (${scanned} files)`);
  assert.deepEqual([...new Set(hits)], [], 'These lines name the platform. Say "your CRM" or "your platform" instead.');
});
