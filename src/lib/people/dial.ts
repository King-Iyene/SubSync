// The Dial button (stage F10, N20, N53, N55, KF-3). Pure, so the rules are unit tested. SubSync builds no telephony.
//
// Every call opens the contact in the CRM (through the white-label link helper), where its own dialer places the call. RESEARCH (1 Nov 2026): the CRM
// publishes no web address that opens its dialer for a contact. If it ever does, set DIALER_LINK_KNOWN and build it in dialPlan.

export const DIALER_LINK_KNOWN = false;

/** A phone number reduced to what a tel: link needs (digits and a leading plus), or null when nothing usable is left. */
export function telNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const plus = phone.trim().startsWith("+") ? "+" : "";
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 5 && digits.length <= 15 ? plus + digits : null;
}

export type DialPlan = {
  /** Where the button goes. Null when the contact has no CRM link. */
  href: string | null;
  label: string;
  /** One plain line under the button that says what will happen. */
  note: string;
  fallsBackToContact: boolean;
};

export function dialPlan(v: { phone: string | null | undefined; contactUrl: string | null | undefined }): DialPlan {
  return {
    href: v.contactUrl ?? null, label: "Call in your CRM", fallsBackToContact: !DIALER_LINK_KNOWN,
    note: DIALER_LINK_KNOWN ? "Opens your CRM's dialer." : "Not available from your CRM yet: this opens the contact in your CRM, where its own dialer places the call.",
  };
}

// ---------------- warnings before any dial ----------------

export const CALL_WINDOW = { startHour: 8, endHour: 21 } as const;

/** The hour (0 to 23) it is now in a time zone, or null when the zone is unknown or not valid. */
export function localHour(now: Date, timeZone: string | null | undefined): number | null {
  if (!timeZone) return null;
  try {
    const h = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).formatToParts(now).find((p) => p.type === "hour")?.value;
    const n = Number(h);
    return Number.isInteger(n) ? n : null;
  } catch {
    return null;
  }
}

export type DialWarning = { id: "dnd" | "quiet_hours" | "no_phone" | "zone_unknown"; level: "stop" | "caution"; text: string };

/**
 * What to tell a person BEFORE they dial. `dnd` is a hard stop in words (the contact asked not to be contacted); quiet hours are a caution: it is
 * outside 8 am to 9 pm where the account is. The account's time zone stands in for the contact's, which the CRM does not tell us, and the text says so.
 */
export function dialWarnings(v: { dnd: boolean; phone: string | null | undefined; timeZone: string | null | undefined; now: Date }): DialWarning[] {
  const out: DialWarning[] = [];
  if (v.dnd) out.push({ id: "dnd", level: "stop", text: "This person asked not to be contacted. Do not call them." });
  if (!telNumber(v.phone)) out.push({ id: "no_phone", level: "caution", text: "There is no usable phone number on this contact." });
  const h = localHour(v.now, v.timeZone);
  if (h === null) {
    if (v.timeZone === undefined || v.timeZone === null || v.timeZone === "") out.push({ id: "zone_unknown", level: "caution", text: "The account's time zone is not known, so SubSync cannot check calling hours. Calls are best placed between 8 am and 9 pm their time." });
  } else if (h < CALL_WINDOW.startHour || h >= CALL_WINDOW.endHour) {
    out.push({ id: "quiet_hours", level: "caution", text: `It is ${String(h).padStart(2, "0")}:00 where this account is. Calls are best placed between 8 am and 9 pm (the account's time zone stands in for theirs).` });
  }
  return out;
}

export const mustStop = (w: DialWarning[]) => w.some((x) => x.level === "stop");
