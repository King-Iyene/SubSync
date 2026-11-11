"use client";

import { useMemo, useState } from "react";
import { durationText, FORMULA, notEnough, receiptLine, type ChannelMix, type Curve, type Receipt } from "@/lib/analytics/moat-core";
import { useApiClient, useData } from "../session";
import { EmptyState, ErrorState, LeadDrawer, SkeletonRows, type LeadSeed } from "../ds";
import { InfoTip } from "../ds/info-tip";
import { CountUp } from "../ds/count-up";
import { CurveChart } from "./moat-curve-chart";

// Round 3, slice D and E: the proof cards, in their own file so the Unanswered screen can mount them without a merge conflict. Cards are named as the question they answer; three
// show first and the rest sit behind "More". Every number of people opens exactly those people, and a person opens the full lead panel. Plain words, explanations in hover tips.
// Each card renders only when its flag is on (`features`), so the page is unchanged until a flag is switched on.

type Features = Partial<Record<string, boolean>>;
type ReceiptOut = {
  from: string; rows: Array<{ locationId: string; name: string; receipt: Receipt }>;
  total: { alerts: number; saved: number; stillWaiting: number; bookedAfter: number; lateLeads: number; medianReplyMinutes: number | null };
  rescued: { low: number; high: number; accountsWithEstimate: number }; atRisk: { low: number; high: number; accountsWithEstimate: number };
};
type PersonRow = { locationId: string; contactId: string | null; person: string; account: string; replyMinutes: number | null; url: string | null };
const card = "rounded-2xl border bg-card p-4 shadow-sm sm:p-5";
const h3 = "mb-2 flex items-center gap-2 text-base font-semibold";
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const monthLabel = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const lastMonth = () => { const d = new Date(); const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)); return `${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, "0")}`; };

function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div className="mt-2 flex items-center gap-2 text-sm">
      <button type="button" disabled={page === 0} onClick={() => onPage(page - 1)} className="min-h-11 px-3 disabled:opacity-50">Previous</button>
      <span>Page {page + 1} of {pages}</span>
      <button type="button" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)} className="min-h-11 px-3 disabled:opacity-50">Next</button>
    </div>
  );
}

