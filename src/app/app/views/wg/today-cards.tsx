"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SECTIONS, SECTION_LABEL, type Brief, type Section } from "@/lib/analytics/br-core";
import type { WgSummary } from "@/lib/analytics/wg-types";
import { usd } from "@/lib/analytics/wg-core";
import { ApiError, useApiClient, useData } from "../../session";
import { SkeletonRows } from "../../ds";
import type { GoFn, ViewId } from "../../nav";
import "../speed6.css";
import "../cl3/cl3.css";
import "./wg.css";
import { sampleBrief, sampleSummary, wgfxOn } from "./data";

// Two cards on the front page, both for the agency's owners and admins and both read only:
//   BriefCard   the 7 am brief: the five things that need attention today across the modules, each with one line of why and a button to the exact list, one dollar line (an estimate), a copyable
//               text and chat version, and the person's own choices (email, time, time zone, quiet days, sections, a test, the record of past briefs).
//   WalletCard  the client accounts whose credit is empty, low or jumping, lowest days left first.
// Nothing here messages a lead or changes the CRM. Sample data appears ONLY with ?wgfx and says so.

const num = (n: number) => n.toLocaleString("en-US");
const failText = (e: unknown) => (e instanceof ApiError ? e.message : "That did not work. Please try again.");
const notOn = (e: unknown) => /not switched on/i.test(String((e as { message?: string } | null)?.message ?? e ?? ""));
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Opens the exact list a hash address names, inside the app. */
export function openHash(hash: string, go: GoFn, openRecover?: (loc: string) => void): void {
  const [v, qs] = hash.replace(/^#/, "").split("?"), p = new URLSearchParams(qs ?? "");
  if (v === "today" && p.get("tab") === "recover" && openRecover) return openRecover(p.get("account") ?? "");
  if (v === "clients" && p.get("tab") === "wallet") { try { sessionStorage.setItem("clients.tab", "wallet"); } catch { /* the tab opens on its first page instead */ } }
  go(v as ViewId, p.get("account") ?? undefined);
}

async function copy(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through to the older way, for frames that refuse the clipboard */ }
  try {
    const t = document.createElement("textarea");
    t.value = text; t.setAttribute("readonly", ""); t.style.position = "fixed"; t.style.opacity = "0";
    document.body.appendChild(t); t.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(t);
    return ok;
  } catch { return false; }
}

// ------------------------------------------------------------------ the wallet card

export function WalletCard({ go }: { go: GoFn }) {
  const sample = wgfxOn();
  const live = useData<WgSummary>(sample ? null : "wg?part=summary");
  const s = sample ? sampleSummary() : live.data;
  if (!s || !s.counts || s.accounts === 0) return null;
  const need = s.counts.empty + s.counts.low, jump = s.counts.spike;
  if (need + jump === 0) return null;
  const open = () => openHash("#clients?tab=wallet", go);
  return (
    <section className="br-card" aria-label="Credit balances" data-testid="wg-card">
      <h2 className="cl-h">Credit balances</h2>
      {sample && <p className="ap-fine" role="status">Sample data: these are not your real clients.</p>}
      <p className="cl-sentence" data-testid="wg-card-headline">{s.headline}</p>
      <ul className="cl-steps" aria-label="Accounts to top up">
        {s.top.map((r) => <li key={r.locationId}><b>{r.name}</b><span>{r.balance !== null && r.balance <= 0 ? "Empty" : r.balance !== null ? usd(r.balance) : ""} {r.daysLeft !== null && r.balance !== null && r.balance > 0 ? `(about ${r.daysLeft < 1 ? "under a day" : `${Math.round(r.daysLeft)} days`} left, estimate)` : ""}</span></li>)}
      </ul>
      <div className="br-tools"><button type="button" className="s6-btn" data-kind="primary" onClick={open} data-testid="wg-card-open">Open the watchlist ({num(need + (need === 0 ? jump : 0))})</button></div>
    </section>
  );
}

// ------------------------------------------------------------------ the brief

type BriefResp = { brief: Brief | null; labels: Record<Section, string>; sections: Section[] };
type PrefsResp = { prefs: { email: string | null; emailOn: boolean; hour: number; timezone: string; quietDays: number[]; sections: Section[]; defaultTimezone: string }; emailAvailable: boolean; sendingNote: string };
type HistRow = { id: string; day: string; channel: "email" | "app" | "test"; mode: "sent" | "dry_run" | "shown"; itemCount: number; dollars: number | null; opened: boolean; acted: boolean; actedTitle: string | null; at: string };

