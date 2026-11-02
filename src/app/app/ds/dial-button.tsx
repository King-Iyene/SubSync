"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { dialPlan, dialWarnings, mustStop, type DialerProvider } from "@/lib/people/dial";
import { useApiClient } from "../session";

// The Dial button (stage F10, KF-3). By default it opens the CRM's own dialer for the contact through the white-label link; the CRM publishes no link that opens
// its dialer directly, so today it opens the contact in the CRM and says so. A person can choose their own phone app instead (the Dialer setting). SubSync
// builds no telephony. Before any dial the person is told if the contact asked not to be contacted, or if it is outside calling hours where the account is.

let current: DialerProvider | null = null;
let asked = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** The person's dialer choice, loaded once and shared by every button on the screen. */
export function useDialer() {
  const api = useApiClient();
  const provider = useSyncExternalStore(subscribe, () => current, () => null);
  useEffect(() => {
    if (current !== null || asked) return;
    asked = true;
    api.get<{ provider: DialerProvider }>("people/dialer").then((r) => { current = r.provider; emit(); }).catch(() => { current = "crm"; emit(); });
  }, [api]);
  const set = async (next: DialerProvider) => {
    const before = current;
    current = next; emit();
    try { await api.put("people/dialer", { provider: next }); } catch { current = before; emit(); throw new Error("Could not save the dialer choice. Try again."); }
  };
  return { provider: provider ?? "crm", set };
}

export function DialButton({ phone, contactUrl, dnd, timeZone, compact }: { phone: string | null | undefined; contactUrl: string | null | undefined; dnd?: boolean; timeZone?: string | null; compact?: boolean }) {
  const { provider } = useDialer();
  const [open, setOpen] = useState(false);
  const plan = dialPlan(provider, { phone, contactUrl });
  if (!plan.href) return <span className="text-xs text-muted-foreground">{plan.note}</span>;
  const href = plan.href;
  const warnings = open ? dialWarnings({ dnd: dnd === true, phone, timeZone: timeZone ?? null, now: new Date() }) : [];
  const go = () => { window.open(href, plan.provider === "phone" ? "_self" : "_blank", "noopener,noreferrer"); setOpen(false); };
  const press = () => {
    const w = dialWarnings({ dnd: dnd === true, phone, timeZone: timeZone ?? null, now: new Date() });
    if (w.length === 0) go(); else setOpen(true);
  };
  return (
    <span className="inline-flex min-w-0 flex-col items-start gap-1">
      <button type="button" onClick={press} className="min-h-9 text-left text-sm font-medium text-primary underline underline-offset-2" data-testid="dial-button">{plan.label}</button>
      {!compact && !open && <span className="max-w-xs text-xs text-muted-foreground" data-testid="dial-note">{plan.note}</span>}
      {open && (
        <span className="block max-w-sm border-l-2 border-warning py-1 pl-3 text-sm" role="alertdialog" aria-label="Before you call" data-testid="dial-warning">
          {warnings.map((w) => <span key={w.id} className={`block ${w.level === "stop" ? "font-semibold" : ""}`}>{w.text}</span>)}
          <span className="mt-2 flex gap-3">
            <button type="button" onClick={() => setOpen(false)} className="min-h-9 font-medium underline" autoFocus>Do not call</button>
            <button type="button" onClick={go} className="min-h-9 text-muted-foreground underline" data-testid="dial-anyway">{mustStop(warnings) ? "Call anyway" : "Call now"}</button>
          </span>
        </span>
      )}
    </span>
  );
}

/** The Dialer setting: the CRM's own dialer (the default) or the person's own phone app. */
export function DialerSetting() {
  const { provider, set } = useDialer();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="text-sm">
      <label htmlFor="dialer-setting" className="mr-2 font-medium">Dialer</label>
      <select id="dialer-setting" value={provider} onChange={(e) => { setMsg(null); set(e.target.value === "phone" ? "phone" : "crm").catch((err: Error) => setMsg(err.message)); }}
        className="rounded-lg border bg-background px-2 py-1.5 text-sm">
        <option value="crm">My CRM&apos;s dialer</option>
        <option value="phone">My own phone app</option>
      </select>
      {msg && <span className="ml-2 text-xs text-destructive" role="alert">{msg}</span>}
    </div>
  );
}
