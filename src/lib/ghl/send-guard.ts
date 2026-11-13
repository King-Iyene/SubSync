// The rules for sending a text or an email from SubSync (King, 13 Nov 2026). Pure: no network, no database, so every rule is unit tested.
//
// SubSync sends a message only when a person presses Send, never on its own. It never sends to a contact who asked not to be contacted.
// Every check here FAILS CLOSED: an unknown time zone, an unreadable do-not-contact mark or a missing count is a stop, never a go-ahead.

export type SendChannel = "SMS" | "Email";
export type Blocker = { id: string; text: string };

export type SendSettings = {
  paused: boolean; quietStartHour: number; quietEndHour: number; perPersonHour: number; perPersonDay: number; accountDay: number; dupMinutes: number;
  footerEnabled: boolean; footerText: string; linkAllowlist: string[]; allowAgencySend: boolean;
};

export const DEFAULT_SETTINGS: SendSettings = {
  paused: false, quietStartHour: 21, quietEndHour: 8, perPersonHour: 2, perPersonDay: 5, accountDay: 200, dupMinutes: 10,
  footerEnabled: false, footerText: "Reply STOP to opt out.", linkAllowlist: [], allowAgencySend: true,
};

/** The most people one "Send to selected" may reach. */
export const BULK_CAP = 20;
export const MAX_SMS = 1000;
export const MAX_EMAIL = 10000;

/** Do-not-contact marks as the CRM holds them right now: for everything, and per channel. */
export type DndState = { all: boolean; sms: boolean; email: boolean };
export type Usage = { personHour: number; personDay: number; accountDay: number; duplicateRecent: boolean };
export type Who = { kind: "agency" | "business" | "client"; isOwnerOrAdmin: boolean };

export type GuardInput = {
  enabled: boolean; killed: boolean; settings: SendSettings; who: Who;
  /** True when the install granted the message permission, false when not, null when unknown (treated as not granted). */
  scopeGranted: boolean | null;
  channel: SendChannel; subject?: string; text: string;
  dnd: DndState | null; hasPhone: boolean; hasEmail: boolean; timeZone: string | null; now: Date; usage: Usage | null;
};

const LINK = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;
// Personal data that must never be pasted into a message by mistake: a card-like number, a government-id-like number, or a password line.
const CARD = /\b(?:\d[ -]?){13,19}\b/;
const GOV_ID = /\b\d{3}-\d{2}-\d{4}\b/;
const SECRET = /\b(?:password|passcode|pin|cvv|api[ _-]?key|secret)\s*(?:is|:|=)\s*\S+/i;

export const hostOf = (url: string): string | null => {
  try { return new URL(/^https?:/i.test(url) ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, ""); } catch { return null; }
};

/** Content checks: not empty, not too long, no obvious personal data, links only from the allow-list when the account set one. */
export function contentChecks(channel: SendChannel, text: string, subject: string | undefined, allow: readonly string[]): Blocker[] {
  const out: Blocker[] = [];
  const t = text.trim();
  if (!t) out.push({ id: "empty", text: "Write the message first." });
  if (t.length > (channel === "Email" ? MAX_EMAIL : MAX_SMS)) out.push({ id: "too_long", text: `That is too long for ${channel === "Email" ? "an email" : "a text"}.` });
  if (channel === "Email" && !(subject ?? "").trim()) out.push({ id: "no_subject", text: "Add a subject." });
  if (CARD.test(t) || GOV_ID.test(t) || SECRET.test(t)) out.push({ id: "personal_data", text: "This looks like it has a card number, an ID number or a password in it. SubSync will not send that. Take it out and try again." });
  if (allow.length) {
    const ok = allow.map((a) => hostOf(a)).filter((x): x is string => !!x);
    for (const m of t.match(LINK) ?? []) {
      const h = hostOf(m);
      if (!h || !ok.some((a) => h === a || h.endsWith(`.${a}`))) { out.push({ id: "link_not_allowed", text: `The link ${m.slice(0, 60)} is not on your allowed list (Settings, Messages).` }); break; }
    }
  }
  return out;
}

