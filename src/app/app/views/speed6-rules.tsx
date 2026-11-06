"use client";

import { Bell, Copy, Minus, Plus, Send } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { destination, LINES, type DigestSettings } from "@/lib/analytics/speed-digest";
import { useApiClient, useData } from "../session";
import { ErrorState, LeadDrawer, SkeletonRows, type LeadSeed } from "../ds";
import { SidePopup } from "./speed-popup";
import { Band, Fold, Q } from "./speed6-base";
import type { GoFn } from "../nav";
import "./speed6.css";

// Rules, made simple (stage SPEED6): a stepper for the reply target, a toggle for escalation, the digest as a card with a message preview, and the leads waiting right now as cards. Nothing here
// sends anything: "Send test" is a dry run while sending is switched off in Settings.

const stepOf = (n: number, dir: 1 | -1) => { const s = n < 10 ? 1 : n < 60 ? 5 : 15; return Math.min(1440, Math.max(1, n + dir * s)); };

export function TargetCard({ targetMinutes, canChange }: { targetMinutes: number; canChange: boolean }) {
  const api = useApiClient();
  const [v, setV] = useState(targetMinutes);
  const [saved, setSaved] = useState(targetMinutes);
  const [msg, setMsg] = useState<string | null>(null);
  const save = async () => { setMsg(null); try { await api.put("settings", { speedTargetMinutes: v }); setSaved(v); setMsg("Saved."); } catch (e) { setMsg((e as Error).message || "Could not save."); } };
  return (
    <Q sticky q="How fast must we reply?" testId="target-card" glow="active" sub="A new lead should hear from a person within this many minutes." tip="This is the default for every client account. An account can have its own target in Settings. Automatic messages do not stop the clock.">
      <div className="flex flex-wrap items-center gap-4">
        <div className="s6-stepper" role="group" aria-label="Reply target in minutes">
          <button type="button" aria-label="Fewer minutes" disabled={!canChange} onClick={() => setV(stepOf(v, -1))} data-testid="target-minus"><Minus aria-hidden className="mx-auto size-5" /></button>
          <output aria-live="polite" data-testid="target-value">{v} min</output>
          <button type="button" aria-label="More minutes" disabled={!canChange} onClick={() => setV(stepOf(v, 1))} data-testid="target-plus"><Plus aria-hidden className="mx-auto size-5" /></button>
        </div>
        {canChange && v !== saved && <button type="button" className="s6-btn" data-kind="primary" onClick={() => void save()} data-testid="target-save">Save</button>}
        {msg && <span role="status" className="s6-label">{msg}</span>}
        {!canChange && <span className="s6-label">Ask the person who manages your account to change it.</span>}
      </div>
    </Q>
  );
}

type Ladder = { enabled: boolean; nextAfterMin: number; managerAfterMin: number };
type Waiting = { locationId: string; contactId: string; name: string; account: string; waitedMin: number; targetMin: number; step: number; stepWords: string; owner: string | null; nextPerson: string | null; toNext: number | null; url?: string };
type Preview = { ladderReady: boolean; ladder: Ladder; leads: Waiting[] };

export function EscalationCard({ canChange, d, reload }: { canChange: boolean; d: Preview; reload: () => void }) {
  const api = useApiClient();
  const [edit, setEdit] = useState<Partial<Ladder>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const f: Ladder = { ...d.ladder, ...edit };
  const dirty = Object.keys(edit).length > 0;
  const save = async () => { setMsg(null); try { await api.put("speed/ladder", f); setMsg("Saved."); setEdit({}); reload(); } catch (e) { setMsg((e as Error).message || "Could not save."); } };
  const num = (k: "nextAfterMin" | "managerAfterMin", label: string, id: string) => (
    <label className="grid gap-1 text-sm"><span className="s6-label">{label}</span>
      <span className="flex items-center gap-2"><input type="number" min={1} max={1440} className="s6-num" value={f[k]} disabled={!canChange || !f.enabled} aria-label={label} data-testid={id} onChange={(e) => setEdit({ ...edit, [k]: Number(e.target.value) })} /><span className="s6-label">min</span></span></label>
  );
  return (
    <Q sticky q="Who gets told when nobody replies?" testId="ladder-card" tip="Past the account's reply target, the owner is told. If it is still waiting, the next person in line is told, then a manager. The waiting time skips closed hours when business hours are on.">
      <div className="mb-4 flex items-center gap-3">
        <button type="button" role="switch" aria-checked={f.enabled} aria-label="Escalate to the next person and a manager" className="s6-toggle" disabled={!canChange} onClick={() => setEdit({ ...edit, enabled: !f.enabled })} data-testid="ladder-enabled" />
        <span className="font-medium">{f.enabled ? "Escalation is on" : "Escalation is off"}</span>
      </div>
      <div className="flex flex-wrap gap-6">{num("nextAfterMin", "Next person after", "ladder-next")}{num("managerAfterMin", "Manager after", "ladder-manager")}</div>
      <p className="s6-label mt-2">Minutes after the reply target is missed.</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {canChange && <button type="button" className="s6-btn" data-kind={dirty ? "primary" : undefined} disabled={!dirty} onClick={() => void save()} data-testid="ladder-save">Save</button>}
        {msg && <span role="status" className="s6-label">{msg}</span>}
        {!d.ladderReady && <span className="s6-label" data-testid="ladder-notready">Saving needs the latest database update. The standard 15 and 45 minutes apply until then.</span>}
      </div>
    </Q>
  );
}

