"use client";

import { MoreHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useApiClient, useData } from "../session";
import { EmptyState, ErrorState, InlineAlert, Page, PopMenu, RecordsPanel, Section, SkeletonCards, type MenuItem } from "../ds";
import { Btn, Card } from "../ui";
import type { Finding, FindingKey, Grade, Verdict } from "@/lib/analytics/audit-v2";
import type { ClientPage, ProgressLine, Reading } from "@/lib/analytics/audit-clients";
import { itemsSpec, type RecordsSpec } from "@/lib/analytics/today-records";
import { SAMPLE_AUDIT_ID } from "@/lib/analytics/share-intel";
import { printAccent, printCss } from "@/lib/design/print";
import { BrandLogo } from "../brand-logo";
import { MonthlyCard, NewAccounts, SinceLine, ThenNow } from "./audit-history";
import type { CountKey, History } from "@/lib/analytics/au-history";
import { sampleAudit } from "./audit-fixture";
import { ClientRowView, FindingRow, GoodNews, LIST_TITLE, Pager, ProgressBlock, ReadingStrip, VerdictBlock, clientControls, num} from "./audit-parts";

// The Account audit, rebuilt (docs/AUDIT_REVIEW.md, docs/features/AUDIT.md). The first thing on the page is one sentence about the money, with the word "estimate"
// on it and its formula one tap away; then the one thing to do first; then the findings as short rows (ranked by money, then by how easy they are to fix), each with
// ONE button that opens exactly the people or deals it counted in the shared list; then what is healthy and what has improved. An agency also sees the clients that need
// it most (five, then all of them, searched and paged on the server). Nothing here changes anything in the CRM.

type ShareLink = { id: string; url: string; createdAt: string; expiresAt: string; revoked: boolean; expired: boolean; views: number; lastViewedAt: string | null };
type Data = {
  verdict: Verdict; grade: Grade | null; startHere: FindingKey | null; totals: { things: number; accounts: number; accountsWithProblems: number; people: number; deals: number };
  notes: string[]; healthy: string[]; progress: ProgressLine[]; reading: Reading; findings: Finding[]; clients: (ClientPage & { sort: string; withProblems: number; clean: number; accounts: number }) | null;
  summary: string; scope: "all" | "account"; staleDays: number; slaHours: number; targetMinutes: number; readLimit: string | null; now: number;
  brand: { name: string | null; color: string | null; logoUrl?: string | null }; generatedAt: string; hiddenAccounts: number; focus: { id: string; name: string } | null;
  canShare: boolean; demo: boolean; shareDays: number;
  history?: History | null; au?: { history: boolean; onepager: boolean; monthly: boolean };
};

// ?aufx=1 shows a small typed sample of the history blocks (labelled "Sample data"); the real path never reads it. The shell may drop the query, so it is remembered at load.
const FX = /[?&]aufx=1/;
let fxOn = false;
if (typeof window !== "undefined") fxOn = FX.test(window.location.href);

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const longDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function specOf(f: Finding, d: Data): RecordsSpec {
  return itemsSpec(f.items, d.now, {
    key: `audit-${f.key}`, title: LIST_TITLE[f.key], noun: f.count === 1 ? f.noun.one : f.noun.many, count: f.count, exportName: `audit-${f.key}`,
    subtitle: f.what,
    note: f.partial || f.items.length < f.count ? `SubSync loaded the first ${num(f.items.length)} of ${num(f.count)}. The number in the title is the true count.` : null,
  });
}