export function MoatPanel({ features, account }: { features: Features; account?: string | null }) {
  const [more, setMore] = useState(false);
  const q = account ? `&account=${encodeURIComponent(account)}` : "";
  const hasMore = features.inbox_channel_mix || features.inbox_wait_clock || features.moat_benchmark || features.moat_proof_page || features.inbox_reply_target;
  return (
    <div className="grid gap-4" data-testid="moat-panel">
      {features.moat_receipt && <ReceiptCard q={q} />}
      {features.moat_curve && <CurveCard q={q} />}
      {features.moat_scorecards && <ScorecardsCard q={q} />}
      {hasMore && (
        <>
          <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} className="min-h-11 rounded-xl border bg-card px-4 text-sm font-medium hover:border-primary/40" data-testid="moat-more">
            {more ? "Show less" : "More"}
          </button>
          {more && (
            <div className="grid gap-4">
              {features.inbox_channel_mix && <ChannelsCard q={q} />}
              {features.inbox_wait_clock && <ClockCard q={q} />}
              {features.moat_benchmark && <BenchmarkCard />}
              {features.moat_proof_page && <ProofCard />}
              <SetupCard features={features} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- D2

export function ReceiptCard({ q }: { q: string }) {
  const month = lastMonth();
  const { data, error, loading, reload } = useData<ReceiptOut>(`moat?part=receipt&month=${month}${q}`);
  const [open, setOpen] = useState<{ kind: string; title: string } | null>(null);
  if (loading) return <section className={card}><SkeletonRows rows={3} /></section>;
  if (error || !data) return <section className={card}><ErrorState error={error ?? new Error("Could not load")} onRetry={reload} /></section>;
  const t = data.total;
  const est = data.rescued.accountsWithEstimate > 0;
  const stat = (kind: string, label: string, value: number) => (
    <button type="button" disabled={value === 0} onClick={() => setOpen({ kind, title: label })} className="min-h-11 rounded-xl border px-3 py-2 text-left enabled:hover:border-primary/40 disabled:opacity-60" data-testid={`receipt-${kind}`}>
      <div className="text-2xl font-semibold tabular-nums"><CountUp value={value} /></div><div className="text-xs text-muted-foreground">{label}</div>
    </button>
  );
  return (
    <section className={card} data-testid="receipt-card">
      <h3 className={h3}>What did we save you in {monthLabel(data.from)}? <InfoTip text="Leads that waited long enough to raise an alert, and whether a person replied afterwards. Counts are exact. Dollars are an estimate." /></h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stat("alerts", "Alerts raised", t.alerts)}{stat("saved", "Got a reply", t.saved)}{stat("booked", "Booked after", t.bookedAfter)}{stat("waiting", "Still waiting", t.stillWaiting)}
      </div>
      <p className="mt-3 text-sm" data-testid="receipt-dollars">
        {est ? <>Estimated kept: <strong>{money(data.rescued.low)} to {money(data.rescued.high)}</strong>{t.medianReplyMinutes !== null && <> · typical reply {durationText(t.medianReplyMinutes)} after the alert</>}</> : "Dollar estimate: not enough data yet."}
        {" "}<InfoTip text={`Estimate. ${FORMULA}`} label="How this estimate is worked out" />
      </p>
      {data.atRisk.accountsWithEstimate > 0 && <p className="mt-1 text-sm text-muted-foreground">Estimated at risk from {t.lateLeads} late leads: {money(data.atRisk.low)} to {money(data.atRisk.high)}.</p>}
      {data.rows.length > 1 && (
        <ul className="mt-3 divide-y text-sm">{data.rows.slice(0, 5).map((r) => (
          <li key={r.locationId} className="flex flex-wrap justify-between gap-2 py-2"><span>{r.name}</span><span className="text-muted-foreground">{receiptLine(r.receipt)}{!r.receipt.rescued.ok && r.receipt.alerts > 0 ? ` (${notEnough(r.receipt.rescued)})` : ""}</span></li>
        ))}</ul>
      )}
      {open && <PeopleList title={open.title} path={`moat?part=receipt-people&month=${month}&kind=${open.kind}${q}`} onClose={() => setOpen(null)} />}
    </section>
  );
}

function PeopleList({ title, path, onClose }: { title: string; path: string; onClose: () => void }) {
  const [page, setPage] = useState(0);
  const { data, error, loading, reload } = useData<{ rows: PersonRow[]; total: number; pages: number; page: number }>(`${path}&page=${page}&size=20`);
  const [lead, setLead] = useState<number | null>(null);
  const seeds = useMemo<LeadSeed[]>(() => (data?.rows ?? []).filter((r) => r.contactId).map((r) => ({ contactId: r.contactId as string, locationId: r.locationId, name: r.person, locationName: r.account, url: r.url ?? undefined })), [data]);
  return (
    <div className="mt-3 rounded-xl border p-3" role="region" aria-label={title} data-testid="people-list">
      <div className="mb-2 flex items-center justify-between"><strong className="text-sm">{title}{data ? ` (${data.total})` : ""}</strong><button type="button" onClick={onClose} className="min-h-11 px-3 text-sm underline">Close</button></div>
      {loading ? <SkeletonRows rows={3} /> : error || !data ? <ErrorState error={error ?? new Error("Could not load")} onRetry={reload} /> : data.rows.length === 0 ? <EmptyState compact title="Nobody here" /> : (
        <ul className="divide-y">{data.rows.map((r, i) => (
          <li key={`${r.locationId}-${r.contactId ?? i}`}>
            <button type="button" className="flex min-h-11 w-full items-center justify-between gap-2 py-2 text-left text-sm hover:text-primary" onClick={() => { const k = seeds.findIndex((s) => s.contactId === r.contactId && s.locationId === r.locationId); if (k >= 0) setLead(k); }}>
              <span>{r.person} <span className="text-muted-foreground">· {r.account}</span></span>
              <span className="tabular-nums text-muted-foreground">{r.replyMinutes === null ? "no reply yet" : `replied after ${durationText(r.replyMinutes)}`}</span>
            </button>
          </li>
        ))}</ul>
      )}
      {data && <Pager page={data.page} pages={data.pages} onPage={setPage} />}
      {lead !== null && seeds.length > 0 && <LeadDrawer leads={seeds} index={lead} onIndex={setLead} onClose={() => setLead(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------- D3

export function CurveCard({ q }: { q: string }) {
  const { data, error, loading, reload } = useData<Curve>(`moat?part=curve&days=90${q}`);
  return (
    <section className={card} data-testid="curve-card">
      <h3 className={h3}>Does answering faster win more bookings? <InfoTip text="From your own last 90 days: of the leads answered within each time band, the share that booked an appointment. A band needs at least 20 leads, and the whole chart needs 100." /></h3>
      {loading ? <SkeletonRows rows={3} /> : error || !data ? <ErrorState error={error ?? new Error("Could not load")} onRetry={reload} /> : <CurveChart curve={data} />}
    </section>
  );
}

// ---------------------------------------------------------------- D4

type ScoreCard = { userId: string; name: string; replies: number; medianMinutes: number | null; p90Minutes: number | null; unansweredShare: number | null; owned: number; afterHoursCoverage: number | null; trend: { dir: string; changePct: number | null }; enough: boolean };
export function ScorecardsCard({ q }: { q: string }) {
  const [page, setPage] = useState(0);
  const { data, error, loading, reload } = useData<{ rows: ScoreCard[]; total: number; pages: number; page: number; scope: string }>(`moat?part=scorecards&days=30&page=${page}${q}`);
  const trend = (t: ScoreCard["trend"]) => (t.dir === "new" ? "not enough replies to compare" : t.dir === "same" ? "about the same as last week" : `${Math.abs(t.changePct ?? 0)}% ${t.dir} than last week`);
  return (
    <section className={card} data-testid="scorecards-card">
      <h3 className={h3}>{data?.scope === "self" ? "How quickly do I reply?" : "Who replies fastest?"} <InfoTip text="Typical is the middle reply time; the slowest tenth is the time 9 in 10 replies beat. After hours is the share of after-hours leads answered within an hour. A person needs 5 replies to show speeds." /></h3>
      {loading ? <SkeletonRows rows={3} /> : error || !data ? <ErrorState error={error ?? new Error("Could not load")} onRetry={reload} /> : data.rows.length === 0 ? <EmptyState compact title="No replies yet" body="Cards appear once a person has replied to new leads." /> : (
        <ul className="divide-y">{data.rows.map((r) => (
          <li key={r.userId} className="grid gap-1 py-2 text-sm sm:grid-cols-[1fr_auto]" data-testid="scorecard-row">
            <div><strong>{r.name}</strong> <span className="text-muted-foreground">{r.replies} replies</span><div className="text-xs text-muted-foreground">{r.enough ? trend(r.trend) : "Not enough replies to show speeds"}</div></div>
            {r.enough && (
              <div className="tabular-nums sm:text-right">typical {durationText(r.medianMinutes ?? 0)} · slowest tenth {durationText(r.p90Minutes ?? 0)}
                <div className="text-xs text-muted-foreground">{r.unansweredShare === null ? "no owned leads" : `${r.unansweredShare}% of ${r.owned} owned leads unanswered`}{r.afterHoursCoverage === null ? "" : ` · after hours ${r.afterHoursCoverage}%`}</div>
              </div>
            )}
          </li>
        ))}</ul>
      )}
      {data && <Pager page={data.page} pages={data.pages} onPage={setPage} />}
    </section>
  );
}

// ---------------------------------------------------------------- E4

export function ChannelsCard({ q }: { q: string }) {
  const { data, error, loading, reload } = useData<ChannelMix>(`moat?part=channels&days=30${q}`);
  const label: Record<string, string> = { sms: "Text", email: "Email", whatsapp: "WhatsApp", chat: "Chat", social: "Social", call: "Call", other: "Other" };
  return (
    <section className={card} data-testid="channels-card">
      <h3 className={h3}>Which channel gets answered fastest? <InfoTip text="The channel of each new lead's first message, last 30 days. Fastest needs 10 replies in a channel and two channels to compare." /></h3>
      {loading ? <SkeletonRows rows={3} /> : error || !data ? <ErrorState error={error ?? new Error("Could not load")} onRetry={reload} /> : data.rows.length === 0 ? <EmptyState compact title="No leads yet" /> : (
        <ul className="grid gap-2">{data.rows.map((r) => (
          <li key={r.channel} className="text-sm">
            <div className="flex justify-between"><span>{label[r.channel] ?? r.channel}{data.fastest === r.channel ? " · fastest" : ""}</span><span className="tabular-nums text-muted-foreground">{r.sharePct}% · {r.leads} leads{r.medianMinutes === null ? "" : ` · typical ${durationText(r.medianMinutes)}`}</span></div>
            <div className="mt-1 h-2 rounded-full bg-muted"><div className="h-2 rounded-full bg-primary transition-[width] duration-700" style={{ width: `${r.sharePct}%` }} /></div>
          </li>
        ))}</ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- E1

type ClockRow = { locationId: string; conversationId: string; person: string; account: string; realMinutes: number; workingMinutes: number | null; url: string };
export function ClockCard({ q }: { q: string }) {
  const [page, setPage] = useState(0);
  const { data, error, loading, reload } = useData<{ rows: ClockRow[]; total: number; pages: number; page: number; used: string }>(`moat?part=clock&page=${page}${q}`);
  return (
    <section className={card} data-testid="clock-card">
      <h3 className={h3}>How long has each person really waited? <InfoTip text="Real wait counts every hour. Working-hours wait counts only Monday to Friday inside your opening hours. The line below says which one your alerts use." /></h3>
      {data && <p className="mb-2 text-xs text-muted-foreground" data-testid="clock-used">{data.used === "working" ? "Alerts count working hours only." : "Alerts count every hour."}</p>}
      {loading ? <SkeletonRows rows={3} /> : error || !data ? <ErrorState error={error ?? new Error("Could not load")} onRetry={reload} /> : data.rows.length === 0 ? <EmptyState compact title="Nobody is waiting" /> : (
        <ul className="divide-y">{data.rows.map((r) => (
          <li key={`${r.locationId}-${r.conversationId}`} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
            <a href={r.url} target="_blank" rel="noreferrer" className="min-h-11 hover:text-primary">{r.person} <span className="text-muted-foreground">· {r.account}</span></a>
            <span className="tabular-nums text-muted-foreground">real {durationText(r.realMinutes)} · working hours {r.workingMinutes === null ? "n/a" : durationText(r.workingMinutes)}</span>
          </li>
        ))}</ul>
      )}
      {data && <Pager page={data.page} pages={data.pages} onPage={setPage} />}
    </section>
  );
}

// ---------------------------------------------------------------- D5

type Bench = { available: false; message: string; reason: string } | { available: true; vertical: string; accounts: number; medianMinutes: number; p25Minutes: number; p75Minutes: number; yours: { medianMinutes: number | null } };
export function BenchmarkCard() {
  const setup = useData<{ verticals: Array<{ key: string; label: string }>; benchmarkOptIn: boolean }>("moat?part=setup");
  const [v, setV] = useState("med_spa");
  const { data, error, loading, reload } = useData<Bench>(setup.data?.benchmarkOptIn ? `moat?part=benchmark&vertical=${v}` : null);
  return (
    <section className={card} data-testid="benchmark-card">
      <h3 className={h3}>How do we compare with similar businesses? <InfoTip text="Only the middle and the quarter points of other accounts' reply times, never a name. Shown only when at least 10 accounts from 5 companies share it, and only if your company has switched benchmarking on." /></h3>
      <label className="mb-2 flex items-center gap-2 text-sm">Kind of business
        <select value={v} onChange={(e) => setV(e.target.value)} className="min-h-11 rounded-lg border bg-card px-2">{(setup.data?.verticals ?? []).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select>
      </label>
      {!setup.data?.benchmarkOptIn ? <p className="text-sm text-muted-foreground">Benchmarking is off. Turn it on under Set up below to see how you compare.</p>
        : loading ? <SkeletonRows rows={2} />
        : error || !data ? <ErrorState error={error ?? new Error("Could not load")} onRetry={reload} />
        : !data.available ? <p className="text-sm" data-testid="benchmark-empty">{data.message}</p>
        : <p className="text-sm" data-testid="benchmark-value">Similar accounts reply in a median of <strong>{durationText(data.medianMinutes)}</strong> (middle half: {durationText(data.p25Minutes)} to {durationText(data.p75Minutes)}).{data.yours.medianMinutes !== null && <> Yours: <strong>{durationText(data.yours.medianMinutes)}</strong>.</>}</p>}
    </section>
  );
}

// ---------------------------------------------------------------- D6

export function ProofCard() {
  const api = useApiClient();
  const setup = useData<{ accounts: Array<{ locationId: string; name: string }> }>("moat?part=setup");
  const list = useData<{ links: Array<{ id: string; account: string; createdAt: string; expiresAt: string; revoked: boolean; views: number }> }>("moat?part=proofs");
  const [loc, setLoc] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const make = async () => {
    setMsg(null);
    try {
      const r = await api.post<{ url: string }>("moat/proof", { locationId: loc || setup.data?.accounts[0]?.locationId });
      setMsg(`Link ready: ${r.url}`);
      list.reload();
    } catch (e) { setMsg((e as { message?: string }).message ?? "Could not make the page"); }
  };
  return (
    <section className={card} data-testid="proof-card">
      <h3 className={h3}>Can I show a client their reply times? <InfoTip text="A page with the account's measured reply times under your name and colour. It works for 30 days, you can switch it off, and it says whether it has been changed since it was made. It is not a promise about the future." /></h3>
      <div className="flex flex-wrap items-center gap-2">
        <select value={loc} onChange={(e) => setLoc(e.target.value)} className="min-h-11 rounded-lg border bg-card px-2 text-sm" aria-label="Client account">{(setup.data?.accounts ?? []).map((a) => <option key={a.locationId} value={a.locationId}>{a.name}</option>)}</select>
        <button type="button" onClick={make} className="min-h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">Make a page</button>
      </div>
      {msg && <p className="mt-2 break-all text-sm" role="status">{msg}</p>}
      <ul className="mt-3 divide-y text-sm">{(list.data?.links ?? []).map((l) => (
        <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span>{l.account} · {l.views} views{l.revoked ? " · switched off" : ""}</span>
          {!l.revoked && <button type="button" className="min-h-11 px-3 underline" onClick={async () => { await api.post("moat/proof-revoke", { id: l.id }); list.reload(); }}>Switch off</button>}
        </li>
      ))}</ul>
    </section>
  );
}

// ---------------------------------------------------------------- D1 / D5 / E2 settings

type SetupData = { verticals: Array<{ key: string; label: string }>; benchmarkOptIn: boolean; defaultTarget: number; accounts: Array<{ locationId: string; name: string; vertical: string | null; targetMinutes: number | null }> };
export function SetupCard({ features }: { features: Features }) {
  const api = useApiClient();
  const { data, error, loading, reload } = useData<SetupData>("moat?part=setup");
  const [err, setErr] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => { setErr(null); try { await fn(); reload(); } catch (e) { setErr((e as { message?: string }).message ?? "Could not save"); } };
  if (loading) return <section className={card}><SkeletonRows rows={2} /></section>;
  if (error || !data) return <section className={card}><ErrorState error={error ?? new Error("Could not load")} onRetry={reload} /></section>;
  return (
    <section className={card} data-testid="setup-card">
      <h3 className={h3}>Set up each client account <InfoTip text="The kind of business is optional and is used only for the anonymous comparison, and only if you switch benchmarking on. The reply target is how fast a new lead should be answered." /></h3>
      {features.moat_benchmark && (
        <label className="mb-3 flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={data.benchmarkOptIn} onChange={(e) => run(() => api.put("moat/benchmark", { optIn: e.target.checked }))} className="size-5" data-testid="benchmark-optin" />
          Compare my accounts with similar businesses (shares only anonymous reply-time totals)
        </label>
      )}
      <ul className="divide-y text-sm">{data.accounts.map((a) => (
        <li key={a.locationId} className="grid items-center gap-2 py-2 sm:grid-cols-[1fr_auto_auto]"><span>{a.name}</span>
          <select aria-label={`Kind of business for ${a.name}`} value={a.vertical ?? ""} onChange={(e) => run(() => api.put("moat/vertical", { locationId: a.locationId, vertical: e.target.value || null }))} className="min-h-11 rounded-lg border bg-card px-2">
            <option value="">Not set</option>{data.verticals.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
          {features.inbox_reply_target && <TargetInput value={a.targetMinutes} fallback={data.defaultTarget} name={a.name} onSave={(m) => run(() => api.put("moat/target", { locationId: a.locationId, minutes: m }))} />}
        </li>
      ))}</ul>
      {err && <p className="mt-2 text-sm text-red-600" role="alert">{err}</p>}
    </section>
  );
}

function TargetInput({ value, fallback, name, onSave }: { value: number | null; fallback: number; name: string; onSave: (m: number | null) => void }) {
  const [v, setV] = useState(value === null ? "" : String(value));
  return (
    <label className="flex items-center gap-1 text-sm">Reply within
      <input aria-label={`Reply target in minutes for ${name}`} inputMode="numeric" value={v} placeholder={String(fallback)} onChange={(e) => setV(e.target.value.replace(/\D/g, "").slice(0, 4))}
        onBlur={() => { const n = v === "" ? null : Number(v); if (n !== value) onSave(n); }} className="min-h-11 w-16 rounded-lg border bg-card px-2 text-right" /> min
    </label>
  );
}