/** "Leads waiting now": each lead past its target as a card; the badge says how far up the ladder it is. A click opens the shared lead panel, never a small popup. */
export function WaitingNowCard({ leads, multi }: { leads: Waiting[]; multi: boolean }) {
  const [open, setOpen] = useState<{ i: number; reply: boolean } | null>(null);
  const seeds: LeadSeed[] = useMemo(() => leads.map((l) => ({ contactId: l.contactId, locationId: l.locationId, name: l.name, locationName: l.account, url: l.url, owner: l.owner, unassigned: !l.owner, note: `Waiting ${l.waitedMin} minutes, target ${l.targetMin}. ${l.stepWords}.` })), [leads]);
  const shown = leads.slice(0, 9);
  return (
    <Q sticky q="Which leads are waiting now?" testId="waiting-now" glow={shown.length ? "urgent" : undefined} tip="Leads past their account's reply target, newest worry first. The step badge says whether the owner, the next person or a manager has been told.">
      {shown.length === 0 ? <p className="s6-label" data-testid="ladder-empty">No lead is past its target right now.</p> : (
        <div className="s6-wait" data-testid="ladder-leads">
          {shown.map((l, i) => (
            <article key={`${l.locationId}:${l.contactId}`} className="rounded-xl border border-[rgba(36,54,89,0.9)] bg-[rgba(13,23,48,0.7)] p-4" data-testid="ladder-lead">
              <div className="flex items-start justify-between gap-2"><button type="button" className="s6-link min-w-0 font-semibold" onClick={() => setOpen({ i, reply: false })} data-testid="ladder-lead-open"><span className="block truncate">{l.name}</span>{multi && <span className="s6-label block truncate">{l.account}</span>}</button>
                <span className="s6-step s6-pulse" data-step={l.step} title={l.stepWords}><Bell aria-hidden className="size-3" />Step {l.step} of 3</span></div>
              <p className="s6-big mt-3 !text-[1.75rem]" data-tone={l.step >= 2 ? "red" : "amber"}>{l.waitedMin} <span className="text-sm font-medium">min</span></p>
              <p className="s6-label mt-1">Told: {l.step >= 3 ? "a manager" : l.step === 2 ? (l.nextPerson ?? "the next person") : (l.owner ?? "nobody owns it")}</p>
              <button type="button" className="s6-btn mt-3 w-full" data-kind="primary" onClick={() => setOpen({ i, reply: true })} data-testid="ladder-reply" aria-label={`Reply to ${l.name}`}>Reply</button>
            </article>
          ))}
        </div>
      )}
      {open && <LeadDrawer leads={seeds.map((s, k) => (open.reply && k === open.i ? { ...s, reply: true } : s))} index={open.i} onIndex={(n) => setOpen(n === null ? null : { i: n, reply: false })} onClose={() => setOpen(null)} showAccount={multi} />}
    </Q>
  );
}

