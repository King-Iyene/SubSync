"use client";

import { useState } from "react";
import { BULK_CAP, TURN_ON_MEANS } from "@/lib/ghl/send-guard";
import { useApiClient, useData } from "../../session";
import { INPUT, wbButtons } from "./runner";

// Two small panels for sending (flag send_messages): "Sending rules" (pause, quiet hours, limits, opt-out line, link list and the account's own templates) and "Send to selected".
// The server decides everything; these only show its answers in plain words. SubSync sends a message only when a person presses Send, never on its own.

type Settings = { paused: boolean; quietStartHour: number; quietEndHour: number; perPersonHour: number; perPersonDay: number; accountDay: number; dupMinutes: number; footerEnabled: boolean; footerText: string; linkAllowlist: string[]; allowAgencySend: boolean };
type Tpl = { id: string; name: string; channel: "SMS" | "Email"; subject: string | null; body: string };
/** The per-account switch for sending, with what it means shown first and the account name typed to turn it on (turning it off needs no typing). Owners and administrators only; the server checks it again and writes the audit line. */
export function TurnOnSending({ locationId, name, optedIn, masterOn, onChanged }: { locationId: string; name: string; optedIn: boolean; masterOn: boolean; onChanged: () => void }) {
  const api = useApiClient();
  const [asking, setAsking] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const post = async (enabled: boolean) => { setBusy(true); setErr(null); try { await api.post("workbench/send-optin", { locationId, enabled, ...(enabled ? { confirmName: typed } : {}) }); setAsking(false); setTyped(""); onChanged(); } catch (e) { setErr((e as Error).message || "That did not save. Try again."); } setBusy(false); };
  const nameOk = typed.trim().toLowerCase() === name.trim().toLowerCase();
  return (
    <div className="rounded-lg border p-3" data-testid="turn-on-sending" data-on={optedIn ? "1" : "0"}>
      {optedIn ? (
        <>
          <p className="font-medium">Sending is turned on for {name}.</p>
          {!masterOn && <p className="text-muted-foreground">SubSync&apos;s own live switch is still off, so a send is only recorded as a preview for now.</p>}
          <button type="button" className={`${wbButtons.BTN} mt-2`} disabled={busy} onClick={() => void post(false)} data-testid="turn-off-sending">Turn off sending for this account</button>
        </>
      ) : (
        <>
          <p className="font-medium">Sending is turned off for {name}.</p>
          <p className="text-muted-foreground">Until you turn it on, pressing Send only records a preview and nothing is sent.</p>
          {!asking && <button type="button" className={`${wbButtons.PRIMARY} mt-2`} onClick={() => setAsking(true)} data-testid="turn-on-sending-open">Turn on sending for this account</button>}
          {asking && (
            <div className="mt-2 space-y-2" role="group" aria-label={`Turn on sending for ${name}`} data-testid="turn-on-sending-confirm">
              <p className="font-medium">Turning this on means:</p>
              <ul className="list-disc space-y-1 pl-5">{TURN_ON_MEANS.map((m) => <li key={m}>{m}</li>)}{!masterOn && <li>SubSync&apos;s own live switch is still off, so nothing is really sent until that is on too.</li>}</ul>
              <label className="block"><span className="text-muted-foreground">Type <b className="text-foreground">{name}</b> to turn it on.</span><input className={INPUT} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" aria-label="Type the account name" data-testid="turn-on-sending-typed" /></label>
              <div className="flex flex-wrap gap-2"><button type="button" className={wbButtons.PRIMARY} disabled={busy || !nameOk} onClick={() => void post(true)} data-testid="turn-on-sending-go">Turn on sending</button><button type="button" className={wbButtons.BTN} onClick={() => { setAsking(false); setTyped(""); setErr(null); }}>Cancel</button></div>
            </div>
          )}
        </>
      )}
      {err && <p className="mt-2 text-destructive" role="alert">{err}</p>}
    </div>
  );
}

const num = (v: string, d: number) => (Number.isFinite(Number(v)) && v !== "" ? Number(v) : d);

