import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import { describeAlert, type AlertInput } from "../notifications/alert-text.ts";
import { composeEmail, type Item } from "../notifications/compose.ts";
import { resolveTarget } from "../notifications/crm-links.ts";
import { alertEmail, weeklyEmail } from "../analytics/weekly-email.ts";
import { digestEmail, type SaveAccount } from "../analytics/cash-intel.ts";
import { briefEmail, briefSlack, briefText, type Brief } from "../analytics/br-core.ts";
import { digestMail } from "../data-health/digest.ts";
import { proofEmail } from "../workflows/proof-email.ts";
import { monthlyMessage } from "../analytics/au-history.ts";
import { deepLinks } from "../links.ts";

const APP = "https://subsync.kdsquares.com";
const WL = "crm.myagency.com";
const A = (kind: string, detail: Record<string, unknown>, loc: string | null = "locAAA"): AlertInput => ({ id: "a1", kind, severity: "warning", title: "t", locationId: loc, detail });
const item = (a: AlertInput): Item => { const d = describeAlert(a, "Acme Dental"); return { title: d.title, body: d.body, details: d.details, severity: "warning", link: d.link, linkLabel: d.linkLabel }; };
const urls = (s: string) => [...s.matchAll(/https?:\/\/[^\s"<>]+/g)].map((m) => m[0].replace(/&amp;/g, "&"));
const NOT_SUBSYNC = /subsync\.kdsquares\.com|\/app#|app#/i;

// ---- notification emails (alerts), every kind ----
const CRM_KINDS: Array<[string, Record<string, unknown>, string]> = [
  ["sla", { unanswered: 21, slaHours: 4 }, "/conversations/conversations"],
  ["speed", { waiting: 10, targetMinutes: 15 }, "/conversations/conversations"],
  ["appointments", { unmarked: 9 }, "/calendars/view"],
  ["stale", { staleOpps: 4, openOpps: 9 }, "/opportunities/list"],
  ["dormant", { daysInactive: 20, threshold: 14 }, "/dashboard"],
  ["churn", { score: 22 }, "/dashboard"],
  ["leadflow", { dropPct: 60 }, "/dashboard"],
  ["quality", { completenessPct: 30 }, "/contacts/smart_list/All"],
  ["quality", { source: "Facebook", recent: 9, usual: 1 }, "/contacts/smart_list/All"],
];
const SUBSYNC_KINDS: Array<[string, Record<string, unknown>, string]> = [["email", { domain: "kdsquares.com", status: "warning" }, "SubSync > Clients > Email health"], ["sync", { error: "x" }, "SubSync > Settings > Sync status"]];

test("alert emails: every kind with a CRM page opens it on the alert's own account, never SubSync, text and html alike", () => {
  for (const [kind, detail, tail] of CRM_KINDS) {
    const m = composeEmail([item(A(kind, detail))], { company: "Co", appUrl: APP, stopUrl: null, crmDomain: WL });
    const want = `https://${WL}/v2/location/locAAA${tail}`;
    assert.ok(urls(m.text).includes(want), `${kind} text`);
    assert.ok(urls(m.html).includes(want), `${kind} html`);
    assert.match(m.text, / in your CRM: https:/, kind);
    assert.match(m.html, /in your CRM<\/a>/, kind);
    assert.doesNotMatch(m.text + m.html, NOT_SUBSYNC, kind);
    assert.doesNotMatch(m.subject + m.text + m.html, /gohighlevel|highlevel|\bghl\b/i, kind);
  }
});

test("alert emails: SubSync-only kinds open that account's CRM dashboard and say which menu to open", () => {
  for (const [kind, detail, menu] of SUBSYNC_KINDS) {
    const m = composeEmail([item(A(kind, detail))], { company: "Co", appUrl: APP, stopUrl: null, crmDomain: WL });
    assert.ok(urls(m.text).includes(`https://${WL}/v2/location/locAAA/dashboard`), kind);
    assert.ok(m.text.includes(`Open your CRM, then ${menu}: `), kind);
    assert.ok(m.html.includes(`Open your CRM, then ${menu.replace(/>/g, "&gt;")}</a>`), kind);
    assert.doesNotMatch(m.text + m.html, NOT_SUBSYNC, kind);
  }
});

test("alert emails: an alert about one lead opens that contact; the test email and an account-less alert open the CRM start page", () => {
  const one: Item = { title: "Ann is waiting", body: "", details: [], severity: "warning", link: { view: "speed", locationId: "locAAA", contactId: "c123" }, linkLabel: "Open the lead" };
  const m = composeEmail([one], { company: "Co", appUrl: APP, stopUrl: null, crmDomain: WL });
  assert.ok(urls(m.text).includes(`https://${WL}/v2/location/locAAA/contacts/detail/c123`));
  assert.match(m.text, /Open the lead in your CRM: /);
  const test = composeEmail([{ title: "Sample", body: "", details: [], severity: "info", link: { view: "alerts", locationId: null } }], { company: "Co", appUrl: APP, stopUrl: null, crmDomain: WL, test: true });
  assert.ok(urls(test.text).includes(`https://${WL}/`));
  assert.match(test.text, /Open your CRM, then SubSync > Today: /);
  assert.doesNotMatch(test.text + test.html, NOT_SUBSYNC);
  // a hostile id can never become part of a link
  const bad = composeEmail([{ ...one, link: { view: "speed", locationId: "x/../y", contactId: "c1" } }], { company: "Co", appUrl: APP, stopUrl: null, crmDomain: WL });
  assert.ok(!/x\/\.\.\/y/.test(bad.text));
});

test("alert emails: a digest of several accounts links each line to that line's own account", () => {
  const items = [item(A("sla", { unanswered: 5, slaHours: 4 }, "locAAA")), item(A("appointments", { unmarked: 9 }, "locBBB")), item(A("stale", { staleOpps: 4, openOpps: 9 }, "locCCC")), item(A("email", { domain: "x.com" }, "locDDD"))];
  const m = composeEmail(items, { company: "Co", appUrl: APP, stopUrl: null, crmDomain: WL });
  for (const want of [`/locAAA/conversations/conversations`, `/locBBB/calendars/view`, `/locCCC/opportunities/list`, `/locDDD/dashboard`]) {
    assert.ok(urls(m.text).some((u) => u.endsWith(want)), `text ${want}`);
    assert.ok(urls(m.html).some((u) => u.endsWith(want)), `html ${want}`);
  }
  assert.equal(urls(m.text).filter((u) => u.includes("locAAA")).length, 1, "an account's link appears only on its own line");
  assert.doesNotMatch(m.text + m.html, NOT_SUBSYNC);
  // more than ten alerts: the overflow line opens the CRM start page, not one account
  const many = Array.from({ length: 12 }, (_, i) => item(A("sla", { unanswered: 5, slaHours: 4 }, `loc${i}`)));
  const big = composeEmail(many, { company: "Co", appUrl: APP, stopUrl: null, crmDomain: WL });
  assert.match(big.text, /\.\.\.and 2 more\.\nOpen your CRM, then SubSync > Today: https:\/\/crm\.myagency\.com\//);
});

test("white label: the stored domain is used, the default host only when there is none, and two companies never share a domain", () => {
  const it = item(A("sla", { unanswered: 3, slaHours: 4 }));
  const a = composeEmail([it], { company: "A", appUrl: APP, stopUrl: null, crmDomain: "crm.agency-a.com" });
  const b = composeEmail([it], { company: "B", appUrl: APP, stopUrl: null, crmDomain: { appDomain: null, whitelabelDomain: "wl.agency-b.org" } });
  assert.ok(urls(a.text).every((u) => !u.includes("agency-b")) && urls(a.text).some((u) => u.startsWith("https://crm.agency-a.com/v2/")));
  assert.ok(urls(b.text).every((u) => !u.includes("agency-a")) && urls(b.text).some((u) => u.startsWith("https://wl.agency-b.org/v2/")));
  for (const none of [undefined, null, "", "not a host/../x"]) assert.match(composeEmail([it], { company: "C", appUrl: APP, stopUrl: null, crmDomain: none }).text, /https:\/\/app\.gohighlevel\.com\/v2\//);
  assert.equal(resolveTarget("crm.a.com", { view: "speed", locationId: "L1" }).url, deepLinks("crm.a.com").conversations("L1"));
});

// ---- the summaries ----
const save = (loc: string, name: string, list: SaveAccount["list"]): SaveAccount => ({ locationId: loc, name, points: 5, evidence: [{ key: "k", text: "9 people have waited", points: 5 }], dollars: 100, dollarText: "About $100 (estimate)", recoverCount: 1, dealCount: 1, list });

test("daily save digest: each account line opens its own account (conversations, deals or dashboard); the rest open the CRM start page", () => {
  const m = digestEmail({ scope: "s", accounts: [save("locAAA", "Alpha", "recover"), save("locBBB", "Beta", "deals"), save("locCCC", "Gamma", "clients"), save("locDDD", "Delta", "speed")], more: 3, crmDomain: WL, stopUrl: "https://x.test/stop", deals: { staleCount: 1, staleValue: null, soonCount: 0, lostNoReason: 0, lostCount: 0 }, monday: true });
  for (const want of ["/locAAA/conversations/conversations", "/locBBB/opportunities/list", "/locCCC/dashboard", "/locDDD/conversations/conversations"]) {
    assert.ok(urls(m.text).some((u) => u.startsWith(`https://${WL}/`) && u.endsWith(want)), `text ${want}`);
    assert.ok(urls(m.html).some((u) => u.startsWith(`https://${WL}/`) && u.endsWith(want)), `html ${want}`);
  }
  assert.match(m.text, /Open your CRM, then SubSync > Clients: https:\/\/crm\.myagency\.com\/v2\/location\/locCCC\/dashboard/);
  assert.match(m.text, /Open your CRM, then SubSync > Pipeline and deals: https:\/\/crm\.myagency\.com\/\n/);
  assert.match(m.text, /And 3 more\.\nOpen your CRM, then SubSync > Today: https:\/\/crm\.myagency\.com\//);
  assert.doesNotMatch(m.text + m.html, NOT_SUBSYNC);
  assert.doesNotMatch(m.subject + m.text + m.html, /gohighlevel|highlevel|\bghl\b/i);
});

const brief = { headline: "3 things need you.", more: 2, dollar: { text: "About $1,000 at stake (estimate)." }, bySection: {}, items: [
  { key: "save:locAAA", section: "save", title: "Save Alpha", why: "w", count: 1, dollars: null, tier: 2, hash: "#today?tab=recover&account=locAAA" },
  { key: "save:locBBB", section: "save", title: "Save Beta", why: "w", count: 1, dollars: null, tier: 2, hash: "#pipeline" },
  { key: "payments", section: "payments", title: "3 payments failed", why: "w", count: 3, dollars: null, tier: 2, hash: "#payments" },
] } as unknown as Brief;

test("morning brief (email, pasted text and Slack): account items open their own account; cross-account items name the menu on the CRM start page", () => {
  const mail = briefEmail(brief, { crmDomain: WL, stopUrl: "https://x.test/stop" });
  const text = briefText(brief, WL), slack = briefSlack(brief, WL);
  for (const s of [mail.text, mail.html, text, slack]) {
    assert.doesNotMatch(s, NOT_SUBSYNC);
    assert.ok(s.includes("locAAA/conversations/conversations") && s.includes("locBBB/opportunities/list"));
  }
  assert.match(mail.text, /Open your CRM, then SubSync > Money: https:\/\/crm\.myagency\.com\//);
  assert.match(mail.text, /Change the time or sections: Open your CRM, then SubSync > Today > Brief settings: https:\/\/crm\.myagency\.com\//);
  assert.ok(mail.html.includes("Open your CRM, then SubSync &gt; Today &gt; Brief settings</a>"));
  assert.equal(mail.text.includes("Open your CRM, then SubSync > Money"), mail.html.includes("Open your CRM, then SubSync &gt; Money"), "plain text matches html");
  assert.doesNotMatch(mail.text + mail.html, /gohighlevel|highlevel|\bghl\b/i);
});

test("old summary templates: weekly summary, alert email, monthly audit", () => {
  const w = weeklyEmail({ who: "Acme", crmDomain: WL, fine: 0, headlines: [], attention: [{ name: "Alpha", title: "t", locationId: "locAAA" }, { name: "Beta", title: "u", locationId: "locBBB" }] });
  assert.ok(w.text.includes("https://crm.myagency.com/v2/location/locAAA/dashboard") && w.text.includes("https://crm.myagency.com/v2/location/locBBB/dashboard"));
  assert.ok(w.html.includes("/locAAA/dashboard") && w.html.includes("/locBBB/dashboard"));
  const a = alertEmail("Acme", [{ severity: "warning", title: "x", locationId: "locAAA", view: "appointments" }], WL);
  assert.ok(a.text.includes("https://crm.myagency.com/v2/location/locAAA/calendars/view") && a.html.includes("/locAAA/calendars/view"));
  const mo = monthlyMessage({ who: "Acme", fromDay: "2026-10-10", toDay: "2026-11-09", link: "https://crm.myagency.com/", accounts: [{ name: "A", then: 5, now: 2, crmLink: deepLinks(WL).account("locAAA") }, { name: "B", then: 1, now: 4, crmLink: deepLinks(WL).account("locBBB") }] });
  assert.ok(mo && mo.text.includes("Open the account in your CRM: https://crm.myagency.com/v2/location/locAAA/dashboard") && mo.text.includes("/locBBB/dashboard"));
  assert.match(mo!.text, /open your CRM, then SubSync > Account audit\. https:\/\/crm\.myagency\.com\//);
  for (const s of [w.text, w.html, a.text, a.html, mo!.text]) assert.doesNotMatch(s, NOT_SUBSYNC);
});

test("data health digest and workflow proof: lines open their own account's contacts, the SubSync page is the CRM start page plus words", () => {
  const d = digestMail({ brand: "B", crmDomain: WL, stopUrl: "https://x.test/stop", accounts: [{ name: "Alpha", locationId: "locAAA", score: 60, weekAgo: 50, top: [{ label: "No phone", count: 9 }] }, { name: "Beta", locationId: "locBBB", score: 70, weekAgo: 70, top: [{ label: "No email", count: 4 }] }] });
  assert.ok(d.text.includes("https://crm.myagency.com/v2/location/locAAA/contacts/smart_list/All") && d.text.includes("https://crm.myagency.com/v2/location/locBBB/contacts/smart_list/All"));
  assert.match(d.text, /Open your CRM, then SubSync > Clean-up > Data health: https:\/\/crm\.myagency\.com\/\n/);
  assert.ok(d.html.includes("/locAAA/contacts/smart_list/All") && d.html.includes("Open your CRM, then SubSync &gt; Clean-up &gt; Data health</a>"));
  const p = proofEmail({ brand: "B", caught: 3, cleared: 1, open: 2, openTitles: ["x"], crmDomain: WL, stopUrl: "https://x.test/stop" });
  assert.match(p.text, /Open your CRM, then SubSync > Workflows: https:\/\/crm\.myagency\.com\/\n/);
  assert.ok(p.html.includes("Open your CRM, then SubSync &gt; Workflows</a>"));
  for (const s of [d.text, d.html, p.text, p.html]) assert.doesNotMatch(s, NOT_SUBSYNC);
});

test("the daily Today email (not importable in the plain runner) takes its link line from the CRM start page plus words", () => {
  const send = fs.readFileSync(new URL("../analytics/today3-email.ts", import.meta.url), "utf8");
  const intel = fs.readFileSync(new URL("../analytics/today3-intel.ts", import.meta.url), "utf8");
  assert.match(send, /emailText\(board, linkText\(wordsLink\(crmDomain, "SubSync > Today"\)\), stop\)/);
  assert.match(intel, /\$\{openLine\}/);
  assert.doesNotMatch(intel, /Open your list: \$\{appUrl\}/);
});

// ---- the code itself: no email builder may put a SubSync address in a link again ----
test("no email template builds a link to the SubSync app address", () => {
  const files = [
    "analytics/weekly-email.ts", "analytics/cash-intel.ts", "analytics/br-core.ts", "analytics/today3-email.ts", "analytics/today3-intel.ts",
    "analytics/au-sweep.ts", "analytics/au-history.ts", "data-health/digest.ts", "data-health/cron.ts", "workflows/proof-email.ts", "workflows/cron.ts", "analytics/cash-email.ts", "analytics/br-queries.ts",
  ];
  for (const f of files) {
    const src = fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    assert.doesNotMatch(src, /\/app#\$\{|\}\/app#|\/app#[a-z]/, `${f} still builds a SubSync link`);
  }
});