type DigestGet = { ready: boolean; settings: DigestSettings; live: { email: boolean; slack: boolean } };
const DAYNAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const zones = (): string[] => { try { return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone"); } catch { return ["UTC"]; } };
const FIELD = "s6-num !w-full !text-left px-2";

/** The summary message, end to end: who gets it, by email and/or Slack, when (in which time zone), what it says, per account. Preview shows the exact message; Send test is a dry run until sending is switched on. */
export function DigestCard({ accounts }: { accounts: Array<{ id: string; name: string }> }) {
  const api = useApiClient();
  const [acct, setAcct] = useState("");
  const { data, error, reload } = useData<DigestGet>(`speed/digest${acct ? `?account=${encodeURIComponent(acct)}` : ""}`);
  const [edit, setEdit] = useState<DigestSettings | null>(null);
  const [mail, setMail] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [show, setShow] = useState<{ subject: string; text: string } | null>(null);
  const tzList = useMemo(() => zones(), []);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <SkeletonRows rows={3} label="Loading the summary..." />;
  const s = edit ?? data.settings;
  const set = (p: Partial<DigestSettings>) => setEdit({ ...s, ...p });
  const setSch = (p: Partial<DigestSettings["schedule"]>) => set({ schedule: { ...s.schedule, ...p } });
  const emails = mail ?? s.recipients.join(", ");
  const withMail = (): DigestSettings => ({ ...s, recipients: emails.split(/[\s,;]+/).filter(Boolean) });
  const where = destination(withMail(), data.live);
  const body = (cur: DigestSettings) => ({ locationId: acct || undefined, settings: cur });
  const save = async () => { setMsg(null); try { await api.put("speed/digest", body(withMail())); setEdit(null); setMail(null); setMsg("Saved."); reload(); } catch (e) { setMsg((e as Error).message || "Could not save."); } };
  const preview = async () => { setMsg(null); try { setShow(await api.post("speed/digest/preview", body(withMail()))); } catch (e) { setMsg((e as Error).message); } };
  const test = async () => {
    setMsg("Working...");
    try {
      const r = await api.post<{ wouldSend: string[]; sent: string[] }>("speed/digest/test", body(withMail()));
      setMsg(r.sent.length ? `Test sent by ${r.sent.join(" and ")}.` : r.wouldSend.length ? `Dry run: WOULD SEND by ${r.wouldSend.join(" and ")}. Nothing was sent because sending is off.` : "Nothing to send: add an address or choose Slack.");
    } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <Q sticky q="What is in my summary message?" testId="digest-card" span sub="A short message about first replies, sent on a schedule." tip="Choose who gets it, by email or Slack, when, and which lines it has. The preview is the exact message, built from the same numbers as this page. Nothing is sent until sending is switched on in Settings.">
      {accounts.length > 1 && (
        <label className="mb-4 grid max-w-sm gap-1 text-sm"><span className="s6-label">For</span>
          <select className={FIELD} value={acct} onChange={(e) => { setAcct(e.target.value); setEdit(null); setMail(null); setMsg(null); }} aria-label="Which account" data-testid="digest-account"><option value="">All accounts (the default)</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      )}
      <div className="grid gap-5 md:grid-cols-2">
        <div className="grid gap-4">
          <div className="flex items-center gap-3"><button type="button" role="switch" aria-checked={s.enabled} aria-label="Send this summary" className="s6-toggle" onClick={() => set({ enabled: !s.enabled })} data-testid="digest-enabled" /><span className="font-medium">{s.enabled ? "On" : "Off"}</span></div>
          <div className="flex flex-wrap gap-4 text-sm" role="group" aria-label="Where it goes">
            <label className="flex min-h-10 items-center gap-2"><input type="checkbox" checked={s.email} onChange={(e) => set({ email: e.target.checked })} data-testid="digest-email" />Email</label>
            <label className="flex min-h-10 items-center gap-2"><input type="checkbox" checked={s.slack} onChange={(e) => set({ slack: e.target.checked })} data-testid="digest-slack" />Slack channel</label>
          </div>
          <label className="grid gap-1 text-sm"><span className="s6-label">Email addresses (you, your team, or the client&apos;s contact)</span><textarea rows={2} className={FIELD} value={emails} onChange={(e) => setMail(e.target.value)} placeholder="ben@example.com, client@example.com" data-testid="digest-recipients" /></label>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <label className="grid gap-1"><span className="s6-label">How often</span><select className={FIELD} value={s.schedule.cadence} onChange={(e) => setSch({ cadence: e.target.value === "weekly" ? "weekly" : "daily" })} data-testid="digest-cadence"><option value="daily">Every day</option><option value="weekly">Every week</option></select></label>
            {s.schedule.cadence === "weekly" && <label className="grid gap-1"><span className="s6-label">On</span><select className={FIELD} value={s.schedule.weekday} onChange={(e) => setSch({ weekday: Number(e.target.value) })}>{DAYNAMES.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></label>}
            <label className="grid gap-1"><span className="s6-label">At</span><select className={FIELD} value={s.schedule.hour} onChange={(e) => setSch({ hour: Number(e.target.value) })} data-testid="digest-hour">{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{h}:00</option>)}</select></label>
            <label className="grid gap-1"><span className="s6-label">Time zone</span><select className={FIELD} value={s.schedule.tz} onChange={(e) => setSch({ tz: e.target.value })} data-testid="digest-tz">{[...new Set(["UTC", s.schedule.tz, ...tzList])].map((z) => <option key={z} value={z}>{z}</option>)}</select></label>
          </div>
        </div>
        <div className="grid gap-4">
          <fieldset className="grid gap-1 text-sm"><legend className="s6-label mb-1">Lines to include</legend>
            {LINES.map((l) => <label key={l.key} className="flex min-h-9 items-center gap-2"><input type="checkbox" checked={s.lines.includes(l.key)} onChange={(e) => set({ lines: LINES.map((x) => x.key).filter((k) => (k === l.key ? e.target.checked : s.lines.includes(k))) })} data-testid={`digest-line-${l.key}`} />{l.label}</label>)}
          </fieldset>
          <label className="grid gap-1 text-sm"><span className="s6-label">Opening line</span><textarea rows={2} maxLength={500} className={FIELD} value={s.intro} onChange={(e) => set({ intro: e.target.value })} data-testid="digest-intro" /></label>
          <label className="grid gap-1 text-sm"><span className="s6-label">Sign-off</span><textarea rows={2} maxLength={500} className={FIELD} value={s.outro} onChange={(e) => set({ outro: e.target.value })} data-testid="digest-outro" /></label>
        </div>
      </div>
      <p className="mt-5 text-sm" data-testid="digest-where">{where}</p>
      {!data.ready && <p className="s6-label mt-1" data-testid="digest-notready">Saving needs the latest database update. Until then this stays on this screen only.</p>}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" className="s6-btn" data-kind="primary" onClick={() => void save()} data-testid="digest-save">Save</button>
        <button type="button" className="s6-btn" onClick={() => void preview()} data-testid="digest-preview-open">Preview message</button>
        <button type="button" className="s6-btn" onClick={() => void test()} data-testid="digest-test"><Send aria-hidden className="size-4" />Send test</button>
        {msg && <span role="status" className="s6-label" data-testid="digest-msg">{msg}</span>}
      </div>
      {show && (
        <SidePopup label="Summary message" onClose={() => setShow(null)}>
          <div data-testid="digest-popup">
            <p className="s6-label">Subject</p><h3 className="text-lg font-semibold" data-testid="digest-subject">{show.subject}</h3>
            <p className="mt-4 whitespace-pre-line text-[0.95rem] leading-7" data-testid="digest-preview">{show.text}</p>
            <button type="button" className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm font-medium" onClick={() => void navigator.clipboard?.writeText(show.text)}><Copy aria-hidden className="size-4" />Copy</button>
          </div>
        </SidePopup>
      )}
    </Q>
  );
}

/** The Rules tab: three cards first, the rest behind More (routing check and the printable response-speed report). */
export function RulesTab6(p: { who: string; waiting: number; dollars: number | null; typical: string | null; canChange: boolean; targetMinutes: number; go: GoFn; multi: boolean; accounts?: Array<{ id: string; name: string }>; rest: ReactNode }) {
  const { data: d, error, reload } = useData<Preview>("speed?part=ladder");
  return (
    <div data-testid="rules-tab">
      <Fold keep={4} testId="rules-fold"><Band title="How we reply" />
        <div className="s6-grid s6-three">
          <TargetCard targetMinutes={p.targetMinutes} canChange={p.canChange} />
          {error ? <ErrorState error={error} onRetry={reload} /> : !d ? <SkeletonRows rows={3} label="Building the preview..." /> : <EscalationCard canChange={p.canChange} d={d} reload={reload} />}
        </div>
        <DigestCard accounts={p.accounts ?? []} />
        {d && <><Band title="Right now" /><WaitingNowCard leads={d.leads} multi={p.multi} /></>}
        {p.rest}
      </Fold>
    </div>
  );
}