const zones = (): string[] => { try { return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone"); } catch { return ["UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/London", "Africa/Lagos", "Asia/Dubai", "Asia/Kolkata", "Australia/Sydney"]; } };
const modeWords = (h: HistRow) => (h.channel === "app" ? "Shown in the app" : h.channel === "test" ? (h.mode === "dry_run" ? "Test (rehearsal, nothing sent)" : "Test email") : h.mode === "dry_run" ? "Email (rehearsal, nothing sent)" : "Email sent");

function BriefSettings({ onClose }: { onClose: () => void }) {
  const api = useApiClient(), sample = wgfxOn();
  const r = useData<PrefsResp>(sample ? null : "br?part=settings");
  const h = useData<{ rows: HistRow[] }>(sample ? null : "br?part=history");
  type Form = { email: string; on: boolean; hour: number; tz: string; quiet: number[]; secs: Section[] };
  const [edit, setEdit] = useState<Partial<Form>>({});
  const [msg, setMsg] = useState<string | null>(null), [busy, setBusy] = useState(false), [preview, setPreview] = useState<{ dryRun: boolean; to: string; subject: string; text: string } | null>(null);
  const [tzs] = useState(zones);
  const p = r.data?.prefs;
  const stored: Form | null = sample ? { email: "you@example.com", on: false, hour: 7, tz: "UTC", quiet: [], secs: [...SECTIONS] } : p ? { email: p.email ?? "", on: p.emailOn, hour: p.hour, tz: p.timezone, quiet: p.quietDays, secs: p.sections } : null;
  const form = stored ? { ...stored, ...edit } : null;
  const body = () => form && ({ email: form.email, emailOn: form.on, hour: form.hour, timezone: form.tz, quietDays: form.quiet, sections: form.secs });
  const run = async (fn: () => Promise<void>) => {
    if (sample) { setMsg("This is sample data, so nothing is saved."); return; }
    setBusy(true); setMsg(null);
    try { await fn(); } catch (e) { setMsg(failText(e)); } finally { setBusy(false); }
  };
  if (!sample && r.loading && !r.data) return <SkeletonRows rows={3} label="Loading your choices..." />;
  if (!form) return null;
  const set = (c: Partial<Form>) => { if (!sample) setEdit((e) => ({ ...e, ...c })); };
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return (
    <section className="cl-drill" aria-label="Brief settings" data-testid="br-settings">
      <div className="mb-2 flex flex-wrap items-center gap-3"><h3 className="text-base font-semibold">Your brief</h3><button type="button" className="ap-link ml-auto" onClick={onClose}>Close</button></div>
      <form className="br-form" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api.post("br/act/settings", body()); setMsg("Saved."); r.reload(); }); }}>
        {r.data?.emailAvailable !== false && (
          <>
            <label><input type="checkbox" checked={form.on} onChange={(e) => set({ on: e.target.checked })} /> Email me the brief</label>
            <label>Your email address <input className="ap-field" type="email" autoComplete="email" value={form.email} onChange={(e) => set({ email: e.target.value })} data-testid="br-email" /></label>
            <label>Send it at <select className="ap-field" value={form.hour} onChange={(e) => set({ hour: Number(e.target.value) })} aria-label="Hour">{Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{`${String(i).padStart(2, "0")}:00`}</option>)}</select>
              <select className="ap-field" value={form.tz} onChange={(e) => set({ tz: e.target.value })} aria-label="Time zone">{(tzs.includes(form.tz) ? tzs : [form.tz, ...tzs]).map((z) => <option key={z} value={z}>{z}</option>)}</select></label>
            <fieldset className="br-days"><legend className="ap-fine">No email on</legend>{DAYS.map((d, i) => <label key={d}><input type="checkbox" checked={form.quiet.includes(i)} onChange={() => set({ quiet: toggle(form.quiet, i) })} /> {d.slice(0, 3)}</label>)}</fieldset>
          </>)}
        <fieldset className="br-days"><legend className="ap-fine">What the brief covers</legend>{SECTIONS.map((s) => <label key={s}><input type="checkbox" checked={form.secs.includes(s)} onChange={() => set({ secs: toggle(form.secs, s) })} /> {SECTION_LABEL[s]}</label>)}</fieldset>
        <div className="br-tools">
          <button type="submit" className="s6-btn" data-kind="primary" disabled={busy || form.secs.length === 0}>Save</button>
          {r.data?.emailAvailable !== false && <button type="button" className="s6-btn" disabled={busy} data-testid="br-test" onClick={() => void run(async () => { await api.post("br/act/settings", body()); const t = await api.post<{ dryRun: boolean; to: string; subject: string; text: string }>("br/act/test", {}); setPreview(t); setMsg(null); h.reload(); })}>Send me a test</button>}
          {msg && <span className="ap-fine" role="status">{msg}</span>}
        </div>
        <p className="ap-fine">{r.data?.sendingNote ?? "Sample data."} One brief a day. The email itself changes nothing and goes only to you. Stop it any time with the link at the bottom of the email.</p>
      </form>
      {preview && (
        <div data-testid="br-preview"><p className="ap-fine" role="status">{preview.dryRun ? `Rehearsal: nothing was sent. This is exactly what would go to ${preview.to}.` : `A test was sent to ${preview.to}.`}</p><p className="ap-fine"><b>{preview.subject}</b></p><pre className="br-pre">{preview.text}</pre></div>)}
      <h4 className="cl-h mt-3">What happened with past briefs</h4>
      {sample ? <p className="ap-fine">Sample data has no history.</p> : !h.data ? null : h.data.rows.length === 0 ? <p className="ap-fine">Nothing yet. Each brief shown or sent is recorded here, with whether you opened it and acted on it.</p> : (
        <ul className="cl-steps" data-testid="br-history">{h.data.rows.map((x) => <li key={x.id}><b>{x.day}</b><span>{modeWords(x)}: {num(x.itemCount)} {x.itemCount === 1 ? "thing" : "things"}{x.channel === "test" ? "" : x.opened ? ", opened" : ", not opened"}{x.acted ? `, acted on${x.actedTitle ? `: ${x.actedTitle}` : ""}` : ""}</span></li>)}</ul>)}
    </section>
  );
}