/** Characters per text part and how many parts. Plain letters fit 160 (153 when joined); anything else (emoji, curly quotes) makes it 70 (67 when joined). */
export function smsSegments(text: string): { chars: number; parts: number; perPart: number; unicode: boolean } {
  const unicode = /[^\x20-\x7E\n\r£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ¤¡ÄÖÑÜ§¿äöñüà€]/.test(text);
  const single = unicode ? 70 : 160;
  const joined = unicode ? 67 : 153;
  const chars = text.length;
  return { chars, unicode, perPart: chars <= single ? single : joined, parts: chars === 0 ? 0 : chars <= single ? 1 : Math.ceil(chars / joined) };
}

const hourIn = (tz: string, now: Date): number | null => {
  try { const h = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: tz }).format(now).replace(/\D/g, "")); return Number.isFinite(h) ? h % 24 : null; } catch { return null; }
};

/** True when the hour falls in the quiet window (the window may wrap past midnight: 21 to 8). Same start and end means no quiet hours. */
export const inQuietHours = (hour: number, start: number, end: number): boolean => (start === end ? false : start < end ? hour >= start && hour < end : hour >= start || hour < end);

/** Null when the person's local time is unknown (the caller must then stop). */
export function quietNow(tz: string | null, now: Date, s: Pick<SendSettings, "quietStartHour" | "quietEndHour">): boolean | null {
  if (!tz) return null;
  const h = hourIn(tz, now);
  return h === null ? null : inQuietHours(h, s.quietStartHour, s.quietEndHour);
}

/** The plain sentence for a stop in quiet hours. SubSync cannot schedule a text for later, so it says when sending opens again. */
export function quietText(tz: string, now: Date, s: Pick<SendSettings, "quietEndHour">): string {
  const h = hourIn(tz, now) ?? 0;
  const wait = (s.quietEndHour - h + 24) % 24 || 24;
  return `It is quiet hours where this person is (sending opens at ${String(s.quietEndHour).padStart(2, "0")}:00 their time, in about ${wait} hour${wait === 1 ? "" : "s"}). SubSync cannot schedule a message for later, so write to them then.`;
}

export const dndFor = (d: DndState, channel: SendChannel) => d.all || (channel === "SMS" ? d.sms : d.email);

/** Every reason this send must not go ahead. An empty list means it may. */
export function guardSend(i: GuardInput): Blocker[] {
  const b: Blocker[] = [];
  if (!i.enabled) b.push({ id: "off", text: "Sending from SubSync is not switched on." });
  if (i.killed) b.push({ id: "killed", text: "Sending is paused for everyone right now. Nothing was sent." });
  if (i.settings.paused) b.push({ id: "paused", text: "Sending is paused for this account (Settings, Messages)." });
  if (i.scopeGranted !== true) b.push({ id: "needs_permission", text: "Needs permission: reconnect SubSync and allow it to send messages. Nothing was sent." });
  if (i.who.kind === "client" || i.who.kind === "business") { /* staff of the account itself may send on their own account */ }
  else if (!i.who.isOwnerOrAdmin) b.push({ id: "role", text: "Only the owner or an administrator can send from here." });
  else if (!i.settings.allowAgencySend) b.push({ id: "role", text: "This account has turned off sending by the company that manages it (Settings, Messages)." });
  if (i.channel === "SMS" ? !i.hasPhone : !i.hasEmail) b.push({ id: "no_destination", text: i.channel === "Email" ? "This person has no email address." : "This person has no phone number." });
  // Fail closed: if the do-not-contact mark could not be read just now, nothing goes.
  if (!i.dnd) b.push({ id: "dnd_unknown", text: "SubSync could not confirm this person still accepts messages. Nothing was sent. Try again in a moment." });
  else if (dndFor(i.dnd, i.channel)) b.push({ id: "dnd", text: `This person asked not to be contacted${i.dnd.all ? "" : ` by ${i.channel === "SMS" ? "text" : "email"}`}. SubSync will not send them anything.` });
  if (i.channel === "SMS") {
    const q = quietNow(i.timeZone, i.now, i.settings);
    if (q === null) b.push({ id: "tz_unknown", text: "SubSync does not know the time zone of this account, so it cannot tell if it is a good hour to text. Nothing was sent." });
    else if (q) b.push({ id: "quiet_hours", text: quietText(i.timeZone as string, i.now, i.settings) });
  }
  if (!i.usage) b.push({ id: "usage_unknown", text: "SubSync could not check the daily limits just now. Nothing was sent." });
  else {
    if (i.usage.duplicateRecent) b.push({ id: "duplicate", text: `That same message was already sent to this person in the last ${i.settings.dupMinutes} minutes.` });
    if (i.usage.personHour >= i.settings.perPersonHour) b.push({ id: "cap_person_hour", text: `This person already got ${i.settings.perPersonHour} message${i.settings.perPersonHour === 1 ? "" : "s"} this hour.` });
    if (i.usage.personDay >= i.settings.perPersonDay) b.push({ id: "cap_person_day", text: `This person already got ${i.settings.perPersonDay} message${i.settings.perPersonDay === 1 ? "" : "s"} today.` });
    if (i.usage.accountDay >= i.settings.accountDay) b.push({ id: "cap_account_day", text: `This account reached its limit of ${i.settings.accountDay} messages today.` });
  }
  b.push(...contentChecks(i.channel, i.text, i.subject, i.settings.linkAllowlist));
  return b;
}

