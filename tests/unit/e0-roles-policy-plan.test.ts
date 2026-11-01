import { describe, expect, it } from "vitest";
import type { Role } from "@/lib/identity";
import { accessibleAccounts, can, covers, personFromSession, roleOfSession, statusScope, type Action, type Person } from "@/lib/connections/person";
import { clipChoices, DEFAULT_POLICY, effectivePolicy, matrixFor, PRESETS, readFlags, stricter, type Matrix, type PolicyFlags } from "@/lib/connections/policy";
import { INBOX_MESSAGE, MAX_CONTACTS_PER_MEETING, planMeeting, retentionDays, type Candidate, type PlanInput } from "@/lib/connections/meeting-plan";

// INTEGRATIONS_SPEC sections 3, 3.2, 6 and 7. All pure: no database, no network.

const ROLES: Role[] = ["agency_owner", "agency_admin", "agency_staff", "account_admin", "account_user"];

const person = (role: Role, over: Partial<Person> = {}): Person => {
  const agency = role.startsWith("agency");
  return { companyKey: "CO1", userId: `U-${role}`, name: role, role, kind: agency ? "agency" : "client", homeLocationId: agency ? null : "LA", ...over };
};

describe("who may do what (the table in spec section 3)", () => {
  const expected: Record<Action, Record<Role, boolean>> = {
    connect_own: { agency_owner: true, agency_admin: true, agency_staff: true, account_admin: true, account_user: true },
    set_own_prefs: { agency_owner: true, agency_admin: true, agency_staff: true, account_admin: true, account_user: true },
    see_own_meetings: { agency_owner: true, agency_admin: true, agency_staff: true, account_admin: true, account_user: true },
    see_status: { agency_owner: true, agency_admin: true, agency_staff: true, account_admin: true, account_user: false },
    read_others_content: { agency_owner: false, agency_admin: false, agency_staff: false, account_admin: false, account_user: false },
    revoke: { agency_owner: true, agency_admin: true, agency_staff: true, account_admin: true, account_user: false },
    connect_workspace: { agency_owner: true, agency_admin: true, agency_staff: true, account_admin: true, account_user: false },
    set_account_policy: { agency_owner: true, agency_admin: true, agency_staff: true, account_admin: true, account_user: false },
    set_agency_policy: { agency_owner: true, agency_admin: false, agency_staff: false, account_admin: false, account_user: false },
  };
  for (const [action, byRole] of Object.entries(expected)) {
    it(`${action}: ${ROLES.map((r) => `${r}=${byRole[r as Role]}`).join(", ")}`, () => {
      for (const role of ROLES) expect(can(role, action as Action), `${role} ${action}`).toBe(byRole[role]);
    });
  }
  it("nobody at all can read another person's meeting content", () => {
    for (const role of ROLES) expect(can(role, "read_others_content")).toBe(false);
  });
});

describe("the person comes only from the verified session", () => {
  const session = { companyId: "CO1", userId: "U1", userName: "Ada", role: "admin" };
  it("uses the role sign-in worked out, and for an older session reads the raw role at its least privilege (never an owner)", () => {
    expect(roleOfSession({ ...session, personRole: "agency_owner" }, "agency")).toBe("agency_owner");
    expect(roleOfSession(session, "agency")).toBe("agency_admin");
    expect(roleOfSession({ ...session, role: "user" }, "agency")).toBe("agency_staff");
    expect(roleOfSession(session, "business")).toBe("account_admin");
    expect(roleOfSession({ ...session, role: null }, "client")).toBe("account_user");
  });
  it("is nobody without a user id, and a limited session without an account is malformed", () => {
    expect(personFromSession({ ...session, userId: null }, "agency", null)).toBeNull();
    expect(personFromSession(session, "client", null)).toBeNull();
    expect(personFromSession(session, "client", "LA")).toMatchObject({ userId: "U1", homeLocationId: "LA", kind: "client" });
    expect(personFromSession(session, "agency", null)).toMatchObject({ homeLocationId: null });
  });
});

