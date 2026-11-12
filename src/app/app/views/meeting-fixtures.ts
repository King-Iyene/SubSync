// Sample data for the Meeting notes screens, shown ONLY when the address carries ?mnfx and always labelled "Sample data" on the screen. Real data is the default everywhere else.
// The names are made up. Nothing here is ever sent to or read from the server.

export const mnFx = (): boolean => { try { return typeof window !== "undefined" && new URLSearchParams(window.location.search).has("mnfx"); } catch { return false; } };

const D = (daysAgo: number, h = 10) => new Date(Date.now() - daysAgo * 86_400_000 - (new Date().getUTCHours() - h) * 3_600_000).toISOString();

type Outcome = { state: string; words: string; suggested: string | null; appointmentId: string | null };
const none: Outcome = { state: "none", words: "No appointment outcome", suggested: null, appointmentId: null };
const confirm: Outcome = { state: "to_confirm", words: "Looks like they showed: confirm?", suggested: "showed", appointmentId: "appt-1" };

export const FX_LIST = [
  { id: "fx-1", title: "Roof inspection, Dana Whitfield", startedAt: D(0.2), at: D(0.2), statusKey: "on_contact", statusLabel: "On the contact", minutes: 34, attendees: 1, items: 3, hasSummary: true, hasRecording: true, locationId: "fx-loc", locationName: "Summit Roofing (sample)", contactId: "fx-c1", contactName: "Dana Whitfield", outcome: confirm, followed: false },
  { id: "fx-2", title: "Intro call, Marcus Lee", startedAt: D(1.1), at: D(1.1), statusKey: "on_contact", statusLabel: "On the contact", minutes: 22, attendees: 1, items: 0, hasSummary: true, hasRecording: true, locationId: "fx-loc", locationName: "Summit Roofing (sample)", contactId: "fx-c2", contactName: "Marcus Lee", outcome: none, followed: true },
  { id: "fx-3", title: "Quote review", startedAt: D(2.3), at: D(2.3), statusKey: "waiting_pick", statusLabel: "Waiting for you to pick the contact", minutes: 18, attendees: 2, items: 2, hasSummary: true, hasRecording: true, locationId: null, locationName: null, contactId: null, contactName: null, outcome: none, followed: null },
  { id: "fx-4", title: "Follow-up, Priya Nair", startedAt: D(4.4), at: D(4.4), statusKey: "on_contact", statusLabel: "On the contact", minutes: 41, attendees: 1, items: 4, hasSummary: true, hasRecording: false, locationId: "fx-loc2", locationName: "Harbor Dental (sample)", contactId: "fx-c4", contactName: "Priya Nair", outcome: { state: "confirmed", words: "Outcome set", suggested: "showed", appointmentId: "appt-4" }, followed: true },
];