export function SendRules({ locationId, onChanged, startOpen = false }: { locationId: string; /** Called after the account switch changed, so the message box above can re-read its state. */ onChanged?: () => void; startOpen?: boolean }) {
  const api = useApiClient();
  const s = useData<{ settings: Settings; canEdit: boolean; killed: boolean; optedIn: boolean; masterOn: boolean; accountName: string }>(`workbench/send-settings?locationId=${encodeURIComponent(locationId)}`);
  const t = useData<{ templates: Tpl[]; canEdit: boolean }>(`workbench/send-templates?locationId=${encodeURIComponent(locationId)}`);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [tpl, setTpl] = useState<{ name: string; channel: "SMS" | "Email"; subject: string; body: string }>({ name: "", channel: "SMS", subject: "", body: "" });
  const [del, setDel] = useState<{ id: string; name: string; typed: string } | null>(null);
  if (!s.data?.canEdit) return null;
  const v = draft ?? s.data.settings;
  const set = (p: Partial<Settings>) => setDraft({ ...v, ...p });
  const save = async () => { setMsg(null); try { await api.post("workbench/send-settings", { locationId, settings: { ...v, linkAllowlist: v.linkAllowlist.join(",") } }); setMsg("Saved."); setDraft(null); void s.reload(); } catch { setMsg("That did not save. Try again."); } };
  const addTpl = async () => { setMsg(null); try { await api.post("workbench/send-templates", { locationId, ...tpl }); setTpl({ name: "", channel: "SMS", subject: "", body: "" }); void t.reload(); setMsg("Template saved."); } catch (e) { setMsg((e as Error).message || "That template was not accepted. Use plain text."); } };
  const rmTpl = async () => { if (!del) return; try { await api.post("workbench/send-templates", { locationId, delete: true, id: del.id, confirmName: del.typed }); setDel(null); void t.reload(); } catch { setMsg(`Type the name "${del.name}" exactly to delete it.`); } };
  return (
    <details open={startOpen || undefined} className="mt-3 rounded-xl border bg-card p-3 text-sm" data-testid="send-rules">
      <summary className="cursor-pointer font-medium">Sending rules for this account</summary>
      <div className="mt-3 space-y-3">
        <TurnOnSending locationId={locationId} name={s.data.accountName} optedIn={s.data.optedIn} masterOn={s.data.masterOn} onChanged={() => { void s.reload(); onChanged?.(); }} />
        {s.data.killed && <p className="text-destructive" role="alert">Sending is paused for everyone by SubSync right now.</p>}
        <label className="flex min-h-10 items-center gap-2"><input type="checkbox" checked={v.paused} onChange={(e) => set({ paused: e.target.checked })} />Pause sending for this account</label>
        <div className="flex flex-wrap items-center gap-2">Quiet hours for texts, in the lead&apos;s time: from <input type="number" min={0} max={23} className={`${INPUT} !w-20`} value={v.quietStartHour} onChange={(e) => set({ quietStartHour: num(e.target.value, 21) })} aria-label="Quiet hours start" /> to <input type="number" min={0} max={23} className={`${INPUT} !w-20`} value={v.quietEndHour} onChange={(e) => set({ quietEndHour: num(e.target.value, 8) })} aria-label="Quiet hours end" /> o&apos;clock</div>
        <div className="flex flex-wrap items-center gap-2">Limits: <input type="number" min={1} max={20} className={`${INPUT} !w-20`} value={v.perPersonHour} onChange={(e) => set({ perPersonHour: num(e.target.value, 2) })} aria-label="Per person per hour" /> an hour and <input type="number" min={1} max={50} className={`${INPUT} !w-20`} value={v.perPersonDay} onChange={(e) => set({ perPersonDay: num(e.target.value, 5) })} aria-label="Per person per day" /> a day for one person, <input type="number" min={1} max={5000} className={`${INPUT} !w-24`} value={v.accountDay} onChange={(e) => set({ accountDay: num(e.target.value, 200) })} aria-label="Per account per day" /> a day for the account</div>
        <label className="flex min-h-10 items-center gap-2"><input type="checkbox" checked={v.footerEnabled} onChange={(e) => set({ footerEnabled: e.target.checked })} />Add an opt-out line to texts</label>
        {v.footerEnabled && <input className={INPUT} value={v.footerText} maxLength={160} onChange={(e) => set({ footerText: e.target.value })} aria-label="Opt-out line" />}
        <label className="block"><span className="text-muted-foreground">Only allow links to these websites (comma separated, empty means any):</span><input className={INPUT} value={v.linkAllowlist.join(", ")} onChange={(e) => set({ linkAllowlist: e.target.value.split(/[\s,]+/).filter(Boolean) })} aria-label="Allowed links" /></label>
        <label className="flex min-h-10 items-center gap-2"><input type="checkbox" checked={v.allowAgencySend} onChange={(e) => set({ allowAgencySend: e.target.checked })} />Let the company that manages this account send from here</label>
        <button type="button" className={wbButtons.PRIMARY} onClick={() => void save()} data-testid="send-rules-save">Save rules</button>
        <div className="border-t pt-3">
          <p className="font-medium">Your quick templates</p>
          <p className="text-muted-foreground">Plain text. Use {"{first_name}"}, {"{my_name}"} and {"{business}"}.</p>
          <ul className="mt-2 space-y-1">{(t.data?.templates ?? []).map((x) => <li key={x.id} className="flex items-center justify-between gap-2"><span>{x.name} ({x.channel === "SMS" ? "text" : "email"})</span><button type="button" className="text-destructive underline" onClick={() => setDel({ id: x.id, name: x.name, typed: "" })}>Delete</button></li>)}</ul>
          {del && <div className="mt-2"><label>Type <b>{del.name}</b> to delete it<input className={INPUT} value={del.typed} onChange={(e) => setDel({ ...del, typed: e.target.value })} /></label><button type="button" className={`${wbButtons.DANGER} mt-2`} onClick={() => void rmTpl()}>Delete template</button></div>}
          <div className="mt-2 grid gap-2">
            <input className={INPUT} placeholder="Template name" value={tpl.name} maxLength={60} onChange={(e) => setTpl({ ...tpl, name: e.target.value })} aria-label="Template name" />
            <select className={INPUT} value={tpl.channel} onChange={(e) => setTpl({ ...tpl, channel: e.target.value as "SMS" | "Email" })} aria-label="Template channel"><option value="SMS">Text</option><option value="Email">Email</option></select>
            {tpl.channel === "Email" && <input className={INPUT} placeholder="Subject" value={tpl.subject} onChange={(e) => setTpl({ ...tpl, subject: e.target.value })} aria-label="Template subject" />}
            <textarea className={INPUT} rows={3} placeholder="Hi {first_name}, ..." value={tpl.body} onChange={(e) => setTpl({ ...tpl, body: e.target.value })} aria-label="Template text" />
            <button type="button" className={wbButtons.BTN} onClick={() => void addTpl()}>Save template</button>
          </div>
        </div>
        {msg && <p role="status">{msg}</p>}
      </div>
    </details>
  );
}

