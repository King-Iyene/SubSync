"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  defaultSections, monthLabel, periodChoices, reportText, samplePayload, STATUS_LABEL, type PrPayload, type PrRow, type PrSettings, type PrStatus, type Sections,
} from "@/lib/analytics/proof-core";
import { useApiClient, useData } from "../../session";
import { EmptyState, SkeletonRows } from "../../ds";
import { notSwitchedOn } from "../cl3/data";
import { Pager } from "../cl3/shared";
import { ProofReport } from "./report";
import { printReport } from "./actions";

// Clients, Proof: for every client account, ONE branded report page the company sends to that client (a secret link, no sign-in) and a printable monthly report. The company reviews each draft and
// shares it itself; SubSync never sends anything to a client. Real data only: sample rows appear ONLY with ?prfx in the address and say "Sample data". Every count opens exactly its rows.
type Options = { flags: Record<string, boolean>; periods: Array<{ month: string; label: string }>; defaultPeriod: string; settings: PrSettings; sections: Array<{ key: keyof Sections; label: string }>; general: { name: string | null; color: string | null; logoUrl: string | null } };
type ListData = { rows: PrRow[]; total: number; all: number; counts: Record<PrStatus, number>; autoDrafts: number; page: number; pages: number; month: string; label: string };
type ReportData = {
  report: { payload: PrPayload; intro: string | null; sections: Sections; nameStaff: boolean; status: "draft" | "shared"; builtAt: string; sharedAt: string | null; auto: boolean } | null;
  month: string; label: string; brand: { name: string | null; logoUrl: string | null; color: string | null };
  link: { exists: boolean; revoked: boolean; views: number; lastViewedAt: string | null; url: string | null }; text: string | null;
};

export const prfxOn = () => { try { if (typeof window === "undefined") return false; if (/[?&]prfx\b/.test(window.location.search + window.location.hash)) { sessionStorage.setItem("pr.fx", "1"); return true; } return sessionStorage.getItem("pr.fx") === "1"; } catch { return false; } };
const TONE: Record<PrStatus, string | undefined> = { none: "grey", draft: "amber", shared: "cyan", viewed: "green" };
const ago = (iso: string | null) => { if (!iso) return "Never"; const h = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 3_600_000)); return h < 1 ? "Just now" : h < 48 ? `${h} h ago` : `${Math.round(h / 24)} d ago`; };
const msg = (e: unknown) => (e instanceof Error && e.message ? e.message : "That did not work. Nothing was changed.");
const copyText = async (t: string) => { try { await navigator.clipboard.writeText(t); return true; } catch { return false; } };

function sampleOptions(): Options {
  const periods = periodChoices(new Date()).map((m) => ({ month: m, label: monthLabel(m) }));
  return { flags: { pr_report: true, pr_page: true, pr_auto: true }, periods, defaultPeriod: periods[0].month, settings: { displayName: "Sample Marketing Co", logoUrl: null, brandColor: "#504c45", intro: "Here is how your leads were handled this month.", sections: defaultSections(), nameStaff: false, autoDraft: true }, sections: [], general: { name: null, color: null, logoUrl: null } };
}
const SAMPLE_ROWS: PrRow[] = [
  ["sample1", "Sample Roofing Co", "viewed", 142], ["sample2", "Sample Dental", "shared", 88], ["sample3", "Sample Realty", "draft", 61], ["sample4", "Sample Solar", "draft", 40], ["sample5", "Sample Med Spa", "none", null], ["sample6", "Sample Coaching", "none", null],
].map(([id, name, status, leads]) => ({ locationId: id as string, name: name as string, status: status as PrStatus, linkOff: false, builtAt: status === "none" ? null : new Date().toISOString(), sharedAt: status === "shared" || status === "viewed" ? new Date().toISOString() : null, auto: status === "draft", views: status === "viewed" ? 7 : 0, lastViewedAt: status === "viewed" ? new Date().toISOString() : null, hasLink: status === "shared" || status === "viewed", leads: leads as number | null }));

