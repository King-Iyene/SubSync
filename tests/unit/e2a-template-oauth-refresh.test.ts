import { describe, expect, it } from "vitest";
import { ASSUMED_LIMITS } from "@/lib/ghl/crm-writes";
import { createFathomWebhook, exchangeCode, refreshTokens } from "@/lib/connections/oauth";
import { refreshLocked, type LockedRow, type RefreshStore, type Stored } from "@/lib/connections/refresh";
import { ALL_PARTS, DEFAULT_TEMPLATE, fillTemplate, plain, renderNote, SAMPLE_NOTE_INPUT, SHORTENED, TEMPLATE_VARIABLES, unknownVariables, type NoteInput } from "@/lib/connections/note-template";
import { TRIGGERS_FIRST, TRIGGERS_SOLO } from "@/lib/connections/fathom";

// Stage E2a items 2 and 4 without a database or a network: the Fathom token and webhook calls against a fake provider that behaves like Fathom
// (single-use rotating refresh tokens, a Team-plan-only recording type), and the default note template (INTEGRATIONS_SPEC section 8).

const KEYS = { clientId: "client-id-test", clientSecret: "client-secret-test" };
const T0 = Date.parse("2026-11-02T10:00:00Z");

// ---------------- a fake Fathom ----------------

function fakeFathom(initialRefresh: string) {
  let validRefresh = initialRefresh;
  let n = 0;
  const calls: Array<{ url: string; params: URLSearchParams }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const params = new URLSearchParams(String(init.body));
    calls.push({ url, params });
    await new Promise((r) => setTimeout(r, 5)); // a real network takes time: this is what lets two callers overlap
    if (params.get("grant_type") === "refresh_token" && params.get("refresh_token") === validRefresh) {
      n++;
      validRefresh = `R${n + 1}`;
      return new Response(JSON.stringify({ access_token: `A${n + 1}`, refresh_token: validRefresh, expires_in: 3600 }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls, valid: () => validRefresh };
}

/** A connection row whose lock is a real mutex (as `select ... for update` is). `locked: false` removes the mutex, to show what the lock prevents. */
function rowStore(initial: Stored, locked = true) {
  const state = { ...initial };
  const events: string[] = [];
  let chain: Promise<unknown> = Promise.resolve();
  const row: LockedRow = {
    read: async () => ({ ...state }),
    save: async (next) => { Object.assign(state, next); events.push("saved"); },
    markNeedsReconnect: async (code) => { events.push(`needs_reconnect:${code}`); },
  };
  const store: RefreshStore = {
    withLock: (_id, fn) => {
      if (!locked) return fn(row);
      const run = chain.then(() => fn(row));
      chain = run.then(() => undefined, () => undefined);
      return run;
    },
  };
  return { store, state, events };
}

const refreshWith = (f: ReturnType<typeof fakeFathom>) => async (refreshToken: string) => {
  const r = await refreshTokens("fathom", refreshToken, KEYS, f.fetchImpl, T0);
  return r.ok ? { ok: true as const, tokens: r.tokens } : { ok: false as const };
};

describe("the Fathom token calls", () => {
  it("go to the token address Fathom's developer docs give (api.fathom.ai), with the grant type and the app's own keys", async () => {
    const f = fakeFathom("R1");
    await refreshTokens("fathom", "R1", KEYS, f.fetchImpl, T0);
    await exchangeCode("fathom", "the-code", KEYS, "https://subsync.test/api/integrations/fathom/callback", f.fetchImpl, T0);
    expect(f.calls.map((c) => c.url)).toEqual(["https://api.fathom.ai/external/v1/oauth2/token", "https://api.fathom.ai/external/v1/oauth2/token"]);
    expect(f.calls[0].params.get("grant_type")).toBe("refresh_token");
    expect(f.calls[0].params.get("client_id")).toBe("client-id-test");
    expect(f.calls[1].params.get("grant_type")).toBe("authorization_code");
    expect(f.calls[1].params.get("redirect_uri")).toBe("https://subsync.test/api/integrations/fathom/callback");
  });
});

describe("rotating single-use refresh tokens, one refresh at a time (spec 11.1 item 6)", () => {
  it("ACCEPTANCE: five callers who all find an expired token at the same moment cause ONE refresh, all get the new token, and the new refresh token is saved", async () => {
    const f = fakeFathom("R1");
    const r = rowStore({ accessToken: "A1", refreshToken: "R1", expiresAt: T0 - 1000 });
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => refreshLocked(r.store, "c1", refreshWith(f), () => T0)));
    expect(results.every((x) => x.ok && x.accessToken === "A2")).toBe(true);
    expect(results.filter((x) => x.ok && x.refreshed)).toHaveLength(1);
    expect(f.calls).toHaveLength(1);
    expect(r.state).toMatchObject({ accessToken: "A2", refreshToken: "R2" });
    expect(f.valid()).toBe("R2");
  });

  it("WITHOUT the lock the second caller spends an already-spent refresh token and the connection breaks: this is what the lock is for", async () => {
    const f = fakeFathom("R1");
    const r = rowStore({ accessToken: "A1", refreshToken: "R1", expiresAt: T0 - 1000 }, false);
    const results = await Promise.all([refreshLocked(r.store, "c1", refreshWith(f), () => T0), refreshLocked(r.store, "c1", refreshWith(f), () => T0)]);
    expect(results.some((x) => !x.ok)).toBe(true);
  });

  it("ACCEPTANCE (forced): a token that looks fresh but was refused is refreshed on purpose, once", async () => {
    const f = fakeFathom("R1");
    const r = rowStore({ accessToken: "A1", refreshToken: "R1", expiresAt: T0 + 3_600_000 });
    expect(await refreshLocked(r.store, "c1", refreshWith(f), () => T0)).toMatchObject({ ok: true, accessToken: "A1", refreshed: false });
    expect(f.calls).toHaveLength(0);
    const forced = await refreshLocked(r.store, "c1", refreshWith(f), () => T0, "A1");
    expect(forced).toMatchObject({ ok: true, accessToken: "A2", refreshed: true });
    expect(f.calls).toHaveLength(1);
    expect(r.state).toMatchObject({ accessToken: "A2", refreshToken: "R2" });
  });

  it("ACCEPTANCE (forced and concurrent): two callers both refused on the SAME token refresh once between them; the second uses the first one's new token", async () => {
    const f = fakeFathom("R1");
    const r = rowStore({ accessToken: "A1", refreshToken: "R1", expiresAt: T0 + 3_600_000 });
    const both = await Promise.all([refreshLocked(r.store, "c1", refreshWith(f), () => T0, "A1"), refreshLocked(r.store, "c1", refreshWith(f), () => T0, "A1")]);
    expect(both.every((x) => x.ok && x.accessToken === "A2")).toBe(true);
    expect(f.calls).toHaveLength(1);
    expect(f.valid()).toBe("R2");
  });

  it("a caller refused on a token that is no longer the stored one does not refresh at all", async () => {
    const f = fakeFathom("R2");
    const r = rowStore({ accessToken: "A2", refreshToken: "R2", expiresAt: T0 + 3_600_000 });
    expect(await refreshLocked(r.store, "c1", refreshWith(f), () => T0, "A1")).toMatchObject({ ok: true, accessToken: "A2", refreshed: false });
    expect(f.calls).toHaveLength(0);
  });

  it("a refusal from Fathom marks the connection 'needs reconnect' once and stops, instead of retrying a spent token", async () => {
    const f = fakeFathom("SOMETHING-ELSE");
    const r = rowStore({ accessToken: "A1", refreshToken: "R1", expiresAt: T0 - 1000 });
    expect(await refreshLocked(r.store, "c1", refreshWith(f), () => T0)).toEqual({ ok: false, reason: "refused" });
    expect(r.events).toEqual(["needs_reconnect:P-AUTH"]);
    expect(f.calls).toHaveLength(1);
  });

  it("a connection with nothing stored (revoked, disconnected) refreshes nothing", async () => {
    const f = fakeFathom("R1");
    const none: RefreshStore = { withLock: async (_id, fn) => fn({ read: async () => null, save: async () => undefined, markNeedsReconnect: async () => undefined }) };
    expect(await refreshLocked(none, "c1", refreshWith(f), () => T0)).toEqual({ ok: false, reason: "no_tokens" });
    expect(f.calls).toHaveLength(0);
  });
});