describe("whose status an administrator can see, and revoke (never content)", () => {
  it("company owner and administrator see everyone in the company; company staff see only accounts the Users list proves, and nothing until it does", () => {
    expect(statusScope(person("agency_owner"))).toEqual({ kind: "all" });
    expect(statusScope(person("agency_admin"))).toEqual({ kind: "all" });
    expect(statusScope(person("agency_staff"))).toEqual({ kind: "none" });
    expect(statusScope(person("agency_staff"), [])).toEqual({ kind: "none" });
    expect(statusScope(person("agency_staff"), ["LA"])).toEqual({ kind: "listed", locationIds: ["LA"] });
  });
  it("a business's administrator sees its own people; a client's administrator only the people of their own account; an account user nobody", () => {
    expect(statusScope(person("account_admin", { kind: "business" }))).toEqual({ kind: "all" });
    expect(statusScope(person("account_admin"))).toEqual({ kind: "account", locationId: "LA" });
    expect(statusScope(person("account_user"))).toEqual({ kind: "none" });
  });
  it("covers: a client administrator cannot see or revoke a person from another account or a company staff member", () => {
    const own = statusScope(person("account_admin"));
    expect(covers(own, "LA")).toBe(true);
    expect(covers(own, "LB")).toBe(false);
    expect(covers(own, null)).toBe(false);
    expect(covers({ kind: "all" }, null)).toBe(true);
    expect(covers({ kind: "none" }, "LA")).toBe(false);
    expect(covers({ kind: "listed", locationIds: ["LA"] }, "LB")).toBe(false);
  });
});

describe("which client accounts a person can match and write into (spec 3.2 rule 2)", () => {
  const installed = [{ locationId: "LA" }, { locationId: "LB" }, { locationId: "LC", ignored: true }];
  it("company owner and administrator reach every account that has SubSync (not an ignored one)", () => {
    expect(accessibleAccounts(person("agency_owner"), installed)).toEqual(["LA", "LB"]);
    expect(accessibleAccounts(person("agency_admin"), installed)).toEqual(["LA", "LB"]);
  });
  it("company staff reach only what the Users list proves, and nothing when it cannot prove any", () => {
    expect(accessibleAccounts(person("agency_staff"), installed, null)).toEqual([]);
    expect(accessibleAccounts(person("agency_staff"), installed, [])).toEqual([]);
    expect(accessibleAccounts(person("agency_staff"), installed, ["LB", "LZ"])).toEqual(["LB"]);
  });
  it("an account's own people reach their own account only, whatever the installation holds", () => {
    expect(accessibleAccounts(person("account_user"), installed)).toEqual(["LA"]);
    expect(accessibleAccounts(person("account_admin"), installed, ["LA", "LB"])).toEqual(["LA"]);
    expect(accessibleAccounts(person("account_user", { homeLocationId: "LZ" }), installed)).toEqual([]);
  });
});