export function ProofTab({ flags }: { flags: Record<string, boolean> }) {
  const sample = prfxOn(), api = useApiClient();
  const opt = useData<Options>(sample ? null : "proof?part=options");
  const options = sample ? sampleOptions() : opt.data;
  const [period, setPeriod] = useState<string | null>(null), [status, setStatus] = useState<PrStatus | "">(""), [q, setQ] = useState(""), [dq, setDq] = useState(""), [page, setPage] = useState(0);
  const [rev, setRev] = useState(0), [open, setOpen] = useState<PrRow | null>(null), [settingsOpen, setSettingsOpen] = useState(false), [note, setNote] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const month = period ?? options?.defaultPeriod ?? null;
  useEffect(() => { const t = setTimeout(() => { setDq(q); setPage(0); }, 300); return () => clearTimeout(t); }, [q]);
  const key = month ? `proof?part=list&period=${month}&status=${status}&q=${encodeURIComponent(dq)}&page=${page}&size=20&v=${rev}` : null;
  const live = useData<ListData>(sample ? null : key);
  const list: ListData | null = useMemo(() => {
    if (!sample) return live.data;
    const rows = SAMPLE_ROWS.filter((r) => (!status || r.status === status) && (!dq || r.name.toLowerCase().includes(dq.toLowerCase())));
    const counts = { none: 0, draft: 0, shared: 0, viewed: 0 } as Record<PrStatus, number>;
    for (const r of SAMPLE_ROWS) counts[r.status]++;
    return { rows, total: rows.length, all: SAMPLE_ROWS.length, counts, autoDrafts: counts.draft, page: 0, pages: 1, month: month ?? "", label: month ? monthLabel(month) : "" };
  }, [sample, live.data, status, dq, month]);
  const canPage = flags.pr_page === true;

  if (!sample && opt.error && notSwitchedOn(opt.error)) return <EmptyState title="Not switched on yet" body="The client report is not switched on for your account yet." />;
  if (!options || !month) return <SkeletonRows rows={4} label="Loading reports..." />;

  const bump = () => setRev((n) => n + 1);
  const prepareAll = async () => {
    if (sample) return setNote("Sample data: nothing is saved.");
    setBusy(true); setNote(null);
    try {
      let done = 0;
      for (let i = 0; i < 30; i++) { const r = await api.post<{ prepared: number; remaining: number }>("proof/prepare-all", { month }); done += r.prepared; if (r.remaining <= 0 || r.prepared === 0) break; }
      setNote(done ? `Prepared ${done} ${done === 1 ? "draft" : "drafts"} for ${monthLabel(month)}. Review each one, then share it.` : `Every client account already has a report for ${monthLabel(month)}.`);
      bump();
    } catch (e) { setNote(msg(e)); } finally { setBusy(false); }
  };
  const prepareOne = async (r: PrRow) => {
    if (sample) return setOpen(r);
    setBusy(true); setNote(null);
    try { await api.post("proof/prepare", { locationId: r.locationId, month }); bump(); setOpen(r); } catch (e) { setNote(msg(e)); } finally { setBusy(false); }
  };

  if (open) return <ReviewPanel key={`${open.locationId}:${month}`} row={open} month={month} options={options} sample={sample} canShare={canPage} onBack={() => { setOpen(null); bump(); }} />;

  const chips: Array<[PrStatus | "", string]> = [["", "All"], ["none", STATUS_LABEL.none], ["draft", STATUS_LABEL.draft], ["shared", STATUS_LABEL.shared], ["viewed", STATUS_LABEL.viewed]];
  return (
    <div className="cl-stack" data-testid="pr-tab">
      {sample && <p className="ap-fine" role="status" data-testid="pr-fx-note">Sample data: these are not your real clients, and nothing here is saved.</p>}
      <section className="cl-today" aria-label="Client reports">
        <h2 className="cl-h">Show every client what you did</h2>
        <p className="cl-sentence" data-testid="pr-sentence">One branded page and a monthly PDF for each client account, from its own records. You review each one and send it yourself: SubSync never contacts your clients.</p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="s6-btn" data-kind="primary" disabled={busy || list === null || list.counts.none === 0} onClick={() => void prepareAll()} data-testid="pr-prepare-all">Prepare all drafts{list ? ` (${list.counts.none})` : ""}</button>
          <button type="button" className="s6-btn" onClick={() => setSettingsOpen((v) => !v)} aria-expanded={settingsOpen} data-testid="pr-settings-btn">Name, logo and colour</button>
        </div>
      </section>
      {settingsOpen && <SettingsPanel options={options} sample={sample} onSaved={bump} onClose={() => setSettingsOpen(false)} />}
      {options.flags.pr_auto && list && list.autoDrafts > 0 && <p className="ap-fine" role="status" data-testid="pr-auto-note">{list.autoDrafts} {list.autoDrafts === 1 ? "draft was" : "drafts were"} prepared for you for {monthLabel(month)}. Open each one, check it, then share it.</p>}
      <div className="ap-head print:hidden" role="search">
        <select className="ap-field" aria-label="Month" value={month} onChange={(e) => { setPeriod(e.target.value); setPage(0); }} data-testid="pr-period">{options.periods.map((p) => <option key={p.month} value={p.month}>{p.label}{p.month === periodChoices(new Date())[1] ? " (so far)" : ""}</option>)}</select>
        <label className="ap-search"><span className="sr-only">Search accounts</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search accounts" data-testid="pr-search" /></label>
      </div>
      <div role="group" aria-label="Filter by status" className="cl3-chips">
        {chips.map(([k, label]) => <button key={k || "all"} type="button" className="cl-reason" aria-pressed={status === k} data-on={status === k ? "1" : undefined} onClick={() => { setStatus(k); setPage(0); }} data-testid={`pr-chip-${k || "all"}`}>{label} ({(k ? list?.counts[k] ?? 0 : list?.all ?? 0).toLocaleString("en-US")})</button>)}
      </div>
      {note && <p className="ap-fine" role="status" data-testid="pr-note">{note}</p>}
      {live.error && !sample ? <EmptyState title="Could not load" body={msg(live.error)} /> : !list ? <SkeletonRows rows={6} label="Loading reports..." /> : list.rows.length === 0 ? (
        <EmptyState title={list.all === 0 ? "No client accounts yet" : "No account matches"} body={list.all === 0 ? "Client accounts appear here after the first sync finishes." : "Try another status or search."} />
      ) : (
        <>
          <p className="ap-fine" data-testid="pr-count">{list.total.toLocaleString("en-US")} {list.total === 1 ? "account" : "accounts"}.</p>
          <div className="ap-scroll"><table className="ap-t" data-testid="pr-table"><thead><tr><th>Account</th><th>Status</th><th>Prepared</th><th>Opened by client</th><th className="text-right">Open</th></tr></thead>
            <tbody>{list.rows.map((r) => (
              <tr key={r.locationId} style={{ cursor: "default" }} data-testid="pr-row">
                <td><span className="ap-name">{r.name}</span>{r.leads !== null && <span className="ap-fine"> {r.leads.toLocaleString("en-US")} new {r.leads === 1 ? "lead" : "leads"}</span>}</td>
                <td><span className="ap-chip" data-tone={TONE[r.status]} data-testid="pr-status">{STATUS_LABEL[r.status]}</span>{r.linkOff && <span className="ap-fine"> Link off</span>}{r.auto && r.status === "draft" && <span className="ap-fine"> Prepared for you</span>}</td>
                <td>{r.builtAt ? ago(r.builtAt) : ""}</td>
                <td>{r.hasLink ? (r.views > 0 ? `${r.views.toLocaleString("en-US")} ${r.views === 1 ? "time" : "times"}, last ${ago(r.lastViewedAt)}` : "Not opened yet") : ""}</td>
                <td className="text-right">{r.status === "none"
                  ? <button type="button" className="ap-link" disabled={busy} onClick={() => void prepareOne(r)} data-testid="pr-prepare">Prepare</button>
                  : <button type="button" className="ap-link" onClick={() => setOpen(r)} data-testid="pr-review">{r.status === "draft" ? "Review and share" : "Open"}</button>}</td>
              </tr>
            ))}</tbody></table></div>
          <Pager page={list.page} pages={list.pages} total={list.total} set={setPage} />
        </>
      )}
      <p className="ap-fine">Opened counts are only how many times the link was opened and when. We never record who opened it. Trend lines use our own record, which starts when SubSync first read each account.</p>
    </div>
  );
}

