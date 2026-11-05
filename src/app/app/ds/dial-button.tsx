"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { dialPlan, dialWarnings, mustStop, validateTemplate, VENDORS, type DialerChoice } from "@/lib/people/dial";
import { useApiClient } from "../session";

// The Dial button (stage F10, KF-3). By default it opens the CRM's own dialer for the contact through the white-label link; the CRM publishes no link that opens
// its dialer directly, so today it opens the contact in the CRM and says so. A person can choose their own phone app instead (the Dialer setting). SubSync
// builds no telephony. Before any dial the person is told if the contact asked not to be contacted, or if it is outside calling hours where the account is.

let current: DialerChoice | null = null;
let chosen = true; // true until the server says this person has never answered, so nothing asks before it knows
let asking: ((c: DialerChoice) => void) | null = null;

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
    api.get<DialerChoice & { chosen?: boolean }>("people/dialer").then((r) => { chosen = r.chosen !== false; current = { provider: r.provider, vendor: r.vendor, template: r.template }; emit(); }).catch(() => { current = { provider: "crm" }; emit(); });
  }, [api]);
  const set = async (next: DialerChoice) => {
    const before = current;
    try { await api.put("people/dialer", next); current = next; chosen = true; emit(); } catch (e) { current = before; emit(); throw new Error((e as Error).message || "Could not save the dialer choice. Try again."); }
  };
  const c = choice ?? { provider: "crm" as const };
  /** Runs `go` with the person's choice. The first time ever, asks "How do you make calls?" first (see DialerAskHost) and continues with the answer. */
  const withChoice = (go: (c: DialerChoice) => void) => { if (!chosen && choice && asking === null) { asking = go; emit(); } else go(c); };
  return { provider: c.provider, choice: c, set, withChoice };
}

export function DialButton({ phone, contactUrl, dnd, timeZone, compact }: { phone: string | null | undefined; contactUrl: string | null | undefined; dnd?: boolean; timeZone?: string | null; compact?: boolean }) {
  const { choice, withChoice } = useDialer();
  const [open, setOpen] = useState(false);
  const plan = dialPlan(choice, { phone, contactUrl });
  if (!plan.href) return <span className="text-xs text-muted-foreground">{plan.note}</span>;
  const href = plan.href;
  const warnings = open ? dialWarnings({ dnd: dnd === true, phone, timeZone: timeZone ?? null, now: new Date() }) : [];
  const go = () => { window.open(href, plan.provider === "phone" ? "_self" : "_blank", "noopener,noreferrer"); setOpen(false); announceCall(); };
  const press = () => withChoice((c) => {
    const p = dialPlan(c, { phone, contactUrl });
    const w = dialWarnings({ dnd: dnd === true, phone, timeZone: timeZone ?? null, now: new Date() });
    if (!p.href) return;
    if (w.length === 0) { window.open(p.href, p.provider === "phone" ? "_self" : "_blank", "noopener,noreferrer"); announceCall(); } else setOpen(true);
  });
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

/** The one-time question, shown the first time a person presses any Call button. A native modal dialog: Escape and Tab stay inside it. Skipping saves the CRM's dialer and never asks again. */
export function DialerAskHost() {
  const { set } = useDialer();
  useSyncExternalStore(subscribe, () => asking, () => null);
  const ref = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState<"ask" | "link">("ask");
  const [vendor, setVendor] = useState("Other");
  const [template, setTemplate] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const go = asking;
  useEffect(() => { const d = ref.current; if (go && d && !d.open) { setStep("ask"); setErr(null); d.showModal(); } if (!go && d?.open) d.close(); }, [go]);
  if (!go) return null;
  const done = async (c: DialerChoice) => {
    try { await set(c); } catch (e) { setErr((e as Error).message); return; }
    const next = asking; asking = null; emit(); ref.current?.close(); next?.(c);
  };
  const bad = template.trim() ? validateTemplate(template) : null;
  const OPT = "block w-full cursor-pointer rounded-md border bg-card p-3 text-left hover:bg-accent focus-visible:outline-2";
  return (
    <dialog ref={ref} aria-labelledby="dialer-ask-title" onCancel={(e) => { e.preventDefault(); void done({ provider: "crm" }); }} className="m-auto w-[min(92vw,26rem)] rounded-lg border bg-popover p-4 text-popover-foreground backdrop:bg-black/40" data-testid="dialer-ask">
      <h2 id="dialer-ask-title" className="text-base font-semibold">How do you make calls?</h2>
      {step === "ask" ? (
        <div className="mt-3 space-y-2">
          <button type="button" autoFocus onClick={() => void done({ provider: "phone" })} className={OPT} data-testid="dialer-ask-phone"><span className="block text-sm font-medium">Button or extension on my screen (Kixie, Aloware...)</span><span className="block text-xs text-muted-foreground">Uses this computer or phone: Call opens the dialer already set up on this device.</span></button>
          <button type="button" onClick={() => void done({ provider: "crm" })} className={OPT} data-testid="dialer-ask-crm"><span className="block text-sm font-medium">My CRM&apos;s dialer</span><span className="block text-xs text-muted-foreground">Call opens the contact in your CRM, where you call.</span></button>
          <button type="button" onClick={() => setStep("link")} className={OPT} data-testid="dialer-ask-connected"><span className="block text-sm font-medium">A connected dialer link</span><span className="block text-xs text-muted-foreground">I will paste a link.</span></button>
          <p className="flex items-center justify-between text-xs text-muted-foreground">Change anytime in Settings.
            <button type="button" onClick={() => void done({ provider: "crm" })} className="min-h-9 cursor-pointer underline" data-testid="dialer-ask-skip">Skip</button></p>
        </div>
      ) : (
        <div className="mt-3 space-y-2 text-sm">
          <label className="block text-xs font-medium">Which dialer
            <select value={vendor} onChange={(e) => setVendor(e.target.value)} className="ml-2 cursor-pointer rounded-lg border bg-background px-2 py-1 text-sm">{VENDORS.map((v) => <option key={v} value={v}>{v}</option>)}</select></label>
          <label className="block text-xs font-medium">Link your dialer gave you
            <input autoFocus value={template} onChange={(e) => setTemplate(e.target.value)} placeholder="Paste the link here, with {phone} where the number goes" className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm" data-testid="dialer-ask-template" /></label>
          <p className="text-xs text-muted-foreground">It must start with https:// and contain {"{phone}"}. It only opens in a new tab when you press Call.</p>
          {bad && !bad.ok && <p className="text-xs text-destructive" role="alert">{bad.error}</p>}
          {err && <p className="text-xs text-destructive" role="alert">{err}</p>}
          <p className="flex gap-3">
            <button type="button" disabled={!template.trim() || (bad !== null && !bad.ok)} onClick={() => void done({ provider: "connected", vendor, template: template.trim() })} className="min-h-9 cursor-pointer rounded-md border bg-card px-3 font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50" data-testid="dialer-ask-save">Save and call</button>
            <button type="button" onClick={() => setStep("ask")} className="min-h-9 cursor-pointer underline">Back</button>
          </p>
        </div>
      )}
      {err && step === "ask" && <p className="mt-2 text-xs text-destructive" role="alert">{err}</p>}
    </dialog>
  );
}
