"use client";

import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { dialPlan, dialWarnings, mustStop, validateTemplate, VENDORS, type DialerChoice } from "@/lib/people/dial";
import { useApiClient } from "../session";

// The Dial button (stage F10, KF-3). By default it opens the CRM's own dialer for the contact through the white-label link; the CRM publishes no link that opens
// its dialer directly, so today it opens the contact in the CRM and says so. A person can choose their own phone app instead (the Dialer setting). SubSync
// builds no telephony. Before any dial the person is told if the contact asked not to be contacted, or if it is outside calling hours where the account is.

let current: DialerChoice | null = null;

/** Tells the open lead panel that a call was just started, so "Log how the call went" opens and the result can be written to the CRM. */
export const CALL_STARTED = "subsync:call-started";
export const announceCall = () => { if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(CALL_STARTED)); };
let asked = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** The person's dialer choice, loaded once and shared by every button on the screen. */
export function useDialer() {
  const api = useApiClient();
  const choice = useSyncExternalStore(subscribe, () => current, () => null);
  useEffect(() => {
    if (current !== null || asked) return;
    asked = true;
    api.get<DialerChoice>("people/dialer").then((r) => { current = r; emit(); }).catch(() => { current = { provider: "crm" }; emit(); });
  }, [api]);
  const set = async (next: DialerChoice) => {
    const before = current;
    try { await api.put("people/dialer", next); current = next; emit(); } catch (e) { current = before; emit(); throw new Error((e as Error).message || "Could not save the dialer choice. Try again."); }
  };
  const c = choice ?? { provider: "crm" as const };
  return { provider: c.provider, choice: c, set };
}

export function DialButton({ phone, contactUrl, dnd, timeZone, compact }: { phone: string | null | undefined; contactUrl: string | null | undefined; dnd?: boolean; timeZone?: string | null; compact?: boolean }) {
  const { choice } = useDialer();
  const [open, setOpen] = useState(false);
  const plan = dialPlan(choice, { phone, contactUrl });
  if (!plan.href) return <span className="text-xs text-muted-foreground">{plan.note}</span>;
  const href = plan.href;
  const warnings = open ? dialWarnings({ dnd: dnd === true, phone, timeZone: timeZone ?? null, now: new Date() }) : [];
  const go = () => { window.open(href, plan.provider === "phone" ? "_self" : "_blank", "noopener,noreferrer"); setOpen(false); announceCall(); };
  const press = () => {
    const w = dialWarnings({ dnd: dnd === true, phone, timeZone: timeZone ?? null, now: new Date() });
    if (w.length === 0) go(); else setOpen(true);
  };
  return (
    <span className="inline-flex min-w-0 flex-col items-start gap-1">
      <button type="button" onClick={press} className="min-h-9 cursor-pointer text-left text-sm font-medium text-primary underline underline-offset-2" data-testid="dial-button">{plan.label}</button>
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

/** The Dialer setting: how Call works for this person, everywhere in the app. One of three ways; the CRM's own dialer is the default. */
export function DialerSetting() {
  const { choice, set } = useDialer();
  const selectId = useId(); // unique: the setting can be on the page and in the lead panel at once
  const [msg, setMsg] = useState<string | null>(null);
  const [vendor, setVendor] = useState<string>(choice.vendor ?? "Other");
  const [template, setTemplate] = useState(choice.template ?? "");
  const [editing, setEditing] = useState(false);
  const save = (c: DialerChoice) => { setMsg(null); return set(c).then(() => true).catch((err: Error) => { setMsg(err.message); return false; }); };
  const pick = (v: string) => {
    if (v === "connected") { setEditing(true); return; }
    setEditing(false);
    void save({ provider: v === "phone" ? "phone" : "crm" });
  };
  const connected = editing || choice.provider === "connected";
  const bad = template.trim() ? validateTemplate(template) : null;
  return (
    <div className="text-sm" data-testid="dialer-setting">
      <label htmlFor={selectId} className="mr-2 font-medium">Call with</label>
      <select id={selectId} value={connected ? "connected" : choice.provider} onChange={(e) => pick(e.target.value)} className="cursor-pointer rounded-lg border bg-background px-2 py-1.5 text-sm" data-testid="dialer-select">
        <option value="crm">My CRM&apos;s dialer</option>
        <option value="phone">This computer or phone</option>
        <option value="connected">A connected dialer</option>
      </select>
      {connected && (
        <div className="mt-2 max-w-md space-y-1.5" data-testid="dialer-connected">
          <label className="block text-xs font-medium">Which dialer
            <select value={vendor} onChange={(e) => setVendor(e.target.value)} className="ml-2 cursor-pointer rounded-lg border bg-background px-2 py-1 text-sm" data-testid="dialer-vendor">{VENDORS.map((v) => <option key={v} value={v}>{v}</option>)}</select>
          </label>
          <label className="block text-xs font-medium">Link your dialer gave you
            <input value={template} onChange={(e) => setTemplate(e.target.value)} placeholder="Paste the link here, with {phone} where the number goes" className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm" data-testid="dialer-template" />
          </label>
          <p className="text-xs text-muted-foreground">SubSync has not confirmed the link format of any of these dialers from their public help pages, so paste the link your dialer gives you and put {"{phone}"} where the number goes (you can also use {"{email}"}). It must start with https://. Nothing is downloaded or sent: the link only opens in a new tab when you press Call. SubSync keeps only this choice and the link.</p>
          {bad && !bad.ok && <p className="text-xs text-destructive" role="alert" data-testid="dialer-template-error">{bad.error}</p>}
          <button type="button" disabled={!template.trim() || (bad !== null && !bad.ok)} onClick={() => void save({ provider: "connected", vendor, template: template.trim() }).then((ok) => { if (ok) setEditing(false); })} className="min-h-9 cursor-pointer rounded-md border bg-card px-3 text-sm font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50" data-testid="dialer-save">Save</button>
        </div>
      )}
      {msg && <span className="ml-2 text-xs text-destructive" role="alert">{msg}</span>}
    </div>
  );
}