/** The copy that is printed: drawn once into the page body, hidden on screen, and the only thing shown when printing from here, so the app around it never prints. */
function PrintCopy({ children }: { children: React.ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { const el = document.createElement("div"); el.className = "pr-portal"; document.body.appendChild(el); setHost(el); return () => { el.remove(); }; }, []);
  return host ? createPortal(children, host) : null;
}

function SettingsPanel({ options, sample, onSaved, onClose }: { options: Options; sample: boolean; onSaved: () => void; onClose: () => void }) {
  const api = useApiClient(), s0 = options.settings;
  const [name, setName] = useState(s0.displayName ?? ""), [logo, setLogo] = useState(s0.logoUrl ?? ""), [color, setColor] = useState(s0.brandColor ?? ""), [intro, setIntro] = useState(s0.intro ?? "");
  const [sections, setSections] = useState<Sections>(s0.sections), [staff, setStaff] = useState(s0.nameStaff), [auto, setAuto] = useState(s0.autoDraft), [m, setM] = useState<string | null>(null), [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setErr(null); setM(null);
    if (sample) return setErr("Sample data cannot be changed.");
    try { await api.put("proof/settings", { displayName: name, logoUrl: logo, brandColor: color, intro, sections, nameStaff: staff, autoDraft: auto }); setM("Saved. New drafts use these choices; refresh a draft to apply them to it."); onSaved(); } catch (e) { setErr(msg(e)); }
  };
  return (
    <section className="cl-drill print:hidden" data-testid="pr-settings" aria-label="Name, logo and colour">
      <div className="mb-2 flex flex-wrap items-center gap-3"><h3 className="text-base font-semibold">Name, logo and colour</h3><span className="ap-fine">Only what your clients see on their report. Nothing is changed in your CRM.</span><button type="button" className="ap-link ml-auto" onClick={onClose}>Close</button></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-3">
          <label className="grid gap-1 text-sm font-medium">Name shown to clients<input className="ap-field" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder={options.general.name ?? "Your company name"} data-testid="pr-set-name" /></label>
          <label className="grid gap-1 text-sm font-medium">Logo address<input className="ap-field" inputMode="url" maxLength={500} value={logo} onChange={(e) => setLogo(e.target.value)} placeholder="https://..." data-testid="pr-set-logo" /><span className="ap-fine">A web address that starts with https://. Leave empty to show your name.</span></label>
          <label className="grid gap-1 text-sm font-medium">Brand colour<span className="flex gap-2"><input type="color" aria-label="Pick a colour" value={/^#[0-9a-f]{6}$/i.test(color) ? color : "#504c45"} onChange={(e) => setColor(e.target.value)} style={{ width: 48, height: 40 }} /><input className="ap-field w-32" maxLength={7} value={color} onChange={(e) => setColor(e.target.value)} placeholder="#504c45" data-testid="pr-set-color" /></span></label>
          <label className="grid gap-1 text-sm font-medium">Intro sentence (shown above the figures)<textarea className="ap-field" style={{ padding: 10, minHeight: 80 }} maxLength={400} value={intro} onChange={(e) => setIntro(e.target.value)} data-testid="pr-set-intro" /></label>
        </div>
        <div className="grid content-start gap-2 text-sm">
          <p className="font-medium">Sections to show in new drafts</p>
          {options.sections.map((s) => <label key={s.key} className="flex items-center gap-2"><input type="checkbox" checked={sections[s.key]} onChange={(e) => setSections({ ...sections, [s.key]: e.target.checked })} />{s.label}</label>)}
          <label className="mt-2 flex items-start gap-2"><input type="checkbox" checked={staff} onChange={(e) => setStaff(e.target.checked)} data-testid="pr-set-staff" /><span>Show team members&apos; first names<br /><span className="ap-fine">Off by default: reports show the team as a whole.</span></span></label>
          <label className="flex items-start gap-2"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} data-testid="pr-set-auto" /><span>Prepare a draft for last month at the start of each month<br /><span className="ap-fine">A draft only. Nothing goes to a client until you share it.</span></span></label>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3"><button type="button" className="s6-btn" data-kind="primary" onClick={() => void save()} data-testid="pr-set-save">Save</button><span aria-live="polite" className="text-sm">{err ? <span role="alert">{err}</span> : m}</span></div>
    </section>
  );
}