export function AuditView() {
  const api = useApiClient();
  const [focus, setFocus] = useState<string | null>(null);
  const [runs, setRuns] = useState(0);
  const path = useMemo(() => {
    const sp = new URLSearchParams();
    if (focus) sp.set("location", focus);
    if (runs > 0) { sp.set("fresh", "1"); sp.set("r", String(runs)); }
    const q = sp.toString();
    return q ? `audit?${q}` : "audit";
  }, [focus, runs]);
  const live = useData<Data>(path);
  const { error, loading, reload } = live;
  const histPath = live.data?.au?.history && !fxOn ? `audit?${new URLSearchParams({ part: "history", ...(focus ? { location: focus } : {}), ...(runs > 0 ? { r: String(runs) } : {}) }).toString()}` : null;
  const hist = useData<{ history: History | null }>(histPath);
  const data = useMemo<Data | null>(() => (fxOn ? (sampleAudit() as unknown as Data) : live.data ? { ...live.data, history: hist.data?.history ?? null } : null), [live.data, hist.data]);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [spec, setSpec] = useState<RecordsSpec | null>(null);
  const [copied, setCopied] = useState<"summary" | "link" | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [all, setAll] = useState(false);
  const [cq, setCq] = useState("");
  const [csort, setCsort] = useState("money");
  const [cpage, setCpage] = useState(0);
  const [debounced, setDebounced] = useState("");
  const loadLinks = useCallback(() => { api.get<{ links: ShareLink[] }>("audit/shares").then((r) => setLinks(r.links)).catch(() => setLinks([])); }, [api]);
  useEffect(() => { loadLinks(); }, [loadLinks]);
  useEffect(() => { const t = setTimeout(() => { setDebounced(cq); setCpage(0); }, 300); return () => clearTimeout(t); }, [cq]);
  // While the first read of the accounts runs, the page looks again on its own, so the numbers fill in without a reload.
  const reading = data?.reading.reading === true;
  useEffect(() => {
    if (!reading) return;
    const t = setInterval(() => { void reload(); }, 20_000);
    return () => clearInterval(t);
  }, [reading, reload]);

  const clientsPath = all && data?.clients
    ? `audit/clients?${new URLSearchParams({ q: debounced, sort: csort, page: String(cpage), size: "10", ...(focus ? { location: focus } : {}), ...(runs ? { r: String(runs) } : {}) }).toString()}`
    : null;
  const list = useData<ClientPage & { sort: string; withProblems: number; clean: number; accounts: number }>(clientsPath);

  const revoke = async (id: string) => { try { await api.post("audit/revoke", { id, typed: id.slice(-6) }); setRevoking(null); setTyped(""); } finally { loadLinks(); } };
  const share = async () => {
    setSharing(true); setLinkError(null);
    try { setLink((await api.post<{ url: string }>("audit/share", focus ? { location: focus } : {})).url); loadLinks(); } catch { setLink(null); setLinkError("Could not create a link. Try again."); } finally { setSharing(false); }
  };
  const copy = async (text: string, what: "summary" | "link") => {
    try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(null), 2500); } catch { window.prompt(what === "link" ? "Copy this link" : "Copy this summary", text); }
  };

  if (loading && !data) return <Page title="Account audit" subtitle="Checking what is wrong and what it costs."><SkeletonCards cards={3} label="Auditing your accounts..." /></Page>;
  if (error && !fxOn) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return null;

  const first = data.findings.find((f) => f.key === data.startHere) ?? null;
  const open = (f: Finding) => setSpec(specOf(f, data));
  const accent = printAccent(data.brand.color);
  const accountWord = data.totals.accounts === 1 ? "account" : "client accounts";
  const accountsLine = data.scope === "all" && data.totals.accounts > 0
    ? (data.totals.accounts > data.totals.accountsWithProblems ? `${num(data.totals.accounts - data.totals.accountsWithProblems)} of ${num(data.totals.accounts)} client accounts have nothing to fix.` : data.totals.accountsWithProblems > 0 ? `All ${num(data.totals.accounts)} client accounts have something to fix.` : null) : null;

  const menu: MenuItem[] = [
    { key: "again", label: "Run the audit again", onSelect: () => setRuns((n) => n + 1) },
    ...(data.canShare ? [{ key: "share", label: sharing ? "Creating link..." : data.au?.onepager ? "Make a one-pager link for a client" : "Share a link with a client", onSelect: () => { void share(); }, disabled: sharing }] : []),
    { key: "copy", label: copied === "summary" ? "Copied" : "Copy a summary", onSelect: () => { void copy(data.summary, "summary"); } },
    { key: "print", label: "Print", onSelect: () => window.print() },
    ...(data.demo ? [{ key: "sample", label: "See a sample to send a client", onSelect: () => { window.open(`/audit/${SAMPLE_AUDIT_ID}`, "_blank", "noopener"); } }] : []),
  ];

  const empty = data.totals.accounts === 0;

  return (
    <Page
      title="Account audit"
      subtitle={data.focus ? `Only ${data.focus.name}.` : data.scope === "all" ? "What is leaking across your client accounts, and what to fix first." : "What is leaking in your account, and what to fix first."}
      actions={<PopMenu label="More: share, print or run again" items={menu} testId="audit-more" triggerClassName="ds-press inline-flex h-11 items-center gap-1.5 rounded-lg border bg-card px-3 text-sm font-medium hover:border-primary/40 sm:h-9"><MoreHorizontal aria-hidden className="size-4" /><span>More</span></PopMenu>}
    >
      <div className="audit-print">
        <style dangerouslySetInnerHTML={{ __html: printCss(data.brand.color) }} />
        {/* The printed page opens with the sender's own name and colour. Nothing else carries a product name. */}
        <div className="mb-4 hidden border-b-2 pb-3 print:block" data-testid="audit-print-header" style={{ borderColor: accent ?? "var(--primary)" }}>
          {data.brand.logoUrl && <BrandLogo url={data.brand.logoUrl} name={data.brand.name} height={40} className="mb-2" fallback={null} />}
          <p className="text-xl font-semibold" style={{ color: accent ?? "var(--primary)" }}>{data.brand.name ?? "Account audit"}</p>
          <p className="text-sm text-muted-foreground">{data.brand.name ? "Account audit" : "Prepared"} for {data.totals.accounts} {accountWord}, {longDate(data.generatedAt)}</p>
        </div>

        {data.focus && (
          <p className="mb-4 text-sm text-muted-foreground print:hidden" data-testid="audit-focus">
            Showing only <span className="font-medium text-foreground">{data.focus.name}</span>. <button type="button" className="min-h-8 text-primary underline underline-offset-4 max-sm:min-h-11" onClick={() => { setFocus(null); setAll(false); setCpage(0); }}>Show all clients</button>
          </p>
        )}
        {fxOn && <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground" role="status" data-testid="audit-sample">Sample data. Fictional clients, nothing here is read from your accounts.</p>}
        <ReadingStrip r={data.reading} />
        {linkError && <InlineAlert tone="danger" className="mb-4">{linkError}</InlineAlert>}
        {link && (
          <InlineAlert tone="success" className="mb-4 break-all" action={<Btn onClick={() => copy(link, "link")}>{copied === "link" ? "Copied" : "Copy link"}</Btn>}>
            Send this link. It shows the sentence, the figures, what to fix{data.au?.onepager ? ", then and now" : ""} and how each number is counted. It has no client names and works for {data.shareDays} days. You can switch it off below: <a className="font-medium underline" href={link} target="_blank" rel="noreferrer">{link}</a>
          </InlineAlert>
        )}

        {empty ? (
          <EmptyState title="No client accounts to audit yet" body="Client accounts appear here as SubSync reads them for the first time. It usually takes a few minutes." />
        ) : (
          <>
            <VerdictBlock staleDays={data.staleDays} v={data.verdict} grade={data.grade?.line ?? null} accountsLine={accountsLine} start={first} onStart={() => first && open(first)} extra={<SinceLine history={data.history ?? null} />} />

            <Section title={data.findings.length === 0 ? "What needs fixing" : `What needs fixing (${data.findings.length})`} hint="Biggest money first. Among equals, the quick fixes come first.">
              {data.findings.length === 0 ? (
                <EmptyState compact title="Nothing to fix" body="Nobody is waiting, no deal has gone quiet and every appointment has an outcome. Run the audit again after your next refresh." />
              ) : (
                <ol className="@container divide-y border-y" data-testid="audit-findings">
                  {data.findings.map((f, i) => <FindingRow key={f.key} f={f} n={i + 1} onShow={() => open(f)} />)}
                </ol>
              )}
              {data.notes.length > 0 && <ul className="mt-2 space-y-1 text-xs text-muted-foreground" data-testid="audit-notes">{data.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
              {data.readLimit && <p className="mt-2 text-xs text-muted-foreground">{data.readLimit}</p>}
            </Section>

            {data.au?.history && data.history && (
              <ThenNow history={data.history} sample={fxOn} openable={new Set(data.findings.map((f) => f.key as CountKey))} onOpen={(k) => { const f = data.findings.find((x) => x.key === k); if (f) open(f); }} />
            )}
            {data.au?.history && data.history && data.scope === "all" && (
              <NewAccounts history={data.history} sample={fxOn} onAudit={(id) => { setFocus(id); setAll(false); window.scrollTo?.({ top: 0, behavior: "smooth" }); }} />
            )}

            {data.clients && data.clients.withProblems > 0 && (
              <Section title="Clients to look at first" hint="Ranked by counted deal money plus the estimate. The two are shown separately, never added on screen." id="audit-clients">
                <ul className="@container divide-y border-y" data-testid="audit-clients">
                  {data.clients.rows.map((r) => <ClientRowView key={r.id} r={r} onOpen={() => { setFocus(r.id); setAll(false); window.scrollTo?.({ top: 0, behavior: "smooth" }); }} />)}
                </ul>
                {data.clients.withProblems > data.clients.rows.length && !all && (
                  <div className="mt-3 print:hidden"><Btn onClick={() => setAll(true)} testId="audit-see-all">{`See all ${num(data.clients.withProblems)} clients`}</Btn></div>
                )}
                {all && (
                  <div className="mt-4" data-testid="audit-all-clients">
                    <div className="mb-3 flex flex-wrap items-center gap-2 print:hidden">
                      <input type="search" aria-label="Search client accounts" placeholder="Search by name" value={cq} onChange={(e) => setCq(e.target.value)} className={`${clientControls.field} w-full sm:w-64`} data-testid="audit-search" />
                      <select aria-label="Order" value={csort} onChange={(e) => { setCsort(e.target.value); setCpage(0); }} className={clientControls.field} data-testid="audit-sort">
                        {clientControls.SORTS.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
                      </select>
                      <button type="button" className="min-h-11 px-2 text-sm text-muted-foreground underline underline-offset-4 sm:min-h-9" onClick={() => setAll(false)}>Show fewer</button>
                    </div>
                    {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : !list.data ? <p className="text-sm text-muted-foreground" role="status">Loading the clients...</p> : list.data.rows.length === 0 ? (
                      <EmptyState compact title="No client matches" body="Try a shorter name." />
                    ) : (
                      <>
                        <ul className="@container divide-y border-y">{list.data.rows.map((r) => <ClientRowView key={r.id} r={r} onOpen={() => { setFocus(r.id); setAll(false); window.scrollTo?.({ top: 0, behavior: "smooth" }); }} />)}</ul>
                        <Pager page={list.data} onPage={setCpage} label="Client pages" />
                      </>
                    )}
                  </div>
                )}
              </Section>
            )}

            <GoodNews lines={data.healthy} />
            <ProgressBlock lines={data.progress} />
          </>
        )}

        <p role="status" className="mt-6 text-xs text-muted-foreground" data-testid="audit-foot">
          Checked {new Date(data.generatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC from the latest refresh of {num(data.totals.accounts)} {accountWord}. Nothing here changes anything in your accounts.{" "}
          <button type="button" className="min-h-8 text-primary underline underline-offset-4 max-sm:min-h-11 print:hidden" onClick={() => setRuns((n) => n + 1)} data-testid="audit-rerun">Run again</button>
        </p>
      </div>

      {data.canShare && links.length > 0 && (
        <Card title="Your share links" className="mt-4 print:hidden">
          <ul className="divide-y text-sm">
            {links.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  Made {shortDate(l.createdAt)} · {l.revoked ? "switched off" : l.expired ? "expired" : `works until ${shortDate(l.expiresAt)}`} · opened {l.views} {l.views === 1 ? "time" : "times"}
                  <span className="ml-2 text-xs text-muted-foreground">ends ...{l.id.slice(-6)}</span>
                </span>
                {!l.revoked && !l.expired && revoking !== l.id && <Btn variant="ghost" onClick={() => { setRevoking(l.id); setTyped(""); }}>Switch off</Btn>}
                {revoking === l.id && (
                  <span className="flex w-full flex-wrap items-center gap-2" data-testid="audit-revoke-confirm">
                    <label className="text-xs text-muted-foreground" htmlFor={`rv-${l.id}`}>Type the last six characters, {l.id.slice(-6)}, to switch off this link</label>
                    <input id={`rv-${l.id}`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" className="h-11 w-32 rounded-lg border bg-background px-3 text-sm sm:h-9" />
                    <Btn variant="primary" disabled={typed !== l.id.slice(-6)} onClick={() => revoke(l.id)}>Switch off this link</Btn>
                    <Btn variant="ghost" onClick={() => { setRevoking(null); setTyped(""); }}>Keep it</Btn>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {data.au?.monthly && (!data.demo || fxOn) && <MonthlyCard sample={fxOn} />}
      {spec && <RecordsPanel key={spec.key} spec={spec} onClose={() => setSpec(null)} now={data.now} canExport={data.canShare || data.demo} />}
    </Page>
  );
}
