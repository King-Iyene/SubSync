import assert from "node:assert/strict";
import { test } from "node:test";
import { describeAlert, type AlertInput } from "../notifications/alert-text.ts";
import { composeSlack, crmLinkFor, type Item } from "../notifications/compose.ts";

const APP = "https://subsync.kdsquares.com";
const A = (kind: string, detail: Record<string, unknown>, loc = "locAAA"): AlertInput => ({ id: "a1", kind, severity: "warning", title: "t", locationId: loc, detail });
const item = (a: AlertInput): Item => { const d = describeAlert(a, "Acme Dental"); return { title: d.title, body: d.body, details: d.details, severity: "warning", link: d.link, linkLabel: d.linkLabel }; };
const links = (text: string) => [...text.matchAll(/<([^|>]+)\|([^>]+)>/g)].map((m) => ({ url: m[1], label: m[2] }));

// Kinds that have a CRM page, and the CRM page each one opens.
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
// Kinds with no CRM equivalent: the link stays in SubSync and the text says so.
const SUBSYNC_KINDS: Array<[string, Record<string, unknown>]> = [["email", { domain: "kdsquares.com", status: "warning" }], ["sync", { error: "x" }]];

test("every alert kind with a CRM equivalent links to the CRM on the alert's own account, not SubSync", () => {
  for (const [kind, detail, tail] of CRM_KINDS) {
    const text = composeSlack([item(A(kind, detail))], { company: "Co", appUrl: APP });
    const [l] = links(text);
    assert.equal(l.url, `https://app.gohighlevel.com/v2/location/locAAA${tail}`, kind);
    assert.match(l.label, / in your CRM$/, kind);
    assert.doesNotMatch(text, /kdsquares\.com\/app/, kind);
  }
});

test("the stored white-label domain is used, and the default host only when there is none", () => {
  const it = item(A("sla", { unanswered: 3, slaHours: 4 }));
  assert.match(composeSlack([it], { company: "Co", appUrl: APP, crmDomain: "crm.myagency.com" }), /<https:\/\/crm\.myagency\.com\/v2\/location\/locAAA\/conversations\/conversations\|/);
  assert.match(composeSlack([it], { company: "Co", appUrl: APP, crmDomain: { appDomain: null, whitelabelDomain: "wl.example.org" } }), /<https:\/\/wl\.example\.org\/v2\//);
  for (const none of [undefined, null, "", "not a host/../x"]) assert.match(composeSlack([it], { company: "Co", appUrl: APP, crmDomain: none }), /<https:\/\/app\.gohighlevel\.com\/v2\//);
});

test("alerts with no CRM page keep the SubSync link and say it opens SubSync", () => {
  for (const [kind, detail] of SUBSYNC_KINDS) {
    const [l] = links(composeSlack([item(A(kind, detail))], { company: "Co", appUrl: APP }));
    assert.match(l.url, /^https:\/\/subsync\.kdsquares\.com\/app#/, kind);
    assert.match(l.label, / in SubSync$/, kind);
  }
});

test("a digest takes each alert's location from that alert, so one account never gets another's link", () => {
  const text = composeSlack([item(A("sla", { unanswered: 5, slaHours: 4 }, "locONE")), item(A("appointments", { unmarked: 7 }, "locTWO")), item(A("email", { domain: "x.com" }, "locTWO"))], { company: "Co", appUrl: APP, crmDomain: "crm.a.com" });
  const ls = links(text);
  assert.equal(ls.length, 3);
  assert.ok(ls.some((l) => l.url === "https://crm.a.com/v2/location/locONE/conversations/conversations"));
  assert.ok(ls.some((l) => l.url === "https://crm.a.com/v2/location/locTWO/calendars/view"));
  assert.equal(ls.filter((l) => l.url.includes("locONE")).length, 1);
  assert.match(text, /Open the unanswered messages in your CRM/);
});

test("no account on the alert means no CRM link (nothing is guessed); labels never name the platform vendor", () => {
  assert.equal(crmLinkFor(null, { view: "speed", locationId: null }), null);
  assert.equal(crmLinkFor(null, { view: "email", locationId: "L1" }), null);
  const text = composeSlack([item(A("sla", { unanswered: 5, slaHours: 4 })), item(A("email", { domain: "x.com" }))], { company: "Co", appUrl: APP });
  for (const l of links(text)) assert.doesNotMatch(l.label, /gohighlevel|highlevel|ghl/i);
});
