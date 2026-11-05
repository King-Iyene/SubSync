"use client";

import { Copy, ExternalLink, PhoneCall, X } from "lucide-react";
import { useState } from "react";
import { ActionStrip, type ActionPerson, type ContactActions } from "../contact-actions";
import { useDialer } from "../dial-button";
import { useApiClient } from "../../session";
import { wbButtons, type Runner } from "./runner";
import type { CallOutcome } from "@/lib/ghl/workbench";

// Calling, honestly. The CRM's API has no endpoint that places a call or opens its dialer (docs/features/MOAT.md), so SubSync does not pretend to. It shows the number big, lets the person
// copy it, opens the CRM's own dialer as a clearly labelled fallback, and records how the call went: in SubSync's own list (so the person leaves the call lists) AND as a note in the CRM
// through the write gateway (a dry run until changes are switched on). No telephony is built, and tel: is only used when the person chose their own phone app in the Dialer setting.

const OUTCOMES: Array<{ k: CallOutcome; own: string; label: string }> = [
  { k: "no_answer", own: "no_answer", label: "No answer" }, { k: "spoke", own: "answered", label: "Spoke with them" },
  { k: "booked", own: "booked", label: "Booked" }, { k: "wrong_number", own: "wrong_number", label: "Wrong number" },
];

export function CallSheet({ phone, name, dnd, locationId, contactId, runner, actions, ap, onClose, onLogged }: {
  phone: string; name: string; dnd: boolean; locationId: string; contactId: string; runner: Runner; actions: ContactActions; ap: ActionPerson; onClose: () => void; onLogged: (label: string) => void;
}) {
  const api = useApiClient();
  const { provider } = useDialer();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const copy = async () => { try { await navigator.clipboard.writeText(phone); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { window.prompt("Copy this number", phone); } };
  const log = async (o: (typeof OUTCOMES)[number]) => {
    setBusy(true);
    try { await api.post("people/outcome", { locationId, contactId, outcome: o.own }); } catch { /* the CRM note below still records it */ }
    runner.now({ kind: "call_note", outcome: o.k });
    setBusy(false); setDone(o.label);
  };
  return (
    <section className="mt-4 rounded-2xl border bg-card p-4" aria-label={`Call ${name}`} data-testid="wb-call">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-muted-foreground">Call {name}</p>
        <button type="button" aria-label="Close the call panel" onClick={onClose} className="-mr-1 -mt-1 inline-flex size-10 items-center justify-center rounded-lg hover:bg-muted"><X aria-hidden className="size-5" /></button>
      </div>
      {dnd ? <p className="mt-1 text-[17px] font-semibold text-destructive" data-testid="wb-call-dnd">Asked not to be contacted. Do not call this person.</p> : (
        <>
          <p className="mt-1 break-all text-3xl font-semibold tabular-nums tracking-tight" data-testid="wb-call-number">{phone}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => void copy()} className={wbButtons.PRIMARY} data-testid="wb-call-copy"><Copy aria-hidden className="size-4" />{copied ? "Copied" : "Copy number"}</button>
            <button type="button" onClick={() => actions.call(ap)} className={wbButtons.BTN} data-testid="wb-call-crm"><PhoneCall aria-hidden className="size-4" />{provider === "phone" ? "Call with your phone app" : "Call in your CRM"}{provider === "phone" ? null : <ExternalLink aria-hidden className="size-3.5" />}</button>
          </div>
          <ActionStrip actions={actions} k="panel" className="mt-2" />
          <p className="mt-2 text-sm text-muted-foreground">Your CRM does not let other apps start a call, so dial from your phone or open your CRM&apos;s dialer. SubSync never places a call itself.</p>
          <p className="mt-4 text-sm font-medium">How did it go?</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {OUTCOMES.map((o) => <button key={o.k} type="button" disabled={busy || runner.busy} onClick={() => void log(o)} className={wbButtons.BTN} data-testid={`wb-out-${o.k}`}>{o.label}</button>)}
          </div>
          {done && <p className="mt-3 flex flex-wrap items-center gap-3 text-[15px] font-medium" role="status" data-testid="wb-call-logged">Logged: {done}.<button type="button" onClick={() => onLogged(done)} className={wbButtons.PRIMARY} data-testid="wb-call-next">Next lead</button></p>}
          <p className="mt-2 text-xs text-muted-foreground">Tapping one records the call in SubSync, takes this person off the call lists for 12 hours and adds a short note to their record in your CRM.</p>
        </>
      )}
    </section>
  );
}