describe("the delivery address Fathom is asked to create (one per person, secret returned once)", () => {
  type Call = { triggers: string[]; body: Record<string, unknown>; auth: string | null };
  const fakeHooks = (answers: Array<{ status: number; json: unknown }>) => {
    const calls: Call[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      calls.push({ triggers: body.triggered_for as string[], body, auth: new Headers(init.headers).get("authorization") });
      expect(url).toBe("https://api.fathom.ai/external/v1/webhooks");
      const a = answers[Math.min(calls.length - 1, answers.length - 1)];
      return new Response(JSON.stringify(a.json), { status: a.status });
    }) as unknown as typeof fetch;
    return { fetchImpl, calls };
  };

  it("asks for the person's own recordings and the ones they share with a team, and requests only the summary and the action items", async () => {
    const f = fakeHooks([{ status: 201, json: { id: "wh_1", secret: "whsec_abc", url: "https://x" } }]);
    const r = await createFathomWebhook("ACCESS", "https://subsync.test/api/hooks/fathom/KEY", f.fetchImpl);
    expect(r).toEqual({ ok: true, id: "wh_1", secret: "whsec_abc", triggers: TRIGGERS_FIRST.join(",") });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].auth).toBe("Bearer ACCESS");
    expect(f.calls[0].body).toEqual({
      destination_url: "https://subsync.test/api/hooks/fathom/KEY", triggered_for: ["my_recordings", "my_shared_with_team_recordings"],
      include_summary: true, include_action_items: true, include_transcript: false, include_crm_matches: false,
    });
  });

  it("on a solo plan (Fathom refuses the Team-plan-only type with a 400) it asks again for the person's own recordings alone", async () => {
    const f = fakeHooks([{ status: 400, json: { error: "team plan only" } }, { status: 201, json: { id: "wh_2", secret: "whsec_def" } }]);
    const r = await createFathomWebhook("ACCESS", "https://subsync.test/api/hooks/fathom/KEY", f.fetchImpl);
    expect(r).toMatchObject({ ok: true, id: "wh_2", secret: "whsec_def", triggers: TRIGGERS_SOLO.join(",") });
    expect(f.calls.map((c) => c.triggers)).toEqual([["my_recordings", "my_shared_with_team_recordings"], ["my_recordings"]]);
    expect(f.calls[1].body.include_transcript).toBe(false);
  });

  it("an answer without the secret is a failure (without it deliveries could never be checked), and the person sees F-HOOK, never a token", async () => {
    const f = fakeHooks([{ status: 201, json: { id: "wh_3" } }]);
    const r = await createFathomWebhook("ACCESS", "https://subsync.test/api/hooks/fathom/KEY", f.fetchImpl);
    expect(r).toMatchObject({ ok: false, code: "F-HOOK" });
    expect(JSON.stringify(r)).not.toContain("ACCESS");
    const both = fakeHooks([{ status: 400, json: {} }, { status: 401, json: {} }]);
    expect(await createFathomWebhook("ACCESS", "https://x.test/h", both.fetchImpl)).toMatchObject({ ok: false, code: "F-HOOK", providerCode: "http_401" });
  });
});