export function BriefCard({ go, openRecover, hide }: { go: GoFn; openRecover?: (loc: string) => void; hide?: (key: string) => boolean }) {
  const api = useApiClient(), sample = wgfxOn();
  const live = useData<BriefResp>(sample ? null : "br?part=brief");
  const [settings, setSettings] = useState(false), [toast, setToast] = useState<string | null>(null), [how, setHow] = useState(false);
  const b0 = sample ? sampleBrief() : live.data?.brief ?? null;
  const b = useMemo(() => (b0 && hide ? { ...b0, items: b0.items.filter((i) => !hide(i.key)) } : b0), [b0, hide]);
  const seen = useRef(false);
  // AI wording: shown only when the account connected its own AI, the job is on and the number check passed (the server decides; any failure here just means no block).
  const [aiNote, setAiNote] = useState<string | null>(null);
  const hasBrief = Boolean(b0);
  useEffect(() => {
    if (sample || !hasBrief) return;
    let dead = false;
    void (async () => {
      try {
        const g = await api.get<{ note: string | null }>("ai?part=brief-note");
        if (dead) return;
        if (g.note) { setAiNote(g.note); return; }
        const p = await api.post<{ note: string | null }>("ai/act/brief-note", {});
        if (!dead && p.note) setAiNote(p.note);
      } catch { /* no AI block */ }
    })();
    return () => { dead = true; };
  }, [api, sample, hasBrief]);
  // The brief was shown today: recorded once per person per day (the server also keeps it to one row).
  useEffect(() => {
    if (sample || !b || seen.current) return;
    seen.current = true;
    void api.post("br/act/seen", {}).catch(() => undefined);
  }, [api, b, sample]);
  if (!sample && live.error && notOn(live.error)) return null;
  if (!sample && live.loading && !live.data) return <section className="br-card" aria-label="Your 7 am brief"><SkeletonRows rows={3} label="Putting your brief together..." /></section>;
  if (!b) return null;
  const go1 = (key: string, hash: string) => { if (!sample) void api.post("br/act/acted", { key }).catch(() => undefined); openHash(hash, go, openRecover); };
  const copyAs = async (kind: "text" | "slack") => {
    if (sample) { setToast("This is sample data, so there is nothing to copy."); return; }
    try {
      const t = await api.get<{ text: string; slack: string }>("br?part=text");
      setToast((await copy(kind === "text" ? t.text : t.slack)) ? (kind === "text" ? "Copied the brief as text." : "Copied for Slack.") : "Your browser would not copy. Select the text in the test email instead.");
    } catch (e) { setToast(failText(e)); }
  };
  return (
    <section className="br-card" aria-label="Your 7 am brief" data-testid="br-card">
      <h2 className="cl-h">Your brief for {b.dayText ?? b.day}</h2>
      {sample && <p className="ap-fine" role="status" data-testid="br-sample">Sample data: these are not your real clients.</p>}
      <p className="cl-sentence" data-testid="br-headline">{b.headline}</p>
      {aiNote && <p className="ap-fine" data-testid="br-ai"><b>AI wording (a suggestion):</b> {aiNote}</p>}
      <ol className="br-list">
        {b.items.map((it, n) => (
          <li key={it.key} className="br-item" data-testid={`br-item-${it.section}`}>
            <span className="td-rank" aria-hidden>{n + 1}</span>
            <div><b>{it.title}</b><p className="ap-fine">{it.why}{it.dollars !== null && it.dollars > 0 ? ` About $${Math.round(it.dollars).toLocaleString("en-US")} (estimate).` : ""}</p></div>
            <div className="br-go"><button type="button" className="s6-btn" data-kind="primary" onClick={() => go1(it.key, it.hash)}>Open the list</button></div>
          </li>
        ))}
      </ol>
      {b.more > 0 && <p className="ap-fine">And {num(b.more)} more in the lists on Today and in Clients.</p>}
      <p className="ap-fine" data-testid="br-dollar">{b.dollar.text} <button type="button" className="ap-link" aria-expanded={how} onClick={() => setHow(!how)}>How is this worked out?</button></p>
      {how && <p className="ap-fine">{b.formula}</p>}
      <div className="br-tools">
        <button type="button" className="ap-link" onClick={() => void copyAs("text")} data-testid="br-copy-text">Copy as text</button>
        <button type="button" className="ap-link" onClick={() => void copyAs("slack")} data-testid="br-copy-slack">Copy for Slack</button>
        <button type="button" className="ap-link" aria-expanded={settings} onClick={() => setSettings(!settings)} data-testid="br-settings-open">Brief settings</button>
        {toast && <span className="ap-fine" role="status">{toast}</span>}
      </div>
      {settings && <BriefSettings onClose={() => setSettings(false)} />}
    </section>
  );
}