type BulkPreview = { willSend: number; skipped: number; confirmWord: string; cap: number; rows: Array<{ contactId: string; name: string; status: string; reason: string | null }> };
type Person = { contactId: string | null; locationId: string; name: string; dnd: boolean; locationName?: string };

/** "Send to selected": a clearly separate panel, one client account at a time, up to the cap, one typed confirmation. Messages cannot be taken back. */
export function BulkSendPanel({ rows }: { rows: readonly Person[] }) {
  const api = useApiClient();
  const [open, setOpen] = useState(false);
  const [account, setAccount] = useState<string>("");
  const [picked, setPicked] = useState<string[]>([]);
  const [channel, setChannel] = useState<"SMS" | "Email">("SMS");
  const [text, setText] = useState("");
  const [subject, setSubject] = useState("");
  const [pv, setPv] = useState<BulkPreview | null>(null);
  const [typed, setTyped] = useState("");
  const [out, setOut] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const people = rows.filter((r) => r.contactId && !r.dnd);
  const accounts = [...new Map(people.map((r) => [r.locationId, r.locationName ?? "This account"])).entries()];
  if (!people.length) return null;
  const acct = account || accounts[0]?.[0] || "";
  const here = people.filter((r) => r.locationId === acct);
  const body = (extra: object) => ({ locationId: acct, contactIds: picked, channel, text, ...(channel === "Email" ? { subject } : {}), ...extra });
  const review = async () => { setBusy(true); setOut(null); try { setPv(await api.post<BulkPreview>("workbench/send-bulk-preview", body({}))); } catch (e) { setOut((e as Error).message || "That could not be checked."); } setBusy(false); };
  const send = async () => {
    if (!pv) return; setBusy(true);
    try { const r = await api.post<{ sent: number; dryRun: number; rows: Array<{ status: string }> }>("workbench/send-bulk", body({ confirm: true, confirmText: typed })); setOut(r.dryRun ? `Nothing was sent: sending is switched off (${r.dryRun} would have gone).` : `Sent to ${r.sent}. ${r.rows.length - r.sent} not sent (see the reasons in your CRM audit).`); setPv(null); setTyped(""); setPicked([]); } catch (e) { setOut((e as Error).message || "Nothing was sent."); }
    setBusy(false);
  };
  return (
    <section className="mt-3 rounded-xl border bg-card p-3 text-sm" data-testid="bulk-send">
      <button type="button" className={wbButtons.BTN} onClick={() => setOpen(!open)} aria-expanded={open}>Send to selected</button>
      {open && (
        <div className="mt-3 space-y-2">
          <p className="text-muted-foreground">One client account at a time, up to {BULK_CAP} people. Each person is checked on their own; anyone who asked not to be contacted is skipped. Messages cannot be taken back.</p>
          {accounts.length > 1 && <select className={INPUT} value={acct} onChange={(e) => { setAccount(e.target.value); setPicked([]); setPv(null); }} aria-label="Client account">{accounts.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>}
          <ul className="max-h-40 overflow-y-auto">{here.slice(0, 50).map((r) => <li key={r.contactId}><label className="flex min-h-9 items-center gap-2"><input type="checkbox" checked={picked.includes(r.contactId as string)} disabled={!picked.includes(r.contactId as string) && picked.length >= BULK_CAP} onChange={(e) => { setPv(null); setPicked(e.target.checked ? [...picked, r.contactId as string] : picked.filter((x) => x !== r.contactId)); }} />{r.name}</label></li>)}</ul>
          <select className={INPUT} value={channel} onChange={(e) => { setChannel(e.target.value as "SMS" | "Email"); setPv(null); }} aria-label="How to send"><option value="SMS">Text</option><option value="Email">Email</option></select>
          {channel === "Email" && <input className={INPUT} placeholder="Subject" value={subject} onChange={(e) => { setSubject(e.target.value); setPv(null); }} aria-label="Subject" />}
          <textarea className={INPUT} rows={3} placeholder="Hi {first_name}, ..." value={text} onChange={(e) => { setText(e.target.value); setPv(null); }} aria-label="Message for everyone selected" />
          <button type="button" className={wbButtons.BTN} disabled={busy || !picked.length || !text.trim()} onClick={() => void review()}>Review</button>
          {pv && (
            <div data-testid="bulk-review">
              <p><b>{pv.willSend}</b> will get this. {pv.skipped ? `${pv.skipped} will be skipped.` : ""}</p>
              <ul className="mt-1 space-y-0.5">{pv.rows.filter((r) => r.status === "blocked").map((r) => <li key={r.contactId} className="text-destructive">{r.name}: {r.reason}</li>)}</ul>
              {pv.willSend > 0 && <label className="mt-2 block">Type <b>{pv.confirmWord}</b> to send<input className={INPUT} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" /></label>}
              <button type="button" className={`${wbButtons.PRIMARY} mt-2`} disabled={busy || typed.trim().toUpperCase() !== pv.confirmWord} onClick={() => void send()}>Send now</button>
            </div>
          )}
          {out && <p role="status">{out}</p>}
        </div>
      )}
    </section>
  );
}