describe("policy: the most restrictive of company, account and person wins (spec 6)", () => {
  it("the defaults are the ones in the spec", () => {
    expect(DEFAULT_POLICY).toMatchObject({ allowCrmWrites: true, allowTranscripts: false, destinations: ["note", "comment"], inboxRetentionDays: 14, dailyCapPerUser: 50, dailyCapPerAccount: 200, locked: [] });
  });
  it("an account can make the company's rule stricter but never looser", () => {
    const company = { allowTranscripts: true, destinations: ["note", "comment", "field"], inboxRetentionDays: 30, dailyCapPerUser: 80 };
    expect(effectivePolicy(company, { allowTranscripts: false })).toMatchObject({ allowTranscripts: false });
    expect(effectivePolicy({ allowTranscripts: false }, { allowTranscripts: true }).allowTranscripts, "an account cannot turn on what the company turned off").toBe(false);
    expect(effectivePolicy({ allowCrmWrites: false }, { allowCrmWrites: true }).allowCrmWrites).toBe(false);
    expect(effectivePolicy(company, { destinations: ["note"], inboxRetentionDays: 7, dailyCapPerUser: 10 })).toMatchObject({ destinations: ["note"], inboxRetentionDays: 7, dailyCapPerUser: 10 });
    expect(effectivePolicy({ destinations: ["note"] }, { destinations: ["comment"] }).destinations, "nothing both allow").toEqual([]);
    expect(effectivePolicy({ inboxRetentionDays: 7 }, { inboxRetentionDays: 30 }).inboxRetentionDays).toBe(7);
  });
  it("a locked setting stays locked, internal domains from either layer stay excluded, and bad stored JSON falls back to the defaults", () => {
    expect(stricter(readFlags({ locked: ["destinations"] }), readFlags({ locked: ["preset"] })).locked.sort()).toEqual(["destinations", "preset"]);
    expect(stricter(readFlags({ internalDomains: ["a.com"] }), readFlags({ internalDomains: ["b.com", "bad domain!"] })).internalDomains.sort()).toEqual(["a.com", "b.com"]);
    for (const bad of [null, undefined, "x", 5, [], { inboxRetentionDays: "forever", destinations: "all", dailyCapPerUser: -5 }]) {
      const f = readFlags(bad);
      expect(f.allowTranscripts).toBe(false);
      expect(f.inboxRetentionDays).toBeGreaterThanOrEqual(1);
      expect(f.inboxRetentionDays).toBeLessThanOrEqual(30);
      expect(f.dailyCapPerUser).toBeGreaterThanOrEqual(0);
    }
    expect(readFlags({ inboxRetentionDays: 400 }).inboxRetentionDays, "the inbox keeps at most 30 days").toBe(30);
  });
  it("the person's choice is clipped by the policy, with the reason: writes off, destination not allowed, transcript not allowed", () => {
    const full = matrixFor("full_record", null);
    expect(full.transcript).toBe("comment");
    const allowing: PolicyFlags = { ...DEFAULT_POLICY, allowTranscripts: true };
    expect(clipChoices(full, allowing, true)).toMatchObject({ writesAllowed: true, clips: [] });
    const noTranscript = clipChoices(full, DEFAULT_POLICY, true);
    expect(noTranscript.items.transcript).toBe("subsync_only");
    expect(noTranscript.clips).toEqual([{ item: "transcript", wanted: "comment", got: "subsync_only", because: "transcripts in the CRM are not allowed by your admin" }]);
    const noComment = clipChoices(full, { ...allowing, destinations: ["note"] }, true);
    expect(noComment.items.transcript).toBe("subsync_only");
    expect(noComment.clips[0].because).toMatch(/conversation comments are not allowed/);
    const off = clipChoices(PRESETS.recommended, { ...DEFAULT_POLICY, allowCrmWrites: false }, true);
    expect(off.writesAllowed).toBe(false);
    expect(Object.values(off.items).filter((d) => d === "subsync_only")).toHaveLength(4);
    expect(off.clips[0].because).toMatch(/switched off by your admin/);
    const mine = clipChoices(PRESETS.recommended, DEFAULT_POLICY, false);
    expect(mine.writesAllowed).toBe(false);
    expect(mine.clips[0].because).toMatch(/you switched writing to the CRM off/);
  });
  it("the transcript is off in the recommended preset and the custom matrix ignores anything that is not a known destination", () => {
    expect(PRESETS.recommended.transcript).toBe("off");
    expect(matrixFor("custom", { summary: "comment", transcript: "email-it-to-everyone", bogus: "note" }).summary).toBe("comment");
    expect(matrixFor("custom", { transcript: "email-it-to-everyone" }).transcript).toBe("off");
  });
});

// ---------------- where a meeting goes ----------------

const INSTALLED = [{ locationId: "LA" }, { locationId: "LB" }];
const recommended: Matrix = PRESETS.recommended;
const input = (over: Partial<PlanInput> = {}): PlanInput => ({
  person: person("agency_admin"), provider: "fathom", installed: INSTALLED, provenAccess: null, attendeeEmails: ["lee@client.test"], internalEmails: [], internalDomains: [],
  candidates: [], policies: { LA: DEFAULT_POLICY, LB: DEFAULT_POLICY }, settings: { masterSwitch: true, unmatchedMode: "inbox", matrix: recommended }, writesToday: { user: 0, byAccount: {} }, ...over,
});
const c = (locationId: string, contactId: string, email: string): Candidate => ({ locationId, contactId, email });

