"use client";

import { useState } from "react";
import { useApiClient, useData } from "../session";
import { Badge, BandBadge, Btn, Card, Empty, ErrorBox, ExtLink, fmtInt, fmtMoney, inputClass, Loading, PageHeader, Sparkline, Stat, Table, Td, Th } from "../ui";
import type { Band } from "../types";

type Client = {
  locationId: string; name: string | null; url: string; score: number; band: Band; churn: string; dormant: boolean; new30d: number; openValue: number;
  unanswered: number; completenessPct: number; winRate: number | null; avgCycleDays: number | null;
  profile: { monthlyFee: number | null; renewalDate: string | null; industry: string | null; notes: string | null; lastContactedAt: string | null };
  roi: { pipelineMultiple: number; wonMultiple: number } | null;
  renewal: { daysLeft: number; bucket: string } | null;
  contactGap: { days: number | null; flagged: boolean };
  progress: { daysSinceInstall: number | null; firstLeadAt: string | null; firstWonAt: string | null; needsIntervention: boolean };
  activity: string;
  setup: { score: number; missing: string[] };
};
type Clients = {
  clients: Client[];
  revenue: { monthly: number; atRisk: number; clientsWithFee: number };
  renewals: Array<{ locationId: string; name: string | null; daysLeft: number; bucket: string; fee: number | null }>;
  segments: Array<{ industry: string; accounts: number; avgScore: number; avgWinRate: number | null; openValue: number }>;
  compare: Array<{ locationId: string; name: string }>;
};
type Qbr = { client: Client; history: Array<{ day: string; contacts: number; newContacts30d: number; openValue: number; score: number }>; openAlerts: number; generatedAt: string; brand?: { name: string | null; color: string | null } };
type Compare = { a: Record<string, number | string | null>; b: Record<string, number | string | null>; notes: string[] };

const pct = (n: number | null) => (n === null ? "n/a" : `${Math.round(n * 100)}%`);

