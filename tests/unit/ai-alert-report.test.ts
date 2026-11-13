import { describe, expect, it } from "vitest";
import type { AiStore, Conn, Deps, RunRow } from "@/lib/ai/gateway";
import type { Fetch } from "@/lib/ai/providers";
import { JOBS } from "@/lib/ai/jobs";
import { aiAlertBody } from "@/lib/ai/team/alert-report";
import { TEAM_JOB_IDS } from "@/lib/ai/team/jobs";
import { factsFor, factsText, renderFacts } from "@/lib/notifications/alert-text";
import { DEFAULT_OFF } from "@/lib/flags-core";

// The AI writes the sentence under an alert from its facts only. A mock provider stands in for the real one: nothing real is called.

const ALL_ON = { jobs: Object.fromEntries(TEAM_JOB_IDS.map((j) => [j, true])) as Record<(typeof TEAM_JOB_IDS)[number], boolean>, leadNames: false, tone: "plain" as const };
const connJobs = Object.fromEntries(TEAM_JOB_IDS.map((j) => [j, true]));

function memStore(conn: Partial<Conn> | null) {
  const runs: RunRow[] = [];
  const store: AiStore = {
    connection: async (_i, scope) => (conn && (conn.scope ?? "") === scope ? ({ scope, method: "key", provider: "openai", baseUrl: null, apiKey: "sk-test-1234567890", model: "gpt-x", status: "connected", monthlyCapUsd: 5, paused: false, shareNames: false, jobs: connJobs, ...conn } as Conn) : null),
    cachedRun: async (_i, _s, key) => { const r = runs.find((x) => x.idempotencyKey === key && x.status === "ok"); return r ? { id: "run-1", output: r.output ?? "" } : null; },
    monthSpendUsd: async () => runs.reduce((a, r) => a + r.costUsd, 0),
    runsSince: async () => runs.length,
    insertRun: async (r) => { runs.push(r); return `run-${runs.length}`; },
    markNeedsAttention: async () => undefined,
  };
  return { store, runs };
}
const reply = (text: string) => ({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 100, completion_tokens: 50 } });
const fetchWith = (text: string, calls: string[] = []): Fetch => async (_u, init) => { calls.push(String(init?.body ?? "")); return { status: 200, text: async () => JSON.stringify(reply(text)) }; };
const never: Fetch = async () => { throw new Error("must not be called"); };
const deps = (store: AiStore, fetch: Fetch): Deps => ({ store, fetch, sleep: async () => undefined, killAll: () => false, now: () => Date.UTC(2026, 10, 13, 8) });

const alert = { id: "a1", kind: "quality", severity: "warning" as const, title: "t", locationId: "loc-1", detail: { source: "Unknown source", recent: 19, usual: 0, created: 24, newestMinutes: 12, kinds: { bad_phone: 11, duplicate: 5, bad_email: 3 } } };
const facts = factsFor(alert, "KD Squares Test");
const w = (d: Deps, more: Record<string, unknown> = {}) => ({ inst: "inst-1", locationId: "loc-1", featureOn: true, eff: ALL_ON, deps: d, ...more });

describe("alert facts and template", () => {
  it("the facts carry every figure the message and the AI may use, and nothing else", () => {
    const t = factsText(facts);
    for (const n of ["19", "24", "12", "11", "5", "3"]) expect(t).toContain(n);
    expect(t).toContain("Window: the last 24 hours");
    expect(t).not.toMatch(/gohighlevel|highlevel|ghl/i);
  });
  it("a new kind of alert needs only its facts: the unknown kind still gets a specific, non-generic title", () => {
    const r = renderFacts(factsFor({ id: "z", kind: "mystery", severity: "warning", title: "Acme: something odd happened", locationId: "l", detail: {} }, "Acme"));
    expect(r.title).toBe("Acme: something odd happened");
  });
  it("the job is registered live, suggest-only, aggregate, with its own default-off flag", () => {
    expect(JOBS.alert_report.status).toBe("live"); expect(JOBS.alert_report.approval).toBe("suggest"); expect(JOBS.alert_report.privacy).toBe("aggregate");
    expect(DEFAULT_OFF.has("ai_slack_reports" as never)).toBe(true);
  });
});

describe("AI alert report", () => {
  it("returns the AI sentence when every figure is in the facts, and sends only the facts (no names)", async () => {
    const m = memStore({ scope: "" });
    const calls: string[] = [];
    const out = await aiAlertBody(w(deps(m.store, fetchWith("19 bad records came in from records with no source, mostly 11 invalid phone numbers. Open the list and fix them first.", calls))), facts);
    expect(out).toContain("11 invalid phone numbers");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("Figure: 19");
    expect(calls[0]).not.toContain("KD Squares Test".toLowerCase());
  });
  it("a forged number is rejected and the caller keeps the template", async () => {
    const m = memStore({ scope: "" });
    expect(await aiAlertBody(w(deps(m.store, fetchWith("A huge 400 bad records came in. Fix them now."))), facts)).toBeNull();
  });
  it("off: the flag, the account switch, no connection or a failing provider all give null, and the provider is not called when off", async () => {
    const m = memStore({ scope: "" });
    expect(await aiAlertBody(w(deps(m.store, never), { featureOn: false }), facts)).toBeNull();
    expect(await aiAlertBody(w(deps(m.store, never), { eff: { ...ALL_ON, jobs: { ...ALL_ON.jobs, alert_report: false } } }), facts)).toBeNull();
    expect(await aiAlertBody(w(deps(memStore(null).store, never)), facts)).toBeNull();
    expect(await aiAlertBody(w(deps(m.store, async () => { throw new Error("boom"); })), facts)).toBeNull();
  });
  it("the kill switch stops it", async () => {
    const m = memStore({ scope: "" });
    expect(await aiAlertBody(w({ ...deps(m.store, never), killAll: () => true }), facts)).toBeNull();
  });
  it("the template used as the fallback is data-specific, never the generic text", () => {
    const r = renderFacts(facts);
    expect(r.title).toBe("KD Squares Test: 19 bad records came in with no source recorded in the last 24 hours (usually 0 a day)");
    expect(r.body).not.toContain("Open the linked page");
  });
});