/** The text that is really sent: the person's words, plus the opt-out line for a text when the account turned it on. */
export function finalText(channel: SendChannel, text: string, s: Pick<SendSettings, "footerEnabled" | "footerText">): string {
  const t = text.trim();
  if (channel !== "SMS" || !s.footerEnabled || !s.footerText.trim()) return t;
  return t.toLowerCase().includes(s.footerText.trim().toLowerCase()) ? t : `${t}\n${s.footerText.trim()}`;
}

/** Merge fields for templates. Only these names exist; anything else is left as typed. Values are plain text (never markup). */
export const MERGE_FIELDS = ["first_name", "my_name", "business"] as const;
export function fillMerge(template: string, v: { first_name: string; my_name: string; business: string }): string {
  return template.replace(/\{(first_name|my_name|business)\}/g, (_m, k: keyof typeof v) => v[k] ?? "");
}
/** True when a template holds markup: templates are plain text, so SubSync refuses it rather than trying to clean it. */
export const hasMarkup = (s: string): boolean => /<\/?[a-z][^>]*>|javascript:/i.test(s);

/** A one-way hash of the words (for the log and the duplicate check). Never reversible, never the words. */
export function textHash(s: string): string {
  let h1 = 0xdeadbeef ^ s.length, h2 = 0x41c6ce57 ^ s.length;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

/** The key that makes a second press of the same send harmless: one person, one channel, one text, one time bucket. */
export const idemKey = (contactId: string, channel: SendChannel, text: string, now: Date, dupMinutes: number): string =>
  `${contactId}:${channel}:${textHash(text)}:${Math.floor(now.getTime() / (Math.max(1, dupMinutes) * 60_000))}`;

/** Reads the CRM's contact answer into do-not-contact marks. Null (unknown) when the answer has no sign of either field, so the caller stops. */
export function parseDnd(contact: unknown): DndState | null {
  const c = (contact && typeof contact === "object" ? contact : null) as Record<string, unknown> | null;
  const root = (c?.contact && typeof c.contact === "object" ? c.contact : c) as Record<string, unknown> | null;
  if (!root || (!("dnd" in root) && !("dndSettings" in root))) return null;
  const st = (k: string) => { const s = (root.dndSettings as Record<string, unknown> | undefined)?.[k] as { status?: string } | undefined; return String(s?.status ?? "").toLowerCase() === "active"; };
  return { all: root.dnd === true || st("All"), sms: st("SMS"), email: st("Email") };
}

/** Compliance for the copy people see. */
export const SEND_STATEMENT = "SubSync sends a message only when a person presses Send (or a schedule they set), never on its own. It never sends to a contact who asked not to be contacted.";