function Editor({ c, onSaved }: { c: Client; onSaved: () => void }) {
  const api = useApiClient();
  const [fee, setFee] = useState(c.profile.monthlyFee === null ? "" : String(c.profile.monthlyFee));
  const [renewal, setRenewal] = useState(c.profile.renewalDate ?? "");
  const [industry, setIndustry] = useState(c.profile.industry ?? "");
  const [notes, setNotes] = useState(c.profile.notes ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const put = async (body: Record<string, unknown>, done: string) => {
    setMsg(null);
    try {
      await api.put(`clients/${c.locationId}`, body);
      setMsg(done);
      onSaved();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  return (
    <div className="mt-3 rounded-xl border bg-muted/20 p-4">
      <p className="text-sm text-muted-foreground">{c.activity}</p>
      <p className="mt-2 text-sm">Setup score <strong>{c.setup.score}/100</strong>{c.setup.missing.length > 0 ? <span className="text-muted-foreground">. Missing: {c.setup.missing.join(", ")}.</span> : <span className="text-muted-foreground">. Fully set up.</span>}</p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div><label htmlFor={`fee-${c.locationId}`} className="mb-1 block text-xs text-muted-foreground">What they pay you per month ($)</label><input id={`fee-${c.locationId}`} className={inputClass} inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value.replace(/[^0-9.]/g, ""))} /></div>
        <div><label htmlFor={`ren-${c.locationId}`} className="mb-1 block text-xs text-muted-foreground">Contract renews on</label><input id={`ren-${c.locationId}`} type="date" className={inputClass} value={renewal} onChange={(e) => setRenewal(e.target.value)} /></div>
        <div><label htmlFor={`ind-${c.locationId}`} className="mb-1 block text-xs text-muted-foreground">Industry</label><input id={`ind-${c.locationId}`} className={inputClass} value={industry} maxLength={60} onChange={(e) => setIndustry(e.target.value)} placeholder="e.g. Dental" /></div>
      </div>
      <label htmlFor={`notes-${c.locationId}`} className="mb-1 mt-3 block text-xs text-muted-foreground">Notes for anyone on your team (preferences, SOPs, things to remember)</label>
      <textarea id={`notes-${c.locationId}`} className={`${inputClass} min-h-24`} value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Btn variant="primary" onClick={() => put({ monthlyFee: fee, renewalDate: renewal, industry, notes }, "Saved.")}>Save</Btn>
        <Btn onClick={() => put({ markContacted: true }, "Logged: you spoke to them today.")}>I spoke to them today</Btn>
        <ExtLink href={c.url}>Open account</ExtLink>
        {msg && <span className="text-sm text-muted-foreground" role="status">{msg}</span>}
      </div>
    </div>
  );
}

function ClientsTab({ data, reload }: { data: Clients; reload: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const stale = data.clients.filter((c) => c.contactGap.flagged).length;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Monthly client revenue" value={data.revenue.clientsWithFee ? fmtMoney(data.revenue.monthly) : "n/a"} sub={`${data.revenue.clientsWithFee} of ${data.clients.length} clients have a fee set`} />
        <Stat label="Revenue at risk" value={data.revenue.clientsWithFee ? fmtMoney(data.revenue.atRisk) : "n/a"} tone={data.revenue.atRisk > 0 ? "bad" : undefined} sub="fees from at-risk or dormant clients" />
        <Stat label="Not spoken to in 14+ days" value={stale} tone={stale > 0 ? "warn" : undefined} sub="tap a client, then log a conversation" />
        <Stat label="Renewals in 90 days" value={data.renewals.length} />
      </div>

      {data.renewals.length > 0 && (
        <Card title="Renewals coming up">
          <ul className="space-y-1 text-sm">
            {data.renewals.map((r) => (
              <li key={r.locationId} className="flex flex-wrap items-center justify-between gap-2">
                <span>{r.name ?? "Unnamed account"}{r.fee ? <span className="text-muted-foreground">, {fmtMoney(r.fee)} a month</span> : null}</span>
                <Badge tone={r.bucket === "overdue" || r.bucket === "30" ? "bad" : r.bucket === "60" ? "warn" : "neutral"}>{r.daysLeft < 0 ? `${-r.daysLeft} days overdue` : `in ${r.daysLeft} days`}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Table head={<tr><Th>Client</Th><Th>Health</Th><Th className="text-right">Fee</Th><Th className="text-right">Value created</Th><Th>Renewal</Th><Th>Last spoken</Th><Th className="text-right">Setup</Th><Th>{""}</Th></tr>}>
        {data.clients.flatMap((c) => [
          <tr key={c.locationId} className="hover:bg-muted/40">
            <Td className="font-medium">{c.name ?? "Unnamed account"}
              {c.progress.needsIntervention && <div className="text-xs font-normal text-amber-600 dark:text-amber-400">{c.progress.daysSinceInstall} days in, no deal won yet. Needs a conversation.</div>}
            </Td>
            <Td><BandBadge band={c.band} /> <span className="text-xs text-muted-foreground">{c.score}</span></Td>
            <Td className="text-right tabular-nums">{c.profile.monthlyFee === null ? <span className="text-muted-foreground">not set</span> : fmtMoney(c.profile.monthlyFee)}</Td>
            <Td className="text-right tabular-nums">{c.roi ? `${c.roi.pipelineMultiple}x pipeline` : <span className="text-muted-foreground">needs a fee</span>}</Td>
            <Td>{c.renewal ? (c.renewal.daysLeft < 0 ? "Overdue" : `${c.renewal.daysLeft} days`) : <span className="text-muted-foreground">not set</span>}</Td>
            <Td>{c.contactGap.days === null ? <Badge tone="warn">Never logged</Badge> : c.contactGap.flagged ? <Badge tone="warn">{c.contactGap.days} days ago</Badge> : `${c.contactGap.days} days ago`}</Td>
            <Td className="text-right tabular-nums">{c.setup.score}</Td>
            <Td><button type="button" className="text-sm underline" onClick={() => setOpen(open === c.locationId ? null : c.locationId)}>{open === c.locationId ? "Close" : "Details"}</button></Td>
          </tr>,
          ...(open === c.locationId ? [<tr key={`${c.locationId}-e`}><td colSpan={8} className="px-3 pb-3"><Editor c={c} onSaved={reload} /></td></tr>] : []),
        ])}
      </Table>
      <p className="text-xs text-muted-foreground">Value created is the new pipeline from the last 30 days divided by the monthly fee. Fees, renewals and notes are what you enter here; SubSync does not read them from anywhere.</p>

      <Card title="Clients by industry">
        <Table head={<tr><Th>Industry</Th><Th className="text-right">Clients</Th><Th className="text-right">Average score</Th><Th className="text-right">Average win rate</Th><Th className="text-right">Open pipeline</Th></tr>}>
          {data.segments.map((s) => (
            <tr key={s.industry}><Td className="font-medium">{s.industry}</Td><Td className="text-right tabular-nums">{s.accounts}</Td><Td className="text-right tabular-nums">{s.avgScore}</Td><Td className="text-right tabular-nums">{pct(s.avgWinRate)}</Td><Td className="text-right tabular-nums">{fmtMoney(s.openValue)}</Td></tr>
          ))}
        </Table>
        {data.segments.length === 1 && data.segments[0].industry === "Not set" && <p className="mt-2 text-xs text-muted-foreground">Set an industry on each client (Details) to compare groups.</p>}
      </Card>
    </div>
  );
}

function CompareTab({ accounts }: { accounts: Array<{ locationId: string; name: string }> }) {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const ready = a && b && a !== b;
  const { data, error } = useData<Compare>(ready ? `clients/compare?a=${a}&b=${b}` : null);
  const rows: Array<[string, string]> = [["new30d", "New contacts, 30 days"], ["score", "Health score"], ["winRate", "Win rate"], ["avgCycleDays", "Days to win"], ["unanswered", "Waiting past reply target"], ["completenessPct", "Contact data complete (%)"], ["openValue", "Open pipeline"]];
  const show = (k: string, v: number | string | null | undefined) => (v === null || v === undefined ? "n/a" : k === "winRate" ? `${Math.round(Number(v) * 100)}%` : k === "openValue" ? fmtMoney(Number(v)) : String(v));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {[["First client", a, setA], ["Second client", b, setB]].map(([label, value, set]) => (
          <div key={label as string}>
            <label className="mb-1 block text-sm font-medium">{label as string}</label>
            <select className={inputClass} value={value as string} onChange={(e) => (set as (v: string) => void)(e.target.value)}>
              <option value="">Choose...</option>
              {accounts.map((x) => <option key={x.locationId} value={x.locationId}>{x.name}</option>)}
            </select>
          </div>
        ))}
      </div>
      {error && <ErrorBox error={error} />}
      {data && (
        <>
          <Card title="What is different">
            <ul className="list-disc space-y-1 pl-5 text-sm">{data.notes.map((n) => <li key={n}>{n}</li>)}</ul>
          </Card>
          <Table head={<tr><Th>{""}</Th><Th className="text-right">{String(data.a.name)}</Th><Th className="text-right">{String(data.b.name)}</Th></tr>}>
            {rows.map(([k, label]) => <tr key={k}><Td>{label}</Td><Td className="text-right tabular-nums">{show(k, data.a[k])}</Td><Td className="text-right tabular-nums">{show(k, data.b[k])}</Td></tr>)}
          </Table>
        </>
      )}
      {!ready && <Empty title="Pick two clients to compare" body="You will see their numbers side by side, and a plain-language note on what is different." />}
    </div>
  );
}

function QbrTab({ accounts }: { accounts: Array<{ locationId: string; name: string }> }) {
  const [id, setId] = useState("");
  const { data, error, loading } = useData<Qbr>(id ? `qbr/${id}` : null);
  const c = data?.client;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <div className="min-w-64 flex-1">
          <label className="mb-1 block text-sm font-medium">Client</label>
          <select className={inputClass} value={id} onChange={(e) => setId(e.target.value)}><option value="">Choose...</option>{accounts.map((x) => <option key={x.locationId} value={x.locationId}>{x.name}</option>)}</select>
        </div>
        <Btn variant="primary" disabled={!c} onClick={() => window.print()}>Print or save as PDF</Btn>
      </div>
      {error && <ErrorBox error={error} />}
      {id && loading && !data && <Loading />}
      {!id && <Empty title="Choose a client" body="You get a one-page review for a client meeting: what we delivered, the value created, and how their health has moved." />}
      {c && data && (
        <article className="space-y-5 rounded-xl border bg-card p-6 print:border-0 print:p-0">
          <header className="border-b-4 pb-3" style={{ borderColor: data.brand?.color ?? "#111827" }}>
            {data.brand?.name && <p className="mb-2 text-lg font-semibold" style={{ color: data.brand.color ?? undefined }}>{data.brand.name}</p>}
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Quarterly business review</p>
            <h2 className="text-2xl font-semibold tracking-tight">{c.name ?? "Client"}</h2>
            <p className="text-sm text-muted-foreground">Prepared {new Date(data.generatedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</p>
          </header>
          <p className="text-base leading-7">{c.activity}</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Health score" value={c.score} sub="0 to 100" />
            <Stat label="Open pipeline" value={fmtMoney(c.openValue)} />
            <Stat label="Win rate" value={pct(c.winRate)} />
            <Stat label="Value created" value={c.roi ? `${c.roi.pipelineMultiple}x` : "n/a"} sub={c.roi ? "pipeline vs monthly fee" : "add their fee to see this"} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div><p className="mb-1 text-sm font-medium">Health score, 90 days</p><Sparkline values={data.history.map((h) => h.score)} label="Engagement score" /></div>
            <div><p className="mb-1 text-sm font-medium">Open pipeline, 90 days</p><Sparkline values={data.history.map((h) => h.openValue)} label="Open pipeline value" /></div>
          </div>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            <li>{fmtInt(c.new30d)} new contacts in the last 30 days.</li>
            <li>{c.unanswered} message{c.unanswered === 1 ? "" : "s"} waiting past the reply target; {data.openAlerts} open alert{data.openAlerts === 1 ? "" : "s"}.</li>
            <li>Contact data is {c.completenessPct}% complete.</li>
            {c.profile.notes && <li>Notes: {c.profile.notes}</li>}
          </ul>
        </article>
      )}
    </div>
  );
}

export function ClientsView({ reports = true }: { reports?: boolean }) {
  const api = useApiClient();
  const { data, error, loading, reload } = useData<Clients>("clients");
  const [tab, setTab] = useState<"clients" | "compare" | "qbr">("clients");
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  return (
    <div>
      <div className="print:hidden">
        <PageHeader title="Clients" subtitle="Fees, renewals, value delivered and who needs a conversation. Built to help you keep clients." actions={<Btn onClick={() => api.download("export/clients", "subsync-clients.csv")}>Export CSV</Btn>} />
        <div className="mb-4 flex gap-1 border-b" role="tablist">
          {([["clients", "Clients"], ["compare", "Compare two"], ["qbr", "Review (QBR)"]] as const).filter(([id]) => reports || id === "clients").map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === id ? "border-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{label}</button>
          ))}
        </div>
      </div>
      {data.clients.length === 0 ? <Empty title="No clients yet" body="Client accounts appear here once the first sync finishes." /> :
        tab === "clients" ? <ClientsTab data={data} reload={reload} /> : tab === "compare" ? <CompareTab accounts={data.compare} /> : <QbrTab accounts={data.compare} />}
    </div>
  );
}