describe("planMeeting: no guessing (spec section 7)", () => {
  it("ACCEPTANCE: an agency administrator connects once and a meeting with a contact in account B lands in B, under B's policy", () => {
    const strictB = effectivePolicy({}, { destinations: ["note"], allowTranscripts: false });
    const plan = planMeeting(input({ candidates: [c("LB", "CB1", "lee@client.test")], policies: { LA: DEFAULT_POLICY, LB: strictB } }));
    expect(plan.kind).toBe("write");
    if (plan.kind !== "write") return;
    expect(plan.targets).toHaveLength(1);
    expect(plan.targets[0]).toMatchObject({ locationId: "LB", contactId: "CB1", allowed: true, blockedBecause: null });
    expect(plan.targets[0].items.summary).toBe("note");
  });
  it("B's own rule applies even when A's is looser: a policy that forbids notes there stops the write in B only", () => {
    const noNotes = effectivePolicy({}, { allowCrmWrites: false });
    const plan = planMeeting(input({ attendeeEmails: ["lee@client.test", "ana@client.test"], candidates: [c("LA", "CA1", "ana@client.test"), c("LB", "CB1", "lee@client.test")], policies: { LA: DEFAULT_POLICY, LB: noNotes } }));
    expect(plan.kind).toBe("write");
    if (plan.kind !== "write") return;
    expect(plan.targets.map((x) => [x.locationId, x.allowed, x.blockedBecause])).toEqual([["LB", false, "writes_off"], ["LA", true, null]]);
  });
  it("company staff cannot save into an account they cannot access: a contact in account B is not even considered", () => {
    const plan = planMeeting(input({ person: person("agency_staff"), provenAccess: ["LA"], candidates: [c("LB", "CB1", "lee@client.test")] }));
    expect(plan).toMatchObject({ kind: "inbox", reason: "no_match" });
  });
  it("company staff with no proven access match nothing at all", () => {
    expect(planMeeting(input({ person: person("agency_staff"), provenAccess: null, candidates: [c("LA", "CA1", "lee@client.test"), c("LB", "CB1", "lee@client.test")] }))).toMatchObject({ kind: "inbox", reason: "no_match" });
  });
  it("an account's own person only ever matches inside their own account, with no setting to choose another", () => {
    const plan = planMeeting(input({ person: person("account_user"), candidates: [c("LB", "CB1", "lee@client.test")] }));
    expect(plan).toMatchObject({ kind: "inbox", reason: "no_match" });
    const own = planMeeting(input({ person: person("account_user"), candidates: [c("LA", "CA1", "lee@client.test")] }));
    expect(own.kind).toBe("write");
  });
  it("one email on two contact records in one account (duplicates) goes to the inbox with that reason, never guessed", () => {
    const plan = planMeeting(input({ candidates: [c("LA", "CA1", "lee@client.test"), c("LA", "CA2", "Lee@Client.test")] }));
    expect(plan).toMatchObject({ kind: "inbox", reason: "duplicate_contact", message: INBOX_MESSAGE.duplicate_contact });
  });
  it("the same email as a contact in two client accounts goes to the inbox, never auto-picked (the same risk as N48)", () => {
    const plan = planMeeting(input({ candidates: [c("LA", "CA1", "lee@client.test"), c("LB", "CB1", "lee@client.test")] }));
    expect(plan).toMatchObject({ kind: "inbox", reason: "cross_account" });
  });
  it("an ambiguous attendee holds the WHOLE meeting, even when another attendee matches cleanly", () => {
    const plan = planMeeting(input({ attendeeEmails: ["lee@client.test", "ana@client.test"], candidates: [c("LA", "CA1", "lee@client.test"), c("LB", "CB1", "lee@client.test"), c("LA", "CA9", "ana@client.test")] }));
    expect(plan.kind).toBe("inbox");
  });
  it("nobody matched: the inbox by default, or only counted when the person chose not to keep it; names and phone numbers never match", () => {
    expect(planMeeting(input())).toMatchObject({ kind: "inbox", reason: "no_match", retentionDays: 14, message: INBOX_MESSAGE.no_match });
    expect(planMeeting(input({ settings: { masterSwitch: true, unmatchedMode: "discard", matrix: recommended } }))).toEqual({ kind: "discard", reason: "no_match" });
  });
  it("the inbox says the real number of days when the policy shortens it", () => {
    const short = effectivePolicy({}, { inboxRetentionDays: 7 });
    const plan = planMeeting(input({ policies: { LA: short, LB: DEFAULT_POLICY } }));
    expect(plan).toMatchObject({ kind: "inbox", retentionDays: 7 });
    expect((plan as { message: string }).message).toContain("7 days");
    expect(retentionDays({ LA: short, LB: DEFAULT_POLICY }, ["LA", "LB"])).toBe(7);
  });
  it("the company's own people (by email and by domain) and the person's own account are never matched as contacts", () => {
    const plan = planMeeting(input({
      attendeeEmails: ["me@agency.test", "colleague@agency.test", "lee@client.test"], internalEmails: ["me@agency.test"], internalDomains: ["agency.test"], candidates: [c("LA", "CX", "colleague@agency.test"), c("LA", "CA1", "lee@client.test")],
    }));
    expect(plan.kind).toBe("write");
    if (plan.kind === "write") expect(plan.targets.map((t) => t.contactId)).toEqual(["CA1"]);
    expect(planMeeting(input({ attendeeEmails: ["me@agency.test"], internalDomains: ["agency.test"] }))).toMatchObject({ kind: "inbox", reason: "no_external_attendee" });
  });
  it("attendees that match different contacts each get a note, at most five per meeting", () => {
    const emails = Array.from({ length: 7 }, (_, i) => `p${i}@client.test`);
    const plan = planMeeting(input({ attendeeEmails: emails, candidates: emails.map((e, i) => c("LA", `C${i}`, e)) }));
    expect(plan.kind).toBe("write");
    if (plan.kind === "write") { expect(plan.targets).toHaveLength(MAX_CONTACTS_PER_MEETING); expect(plan.leftOut).toBe(2); }
    const two = planMeeting(input({ attendeeEmails: ["a@client.test", "b@client.test"], candidates: [c("LA", "C1", "a@client.test"), c("LB", "C2", "b@client.test")] }));
    if (two.kind === "write") expect(two.targets.map((t) => t.locationId).sort()).toEqual(["LA", "LB"]);
    else throw new Error("expected a write plan");
  });
  it("two emails of the same contact make one target", () => {
    const plan = planMeeting(input({ attendeeEmails: ["a@client.test", "a2@client.test"], candidates: [c("LA", "C1", "a@client.test"), c("LA", "C1", "a2@client.test")] }));
    if (plan.kind === "write") expect(plan.targets).toHaveLength(1); else throw new Error("expected a write plan");
  });
  it("writes switched off (by the policy or by the person) keep the meeting in the inbox; a provider the account does not allow does too; and so does the daily cap", () => {
    const cand = [c("LA", "CA1", "lee@client.test")];
    expect(planMeeting(input({ candidates: cand, policies: { LA: effectivePolicy({}, { allowCrmWrites: false }), LB: DEFAULT_POLICY } }))).toMatchObject({ kind: "inbox", reason: "writes_off" });
    expect(planMeeting(input({ candidates: cand, settings: { masterSwitch: false, unmatchedMode: "inbox", matrix: recommended } }))).toMatchObject({ kind: "inbox", reason: "writes_off" });
    expect(planMeeting(input({ candidates: cand, policies: { LA: effectivePolicy({}, { providers: ["zoom"] }), LB: DEFAULT_POLICY } }))).toMatchObject({ kind: "inbox", reason: "provider_not_allowed" });
    expect(planMeeting(input({ candidates: cand, writesToday: { user: 50, byAccount: {} } }))).toMatchObject({ kind: "inbox", reason: "over_daily_cap" });
    expect(planMeeting(input({ candidates: cand, writesToday: { user: 0, byAccount: { LA: 200 } } }))).toMatchObject({ kind: "inbox", reason: "over_daily_cap" });
    expect(planMeeting(input({ candidates: cand, writesToday: { user: 49, byAccount: { LA: 199 } } })).kind).toBe("write");
  });
  it("matching is case-insensitive on the email and ignores a malformed one", () => {
    expect(planMeeting(input({ attendeeEmails: ["LEE@Client.Test", "not-an-email"], candidates: [c("LA", "CA1", "lee@client.test")] })).kind).toBe("write");
  });
});
