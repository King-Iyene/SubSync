"use client";

import { useState } from "react";
import { fmtMoney } from "@/lib/analytics/payments-format";
import type { McBucket, McChecks, McRow, McSection } from "@/lib/analytics/money-checks";
import type { PmOptions } from "@/lib/analytics/payments-types";
import { usePm } from "./data";
import { Load } from "./shared";

// Money checks: a live, read-only look at one client account's invoices, estimates, orders, coupons, payment provider, products and the charges apps made to it. Nothing is stored or changed.
// Each part says plainly when it needs a permission ("Needs permission: reconnect ...") or when the platform has no such data ("Not available from the platform yet"). Counts open their rows.
// Failed and upcoming payments already have their own tabs: the links at the top open them instead of repeating them here.

const ALL = "__all";
const day = (iso: string | null) => iso ?? "";
const moneyText = (m: Array<{ currency: string; amount: number }>) => m.map((x) => fmtMoney(x.amount, x.currency || null)).join(" + ");

function Rows({ rows, bucket, sectionKey }: { rows: McRow[]; bucket: string; sectionKey: string }) {
  const shown = bucket === ALL ? rows : rows.filter((r) => r.bucket === bucket || (r.status ?? "No status").toLowerCase() === bucket);
  if (!shown.length) return <p className="ap-fine" data-testid={`pm-check-${sectionKey}-none`}>Nothing in this group.</p>;
  return (
    <ul className="pm-list mt-2" data-testid={`pm-check-${sectionKey}-rows`}>
      {shown.slice(0, 100).map((r, i) => (
        <li key={r.id ?? i} className="pm-row">
          <span className="pm-who"><b>{r.title}</b>{r.sub && <span className="pm-sub"> {r.sub}</span>}</span>
          <span className="pm-amt">{r.amount !== null ? fmtMoney(r.amount, r.currency) : ""}</span>
          <span className="ap-fine">{r.status ?? ""}</span>
          <span className="ap-fine">{r.date ? `Date ${day(r.date)}` : ""}</span>
        </li>
      ))}
      {shown.length > 100 && <li className="ap-fine">Showing the first 100 of {shown.length.toLocaleString("en-US")}.</li>}
    </ul>
  );
}

function Buckets({ s, bucket, setBucket }: { s: McSection; bucket: string | null; setBucket: (b: string | null) => void }) {
  return (
    <div className="pm-tiles mt-2">
      {s.buckets.map((b: McBucket) => (
        <button key={b.key} type="button" className="pm-tile" aria-pressed={bucket === b.key} data-hot={bucket === b.key ? "1" : undefined} data-testid={`pm-check-${s.key}-b-${b.key}`} onClick={() => setBucket(bucket === b.key ? null : b.key)}>
          <b>{b.count.toLocaleString("en-US")}</b><span>{b.label}</span>
          {b.money.length > 0 && <span>{moneyText(b.money)}{b.amountLabel === "still owed" ? " still owed" : ""}</span>}
        </button>
      ))}
    </div>
  );
}

function Card({ s, reload }: { s: McSection; reload: () => void }) {
  const [bucket, setBucket] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const hasRows = s.rows.length > 0;
  return (
    <section className="pm-card" aria-label={s.label} data-testid={`pm-check-${s.key}`} data-state={s.state}>
      <h2 className="pm-h mb-1">{s.label}</h2>
      {s.state === "needs_permission" && <div className="pm-notice" role="status" data-testid={`pm-check-${s.key}-perm`}>{s.message}</div>}
      {s.state === "not_available" && <p className="ap-fine" data-testid={`pm-check-${s.key}-na`}>{s.message}</p>}
      {s.state === "error" && <p className="ap-fine" role="alert" data-testid={`pm-check-${s.key}-err`}>{s.message} <button type="button" className="ap-link" onClick={reload}>Try again</button></p>}
      {s.state === "ok" && (
        <>
          {s.key === "providers" ? (
            <p className="text-sm" data-testid="pm-check-providers-answer">{s.connected ? `Connected: ${s.rows.map((r) => r.title).join(", ")}.` : "No custom payment provider is connected."}</p>
          ) : (
            <p className="pm-sentence" data-testid={`pm-check-${s.key}-count`}>
              {hasRows ? <button type="button" className="ap-link" aria-expanded={open || bucket !== null} onClick={() => { setOpen(!open); setBucket(null); }}>{(s.count ?? s.rows.length).toLocaleString("en-US")}</button> : <span>{(s.count ?? 0).toLocaleString("en-US")}</span>}
              {s.truncated && "+"}
            </p>
          )}
          {s.buckets.length > 0 && <Buckets s={s} bucket={bucket} setBucket={(b) => { setBucket(b); setOpen(false); }} />}
          {s.key === "providers" && hasRows && <Rows rows={s.rows} bucket={ALL} sectionKey={s.key} />}
          {s.key !== "providers" && (bucket !== null || open) && <Rows rows={s.rows} bucket={bucket ?? ALL} sectionKey={s.key} />}
          {!hasRows && s.key !== "providers" && <p className="ap-fine mt-1" data-testid={`pm-check-${s.key}-empty`}>None in this account.</p>}
          {s.truncated && <p className="ap-fine mt-1">There are more than shown here; the first part is counted.</p>}
          {s.note && <p className="ap-fine mt-1">{s.note}</p>}
        </>
      )}
    </section>
  );
}

export function ChecksTab({ options, goTab }: { options: PmOptions | null; goTab: (t: string) => void }) {
  const accounts = options?.accounts ?? [];
  const [pick, setPick] = useState("");
  const r = usePm<McChecks>("checks", pick ? { location: pick } : {});
  return (
    <div className="pm-stack" data-testid="pm-checks">
      <section className="pm-card" aria-label="About Money checks">
        <h2 className="pm-h mb-1">Money checks</h2>
        <p className="text-sm">A live look at one client account&apos;s invoices, estimates, orders, coupons, payment provider, products and the charges apps made to it. Read from your CRM when you open this; nothing is stored or changed.</p>
        <p className="ap-fine mt-1">Already have their own tabs: <button type="button" className="ap-link" data-testid="pm-checks-failed" onClick={() => goTab("queue")}>failed and late payments</button> and <button type="button" className="ap-link" data-testid="pm-checks-upcoming" onClick={() => goTab("upcoming")}>upcoming payments</button>.</p>
        {accounts.length > 1 && (
          <label className="mt-2 flex flex-wrap items-center gap-2 text-sm">Client account
            <select className="ap-field" aria-label="Client account" value={pick} onChange={(e) => setPick(e.target.value)} data-testid="pm-checks-account">
              <option value="">{accounts[0]?.name ?? "First account"}</option>
              {accounts.slice(1).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
        )}
      </section>
      <Load r={r} label="Reading this account from your CRM..." empty={(d) => !d.account && "No client account to read yet. They appear here after the first sync."}>
        {(d) => (
          <>
            {d.sample && <p className="ap-fine" role="status" data-testid="pm-checks-sample">Sample data: these are not real invoices or orders.</p>}
            <p className="ap-fine" data-testid="pm-checks-account-name">Account: <b>{d.account?.name}</b>. {d.unitsNote}</p>
            {(d.sections ?? []).map((s) => <Card key={s.key} s={s} reload={r.reload} />)}
          </>
        )}
      </Load>
    </div>
  );
}