export const FX_DETAIL: Record<string, {
  id: string; title: string | null; startedAt: string | null; minutes: number | null; talkPct: number | null; statusKey: string; statusLabel: string; attendees: string[]; summary: string | null; actionItems: string[];
  recordingUrl: string | null; locationId: string | null; locationName: string | null; contactId: string | null; contactName: string | null; contactUrl: string | null;
  appointment: { id: string; startAt: string | null; status: string | null; calendar: string | null } | null; outcome: { state: string; words: string; suggested: string | null };
  tasks: Array<{ itemNo: number; status: string }>; nextStep: string | null; candidates: Array<{ locationId: string; locationName: string; contactId: string; name: string; email: string; url: string }>; canTasks: boolean; canOutcome: boolean;
}> = {
  "fx-1": { id: "fx-1", title: "Roof inspection, Dana Whitfield", startedAt: D(0.2), minutes: 34, talkPct: 38, statusKey: "on_contact", statusLabel: "On the contact", attendees: ["dana@example.test"], summary: "Dana wants the north slope replaced before winter. Budget is about 9,000. She will ask her husband and decide by Friday.", actionItems: ["Send the written quote today", "Book the site visit for Thursday", "Call Dana on Friday morning"], recordingUrl: null, locationId: "fx-loc", locationName: "Summit Roofing (sample)", contactId: "fx-c1", contactName: "Dana Whitfield", contactUrl: null, appointment: { id: "appt-1", startAt: D(0.2), status: "new", calendar: "Estimates" }, outcome: { state: "to_confirm", words: "Looks like they showed: confirm?", suggested: "showed" }, tasks: [], nextStep: "Send the written quote today", candidates: [], canTasks: true, canOutcome: false },
  "fx-2": { id: "fx-2", title: "Intro call, Marcus Lee", startedAt: D(1.1), minutes: 22, talkPct: null, statusKey: "on_contact", statusLabel: "On the contact", attendees: ["marcus@example.test"], summary: "Marcus is comparing two companies. He liked the warranty.", actionItems: [], recordingUrl: null, locationId: "fx-loc", locationName: "Summit Roofing (sample)", contactId: "fx-c2", contactName: "Marcus Lee", contactUrl: null, appointment: null, outcome: { state: "none", words: "No appointment outcome", suggested: null }, tasks: [], nextStep: null, candidates: [], canTasks: true, canOutcome: false },
  "fx-3": { id: "fx-3", title: "Quote review", startedAt: D(2.3), minutes: 18, talkPct: null, statusKey: "waiting_pick", statusLabel: "Waiting for you to pick the contact", attendees: ["sam@example.test", "alex@example.test"], summary: "Two people on the call share a surname.", actionItems: ["Resend the quote", "Confirm the start date"], recordingUrl: null, locationId: null, locationName: null, contactId: null, contactName: null, contactUrl: null, appointment: null, outcome: { state: "none", words: "No appointment outcome", suggested: null }, tasks: [], nextStep: "Resend the quote", candidates: [{ locationId: "fx-loc", locationName: "Summit Roofing (sample)", contactId: "fx-c5", name: "Sam Ortega", email: "sam@example.test", url: "#" }, { locationId: "fx-loc2", locationName: "Harbor Dental (sample)", contactId: "fx-c6", name: "Alex Ortega", email: "alex@example.test", url: "#" }], canTasks: true, canOutcome: false },
  "fx-4": { id: "fx-4", title: "Follow-up, Priya Nair", startedAt: D(4.4), minutes: 41, talkPct: 52, statusKey: "on_contact", statusLabel: "On the contact", attendees: ["priya@example.test"], summary: "Priya signed the plan. Start date agreed.", actionItems: ["Send the welcome pack", "Add her to the onboarding list", "Schedule the first visit", "Share the payment link"], recordingUrl: null, locationId: "fx-loc2", locationName: "Harbor Dental (sample)", contactId: "fx-c4", contactName: "Priya Nair", contactUrl: null, appointment: { id: "appt-4", startAt: D(4.4), status: "showed", calendar: "Consults" }, outcome: { state: "confirmed", words: "Outcome set", suggested: "showed" }, tasks: [{ itemNo: 1, status: "saved" }], nextStep: "Send the welcome pack", candidates: [], canTasks: true, canOutcome: false },
};

export const FX_FOLLOW = {
  no_followup: [{ meetingId: "fx-1", title: "Roof inspection, Dana Whitfield", startedAt: D(3), daysAgo: 3, locationId: "fx-loc", locationName: "Summit Roofing (sample)", contactId: "fx-c1", contactName: "Dana Whitfield", nextStep: "Send the written quote today", deal: null, url: null }],
  no_next_step: [{ meetingId: "fx-2", title: "Intro call, Marcus Lee", startedAt: D(1.1), daysAgo: 1, locationId: "fx-loc", locationName: "Summit Roofing (sample)", contactId: "fx-c2", contactName: "Marcus Lee", nextStep: null, deal: null, url: null }],
  deal_not_moved: [{ meetingId: "fx-4", title: "Follow-up, Priya Nair", startedAt: D(9), daysAgo: 9, locationId: "fx-loc2", locationName: "Harbor Dental (sample)", contactId: "fx-c4", contactName: "Priya Nair", nextStep: "Send the welcome pack", deal: { name: "Whitening plan", value: 1800 }, url: null }],
};

export const FX_COACH = {
  scope: "team",
  rows: [
    { name: "Dana (sample)", isMe: true, role: "closer", calls: 31, enough: true, avgMinutes: 34, avgTalkPct: 41, nextStepRate: 77, showToClose: 38, closed: 9 },
    { name: "Marcus (sample)", isMe: false, role: "setter", calls: 44, enough: true, avgMinutes: 12, avgTalkPct: 58, nextStepRate: 52, showToClose: null, closed: 0 },
    { name: "Priya (sample)", isMe: false, role: "closer", calls: 3, enough: false, avgMinutes: 29, avgTalkPct: null, nextStepRate: null, showToClose: null, closed: 0 },
  ],
  team: { name: "Team", calls: 78, enough: true, avgMinutes: 22, avgTalkPct: 48, nextStepRate: 62, showToClose: 31, closed: 9 },
};

export const fxHome = () => ({
  flags: { followups: true, tasks: true, coach: true, logged: true, outcomes: true },
  connection: { id: "fx", status: "connected", email: "dana@example.test", lastOkAt: null, lastEventAt: new Date(Date.now() - 7_200_000).toISOString(), errorCode: null },
  follow: { no_followup: 1, no_next_step: 1, deal_not_moved: 1 }, waiting: 1,
  week: { held: 12, logged: 9, noNextStep: 3, waiting: 1, line: "12 recorded calls this week, 9 on a contact, 3 with no next step, 1 waiting to be matched." },
});
