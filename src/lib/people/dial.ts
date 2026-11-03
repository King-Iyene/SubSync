// The Dial button (stage F10, N20, N53, N55, KF-3). Pure, so the rules are unit tested. SubSync builds no telephony.
//
// Where a call is placed:
//   "crm"   (the default) the CRM's own dialer. RESEARCH (1 Nov 2026, public documentation and help pages): the CRM publishes no web address that opens its
//           dialer, or a phone view, for a given contact. So the button opens the contact in the CRM (through the white-label link helper) and the screen
//           says so plainly ("Not available from your CRM yet"). If the CRM ever documents such a link, set DIALER_LINK_KNOWN and build it in dialPlan.
//   "phone" the person's own phone app (a tel: link). Only used when the person chose it in their setting, never by default (KF-3).
// A third-party dialer (for example Kixie) is a later provider, added only after its API is read; it is not built.

export type DialerProvider = "crm" | "phone";
export const DIALER_LINK_KNOWN = false;
export const DEFAULT_DIALER: DialerProvider = "crm";

export const parseDialer = (v: unknown): DialerProvider => (v === "phone" ? "phone" : "crm");

/** A phone number reduced to what a tel: link needs (digits and a leading plus), or null when nothing usable is left. */
export function telNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const plus = phone.trim().startsWith("+") ? "+" : "";
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 5 && digits.length <= 15 ? plus + digits : null;
}

export type DialPlan = {
  provider: DialerProvider;
  /** Where the button goes. Null when there is nothing to dial (no number, for the phone choice). */
  href: string | null;
  /** The button's words. */
  label: string;
  /** One plain line under the button that says what will happen. */
  note: string;
  /** True when the CRM has no link that opens its dialer, so the button opens the contact instead (always true today for the CRM choice). */
  fallsBackToContact: boolean;
};

export function dialPlan(provider: DialerProvider, v: { phone: string | null | undefined; contactUrl: string | null | undefined }): DialPlan {
  if (provider === "phone") {
    const n = telNumber(v.phone);
    return {
      provider, href: n ? `tel:${n}` : null, label: "Call with my phone", fallsBackToContact: false,
      note: n ? "Opens your own phone app (your choice in the Dialer setting)." : "There is no phone number to call.",
    };
  }
  return {
    provider, href: v.contactUrl ?? null, label: "Call in your CRM", fallsBackToContact: !DIALER_LINK_KNOWN,
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