/** The brief's tools, kept under Today > Settings now that the brief card is no longer drawn on the Today page: Copy as text, Copy for Slack and the brief settings (email, time, sections, test, history). The daily brief email job is unchanged. */
export function BriefTools() {
  const api = useApiClient(), sample = wgfxOn();
  const live = useData<BriefResp>(sample ? null : "br?part=brief");
  const [settings, setSettings] = useState(false), [toast, setToast] = useState<string | null>(null);
  if (!sample && live.error && notOn(live.error)) return null;
  const copyAs = async (kind: "text" | "slack") => {
    if (sample) { setToast("This is sample data, so there is nothing to copy."); return; }
    try {
      const t = await api.get<{ text: string; slack: string }>("br?part=text");
      setToast((await copy(kind === "text" ? t.text : t.slack)) ? (kind === "text" ? "Copied the brief as text." : "Copied for Slack.") : "Your browser would not copy. Select the text in the test email instead.");
    } catch (e) { setToast(failText(e)); }
  };
  return (
    <section aria-label="Your 7 am brief" data-testid="br-tools-settings">
      <h2 className="cl-h mb-2">Your 7 am brief</h2>
      <p className="ap-fine mb-2">{live.data?.brief ? `${live.data.brief.dayText ?? live.data.brief.day}: ${live.data.brief.headline}` : "One short brief a day. Copy it, or choose when it is emailed."}</p>
      <div className="br-tools">
        <button type="button" className="s6-btn" onClick={() => void copyAs("text")} data-testid="br-copy-text">Copy as text</button>
        <button type="button" className="s6-btn" onClick={() => void copyAs("slack")} data-testid="br-copy-slack">Copy for Slack</button>
        <button type="button" className="s6-btn" aria-expanded={settings} onClick={() => setSettings(!settings)} data-testid="br-settings-open">Brief settings</button>
        {toast && <span className="ap-fine" role="status">{toast}</span>}
      </div>
      {settings && <BriefSettings onClose={() => setSettings(false)} />}
    </section>
  );
}