// ---------------- the note ----------------

const input = (over: Partial<NoteInput> = {}): NoteInput => ({ ...SAMPLE_NOTE_INPUT, ...over });

describe("the default note template (spec section 8)", () => {
  it("is the spec's text, character for character, and uses only variables the spec lists", () => {
    expect(DEFAULT_TEMPLATE).toBe("Meeting: {title}\nDate: {date} ({duration})\nWith: {attendees}\nRecorded by: {rep}, with {tool}\n\nSummary\n{summary}\n\nAction items\n{action_items}\n\nRecording: {recording_url}\n\nAdded by SubSync from {tool}.");
    expect(unknownVariables(DEFAULT_TEMPLATE)).toEqual([]);
    expect([...TEMPLATE_VARIABLES]).toEqual(["title", "date", "duration", "rep", "attendees", "summary", "action_items", "recording_url", "transcript_url", "transcript", "tool"]);
  });

  it("a full call renders every part, in order", () => {
    expect(renderNote(input()).text).toBe([
      "Meeting: Sample: quote call", "Date: Nov 2, 2026, 3:00 PM UTC (28 min)", "With: Alex Sample", "Recorded by: You, with Fathom", "",
      "Summary", "Alex wants a quote for the kitchen job and can decide by Friday. Budget was discussed and is flexible.", "",
      "Action items", "- Send the quote by Thursday", "- Book a site visit", "", "Recording: https://fathom.video/share/sample", "", "Added by SubSync from Fathom.",
    ].join("\n"));
  });

  it("an empty part leaves no empty heading: a call with no action items, no recording and no duration has neither the heading nor an empty bracket", () => {
    const t = renderNote(input({ actionItems: [], recordingUrl: null, durationMinutes: null })).text;
    expect(t).not.toContain("Action items");
    expect(t).not.toContain("Recording:");
    expect(t).not.toContain("()");
    expect(t).toContain("Date: Nov 2, 2026, 3:00 PM UTC\n");
  });

  it("the person's choices (after the account's rules) decide which parts are written: 'Summary only' has no action items and no recording link", () => {
    const t = renderNote(input(), { summary: true, actionItems: false, recordingLink: false, attendeesAndDate: true }).text;
    expect(t).toContain("Summary");
    expect(t).not.toContain("Action items");
    expect(t).not.toContain("Recording:");
    expect(renderNote(input(), { ...ALL_PARTS, attendeesAndDate: false }).text).not.toContain("With:");
  });

  it("values are inserted as plain text: tags and control characters are removed, never passed on as HTML", () => {
    const t = renderNote(input({ title: "<script>alert(1)</script>Hello <b>there</b>\u0007", summary: "<img src=x onerror=alert(1)>Plain" })).text;
    expect(t).not.toMatch(/<|>/);
    expect(t).toContain("Meeting: alert(1)Hello there");
    expect(plain("a\r\nb", 10)).toBe("a\nb");
  });

  it("an unknown variable is refused with the word that is wrong, so a custom template can never print a typo", () => {
    expect(unknownVariables("Hi {name} {title} {frist_name}")).toEqual(["name", "frist_name"]);
    expect(() => fillTemplate("Hi {name}", {})).toThrow(/Unknown variable: name/);
    expect(fillTemplate("Hi {title}", { title: "x" })).toBe("Hi x");
  });

  it("a long summary is cut between paragraphs, says so, and never loses the recording link or the footer; the note stays under the limit", () => {
    const paragraph = "This is one paragraph of a long summary that goes on and on. ".repeat(8).trim();
    const summary = Array.from({ length: 12 }, (_, i) => `${paragraph} (${i})`).join("\n\n");
    const made = renderNote(input({ summary }));
    expect(made.shortened).toBe(true);
    expect(made.text.length).toBeLessThanOrEqual(ASSUMED_LIMITS.noteChars);
    expect(made.text).toContain(SHORTENED);
    expect(made.text).toContain("Recording: https://fathom.video/share/sample");
    expect(made.text.endsWith("Added by SubSync from Fathom.")).toBe(true);
    expect(made.text).toContain("(0)");
    expect(made.text).not.toContain("(11)");
    // Cut at a paragraph boundary: the last kept paragraph is whole.
    const kept = made.text.split("Summary\n")[1].split(`\n\n${SHORTENED}`)[0].split("\n\n");
    expect(kept.every((p) => /\(\d+\)$/.test(p))).toBe(true);
  });

  it("a short note is never marked as shortened", () => {
    expect(renderNote(input()).shortened).toBe(false);
  });
});