function ReviewPanel({ row, month, options, sample, canShare, onBack }: { row: PrRow; month: string; options: Options; sample: boolean; canShare: boolean; onBack: () => void }) {
  const api = useApiClient();
  const [rev, setRev] = useState(0);
  const live = useData<ReportData>(sample ? null : `proof?${new URLSearchParams({ part: "report", account: row.locationId, period: month, v: String(rev) })}`);
  const fx: ReportData | null = useMemo(() => {
    if (!sample) return null;
    const p = { ...samplePayload(), account: row.name };
    return { report: { payload: p, intro: options.settings.intro, sections: defaultSections(), nameStaff: false, status: row.status === "draft" || row.status === "none" ? "draft" : "shared", builtAt: new Date().toISOString(), sharedAt: null, auto: false }, month, label: monthLabel(month), brand: { name: options.settings.displayName, logoUrl: null, color: options.settings.brandColor }, link: { exists: row.hasLink, revoked: false, views: row.views, lastViewedAt: row.lastViewedAt, url: row.hasLink ? "https://example.com/proof/sample" : null }, text: null };
  }, [sample, row, month, options.settings]);
  const d = sample ? fx : live.data;
  const [intro, setIntro] = useState<string | null>(null), [sections, setSections] = useState<Sections | null>(null), [note, setNote] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null), [confirmFor, setConfirmFor] = useState<"regenerate" | "revoke" | null>(null), [typed, setTyped] = useState("");
  const bump = () => setRev((n) => n + 1);
  if (!d && live.error) return <div className="cl-stack"><button type="button" className="ap-link" onClick={onBack}>Back to reports</button><EmptyState title="Could not load" body={msg(live.error)} /></div>;
  if (!d) return <SkeletonRows rows={5} label="Loading report..." />;
  const rp = d.report;
  const shared = rp?.status === "shared";
  const introNow = intro ?? rp?.intro ?? options.settings.intro ?? "", secNow = sections ?? rp?.sections ?? defaultSections();
  const link = url ?? d.link.url;
  const run = async (fn: () => Promise<string | void>) => {
    if (sample) return setNote("Sample data: nothing is saved.");
    setBusy(true); setNote(null);
    try { const m = await fn(); if (m) setNote(m); bump(); } catch (e) { setNote(msg(e)); } finally { setBusy(false); }
  };
  const brand = { name: d.brand.name ?? "Monthly report", logoUrl: d.brand.logoUrl, color: d.brand.color };
  const text = rp ? reportText(rp.payload, brand, introNow || null, secNow) : "";
  const nameOk = typed.trim().toLowerCase() === row.name.trim().toLowerCase();
  return (
    <div className="cl-stack" data-testid="pr-review-panel">
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <button type="button" className="ap-link" onClick={onBack} data-testid="pr-back">Back to reports</button>
        <h2 className="cl-h">{row.name}: {monthLabel(month)}</h2>
        <span className="ap-chip" data-tone={shared ? "cyan" : "amber"} data-testid="pr-review-status">{rp ? (shared ? "Shared" : "Draft") : "Not prepared"}</span>
        {sample && <span className="ap-fine" data-testid="pr-sample-note">Sample data</span>}
      </div>
      {!rp ? <EmptyState title="Not prepared yet" body="Prepare this report to see the figures." /> : (
        <>
          <section className="cl-drill print:hidden" aria-label="Edit and share" data-testid="pr-controls">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <label className="grid gap-1 text-sm font-medium">Intro sentence<textarea className="ap-field" style={{ padding: 10, minHeight: 70 }} maxLength={400} disabled={shared} value={introNow} onChange={(e) => setIntro(e.target.value)} data-testid="pr-intro-edit" /></label>
                {shared && <p className="ap-fine">This report is shared. Take it back to a draft to edit it.</p>}
              </div>
              <div className="grid content-start gap-1 text-sm">
                <p className="font-medium">Sections</p>
                {options.sections.map((s) => <label key={s.key} className="flex items-center gap-2"><input type="checkbox" disabled={shared} checked={secNow[s.key]} onChange={(e) => setSections({ ...secNow, [s.key]: e.target.checked })} data-testid={`pr-sec-${s.key}`} />{s.label}</label>)}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {!shared && <button type="button" className="s6-btn" disabled={busy} onClick={() => void run(async () => { await api.put("proof/report", { locationId: row.locationId, month, intro: introNow, sections: secNow }); return "Saved."; })} data-testid="pr-save">Save changes</button>}
              {!shared && <button type="button" className="s6-btn" disabled={busy} onClick={() => void run(async () => { await api.post("proof/prepare", { locationId: row.locationId, month }); setIntro(null); setSections(null); return "Figures refreshed from the latest records."; })} data-testid="pr-refresh">Refresh figures</button>}
              {!shared && canShare && <button type="button" className="s6-btn" data-kind="primary" disabled={busy} onClick={() => void run(async () => { await api.put("proof/report", { locationId: row.locationId, month, intro: introNow, sections: secNow }); const r = await api.post<{ url: string }>("proof/share", { locationId: row.locationId, month }); setUrl(r.url); return "Shared. Copy the link and send it to your client yourself."; })} data-testid="pr-share">Share with client</button>}
              {shared && <button type="button" className="s6-btn" disabled={busy} onClick={() => void run(async () => { await api.post("proof/unshare", { locationId: row.locationId, month }); setUrl(null); return "Taken back to a draft. The link now shows the last report that is still shared, if any."; })} data-testid="pr-unshare">Take back to draft</button>}
              <button type="button" className="s6-btn" onClick={() => void copyText(text).then((ok) => setNote(ok ? "Report text copied." : "Could not copy. Select the text yourself."))} data-testid="pr-copy-text">Copy as text</button>
              <button type="button" className="s6-btn" onClick={printReport} data-testid="pr-print-btn">Download or print (PDF)</button>
            </div>
            {canShare && (shared || link) && (
              <div className="mt-3 grid gap-2" data-testid="pr-link-box">
                <p className="text-sm font-medium">Client link</p>
                {d.link.revoked ? <p className="ap-fine" data-testid="pr-link-off">The link is switched off. Sharing again makes a new link.</p> : link ? (
                  <div className="flex flex-wrap items-center gap-2"><input className="ap-field" readOnly value={link} style={{ minWidth: 0, flex: "1 1 18rem" }} aria-label="Client link" data-testid="pr-link-url" onFocus={(e) => e.currentTarget.select()} />
                    <button type="button" className="s6-btn" onClick={() => void copyText(link).then((ok) => setNote(ok ? "Link copied." : "Could not copy. Select the link yourself."))} data-testid="pr-copy-link">Copy link</button></div>
                ) : <p className="ap-fine">No link yet.</p>}
                <p className="ap-fine" data-testid="pr-views">{d.link.exists ? `Opened ${d.link.views.toLocaleString("en-US")} ${d.link.views === 1 ? "time" : "times"}${d.link.views ? `, last ${ago(d.link.lastViewedAt)}` : ""}. We count opens only, never who opened it.` : "Not opened yet."}</p>
                {d.link.exists && (
                  <div className="flex flex-wrap items-center gap-2">
                    {!d.link.revoked && <button type="button" className="s6-btn" onClick={() => { setConfirmFor("revoke"); setTyped(""); }} data-testid="pr-revoke">Turn link off</button>}
                    <button type="button" className="s6-btn" onClick={() => { setConfirmFor("regenerate"); setTyped(""); }} data-testid="pr-regenerate">Replace link</button>
                  </div>
                )}
                {confirmFor && (
                  <div className="cl-drill" data-testid="pr-confirm">
                    <p className="text-sm">{confirmFor === "revoke" ? "Turn this link off? Anyone who has it will see nothing." : "Replace this link? The old link stops working at once and you will need to send the new one."} Type <b>{row.name}</b> to confirm.</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <input className="ap-field" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Type the client account name" data-testid="pr-confirm-input" />
                      <button type="button" className="s6-btn" data-kind="primary" disabled={!nameOk || busy} data-testid="pr-confirm-go" onClick={() => void run(async () => {
                        const r = await api.post<{ ok: boolean; url?: string }>("proof/link", { locationId: row.locationId, month, action: confirmFor, confirm: typed });
                        setConfirmFor(null); setTyped("");
                        if (confirmFor === "regenerate" && r.url) { setUrl(r.url); return "New link made. The old link no longer works."; }
                        setUrl(null); return "Link switched off.";
                      })}>{confirmFor === "revoke" ? "Turn link off" : "Replace link"}</button>
                      <button type="button" className="ap-link" onClick={() => { setConfirmFor(null); setTyped(""); }}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            )}
            <div aria-live="polite" className="mt-2 min-h-5 text-sm" data-testid="pr-msg">{note}</div>
          </section>
          <div className="rounded-xl border" style={{ overflow: "hidden" }} data-testid="pr-preview">
            <ProofReport p={rp.payload} brand={brand} intro={introNow || null} sections={secNow} nameStaff={rp.nameStaff} sample={sample} />
          </div>
          <PrintCopy><ProofReport p={rp.payload} brand={brand} intro={introNow || null} sections={secNow} nameStaff={rp.nameStaff} sample={sample} /></PrintCopy>
        </>
      )}
    </div>
  );
}
