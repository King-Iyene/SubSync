"use client";

import { useCallback, useEffect, useState } from "react";
import { useApiClient, useData } from "../session";
import type { GoFn } from "../nav";
import { DataList, DefinitionTip, DrillPanel, EmptyState, HowTo, InlineAlert, Page, SkeletonRows, useDrill, type Column } from "../ds";
import { Badge, Btn, Card, ErrorBox, ExtLink, fmtMoney, Stat, type Tone } from "../ui";
import { fixFirstFinding, openLabel, type Audit, type AuditNote, type Finding, type FindingKey, type NoteKey } from "@/lib/analytics/audit-intel";
import type { AuditList, AuditListRow } from "@/lib/analytics/audit-queries";
import { SAMPLE_AUDIT_ID } from "@/lib/analytics/share-intel";
import { printAccent, printCss } from "@/lib/design/print";
import { BrandLogo, ProductMark } from "../brand-logo";

type Row = AuditListRow & { url: string };
type ListData = Omit<AuditList, "rows"> & { rows: Row[] };
type ShareLink = { id: string; url: string; createdAt: string; expiresAt: string; revoked: boolean; expired: boolean; views: number; lastViewedAt: string | null };
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const longDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

type Data = {
  audit: Audit; summary: string;
  /** The rows behind each finding that has a list (KF-6), from the same accounts and the same rules as the numbers. */
  lists: Partial<Record<FindingKey, ListData>> | null;
  readLimit: string | null; hiddenAccounts: number;
  brand: { name: string | null; color: string | null; logoUrl?: string | null };
  canShare: boolean; demo: boolean; shareDays: number; generatedAt: string;
};

const tone: Record<Finding["severity"], Tone> = { critical: "bad", warning: "warn", info: "info" };
const label: Record<Finding["severity"], string> = { critical: "Urgent", warning: "Soon", info: "Good to know" };

// What each list is called, and what its rows are.
const LIST_TITLE: Partial<Record<FindingKey, { title: string; noun: string; one: string }>> = {
  stale: { title: "Deals that stopped moving", noun: "deals", one: "deal" },
  slow: { title: "Conversations waiting for a reply", noun: "conversations", one: "conversation" },
  unmarked: { title: "Appointments with no outcome", noun: "appointments", one: "appointment" },
  noshows: { title: "No-shows not rebooked", noun: "no-shows", one: "no-show" },
};

const rowColumns: Array<Column<Row>> = [
  { key: "name", header: "Contact", primary: true, width: "minmax(0,1.5fr)", cell: (r) => r.name },
  { key: "account", header: "Client account", width: "minmax(0,1.2fr)", cell: (r) => <span className="text-muted-foreground">{r.locationName ?? ""}</span> },
  { key: "what", header: "What", width: "minmax(0,2.2fr)", cell: (r) => <span className="text-muted-foreground">{r.detail}</span> },
  { key: "open", header: "", width: "8.5rem", align: "right", cell: (r) => <ExtLink href={r.url}>Open in your CRM</ExtLink> },
];

// Instant audit: what is wrong across the accounts right now and what it is costing. Money that is counted from deals is labelled a fact; money inferred
// from a win rate is labelled an estimate and kept apart. Every number has its definition one tap away and opens the list it was counted from.
export function AuditView({ go }: { go: GoFn }) {
  const { data, error, loading, reload } = useData<Data>("audit");
  const api = useApiClient();
  const drill = useDrill();
  const [copied, setCopied] = useState<"summary" | "link" | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [links, setLinks] = useState<ShareLink[]>([]);
  const loadLinks = useCallback(() => { api.get<{ links: ShareLink[] }>("audit/shares").then((r) => setLinks(r.links)).catch(() => setLinks([])); }, [api]);
  useEffect(() => { loadLinks(); }, [loadLinks]);
  // A list that has just been opened is brought into view, so pressing a number at the top of the page does not look like nothing happened.
  useEffect(() => { if (drill.open) document.getElementById("audit-drill")?.scrollIntoView({ block: "nearest" }); }, [drill.open, drill.selected]);
  const revoke = async (id: string) => { try { await api.post("audit/revoke", { id }); } finally { loadLinks(); } };
  if (loading && !data) return <Page title="Account audit" subtitle="Checking every account you can see."><SkeletonRows rows={4} label="Auditing your accounts..." /></Page>;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const a = data.audit;
  const notes = new Map<NoteKey, AuditNote>(a.notes.map((n) => [n.key, n]));
  const tip = (key: NoteKey | undefined, term: React.ReactNode) => (key && notes.get(key) ? <DefinitionTip term={term} label="How this is counted">{notes.get(key)!.text}</DefinitionTip> : term);

  const indexOf = (key: FindingKey) => a.findings.findIndex((f) => f.key === key);
  const listFor = (f: Finding) => data.lists?.[f.key] ?? null;
  const canOpenList = (f: Finding) => Boolean(LIST_TITLE[f.key]) && (f.count ?? 0) > 0 && listFor(f) !== null;
  const picked = drill.selected !== null ? a.findings[drill.selected] : undefined;
  const pickedList = picked ? listFor(picked) : null;
  const staleIdx = indexOf("stale");
  const slowIdx = indexOf("slow");
  const stale = staleIdx >= 0 ? a.findings[staleIdx] : null;
  const first = fixFirstFinding(a);
  const accent = printAccent(data.brand.color);

  const share = async () => {
    setSharing(true); setLinkError(null);
    try { setLink((await api.post<{ url: string }>("audit/share")).url); loadLinks(); } catch { setLink(null); setLinkError("Could not create a link. Try again."); } finally { setSharing(false); }
  };
  const copy = async (text: string, what: "summary" | "link") => {
    try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(null), 2500); } catch { window.prompt(what === "link" ? "Copy this link" : "Copy this summary", text); }
  };
  const listButton = (f: Finding, i: number) => canOpenList(f) ? (
    <Btn onClick={() => drill.select(i)}>Show the {(f.count ?? 0).toLocaleString("en-US")} {f.count === 1 ? LIST_TITLE[f.key]!.one : LIST_TITLE[f.key]!.noun}</Btn>
  ) : null;

  return (
    <Page
      title="Account audit"
      subtitle={a.headline}
      actions={<>
        {data.canShare && <Btn onClick={share} disabled={sharing}>{sharing ? "Creating link..." : "Share link"}</Btn>}
        <Btn onClick={() => window.print()}>Print</Btn>
        <Btn variant="primary" onClick={() => copy(data.summary, "summary")}>{copied === "summary" ? "Copied" : "Copy summary"}</Btn>
      </>}
    >
      <div className="audit-print">
        <style dangerouslySetInnerHTML={{ __html: printCss(data.brand.color) }} />
        {/* The printed page opens with the sender's own name and colour. Nothing else carries a product name. */}
        <div className="mb-4 hidden border-b-2 pb-3 print:block" data-testid="audit-print-header" style={{ borderColor: accent ?? "var(--primary)" }}>
          <BrandLogo url={data.brand.logoUrl} name={data.brand.name} height={40} className="mb-2" fallback={<ProductMark height={40} className="mb-2" />} />
          <p className="text-xl font-semibold" style={{ color: accent ?? "var(--primary)" }}>{data.brand.name ?? "Account audit"}</p>
          <p className="text-sm text-muted-foreground">{data.brand.name ? "Account audit" : "Prepared"} for {a.accountsScanned} client {a.accountsScanned === 1 ? "account" : "accounts"}, {longDate(data.generatedAt)}</p>
        </div>

        <HowTo id="audit-how" title="How to use the audit">
          Start with the line that says what to fix first. Press any number to see the exact deals, conversations or appointments behind it, and the small question mark to see how it is counted. When it is ready for a client, press Share link: it has no client names and works for {data.shareDays} days.
        </HowTo>

        {data.demo && (
          <InlineAlert tone="info" className="mb-4">Sharing is switched off in the demo. <a className="font-medium underline" href={`/audit/${SAMPLE_AUDIT_ID}`} target="_blank" rel="noreferrer">Open the sample audit</a> to see what a client would receive.</InlineAlert>
        )}
        {linkError && <InlineAlert tone="danger" className="mb-4">{linkError}</InlineAlert>}
        {link && (
          <InlineAlert tone="success" className="mb-4 break-all" action={<Btn onClick={() => copy(link, "link")}>{copied === "link" ? "Copied" : "Copy link"}</Btn>}>
            Share this link. It covers the {a.accountsScanned} client {a.accountsScanned === 1 ? "account" : "accounts"} in this audit and shows totals, finding titles, the fix plan and how each number is counted. It has no client names and works for {data.shareDays} days. You can switch it off at any time below: <a className="font-medium underline" href={link} target="_blank" rel="noreferrer">{link}</a>
          </InlineAlert>
        )}
        {data.canShare && <p className="mb-4 text-xs text-muted-foreground print:hidden">Printing from this page includes your client account names. For a copy without names to send to a client, press Share link and print that page.</p>}

        {first && (
          <div className="mb-5 border-l-2 border-primary pl-4" data-testid="audit-fix-first">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What to fix first</p>
            <p className="mt-1 text-base font-medium">{data.audit.fixFirst}</p>
            <div className="mt-2 flex flex-wrap gap-2 print:hidden">
              {listButton(first, a.findings.indexOf(first))}
              <Btn onClick={() => go(first.view)}>{openLabel(first.view)}</Btn>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-x-10 gap-y-6 sm:grid-cols-2">
          <div>
            <Stat
              label={tip("stale", "Deals that stopped moving")} value={fmtMoney(a.staleDollars)} tone={a.staleDollars > 0 ? "warn" : undefined}
              sub={<>
                <Badge tone="neutral">Counted</Badge> {stale ? stale.window : "No deal has stopped moving"}.
                {a.outlier && <span className="mt-1 block">One deal ({fmtMoney(a.outlier.value)}) is {Math.round(a.outlier.share * 100)}% of this figure, so check that it is a real deal before relying on it.</span>}
              </>}
            />
            {stale && canOpenList(stale) && <div className="mt-2 print:hidden"><button type="button" className="min-h-9 text-xs font-medium text-primary underline" onClick={() => drill.select(staleIdx)}>Show the {stale.count?.toLocaleString("en-US")} {stale.count === 1 ? "deal" : "deals"} behind this</button></div>}
          </div>
          <div>
            <Stat
              label={<>{tip("estimate", "Cost of slow follow-up")} <Badge tone="info">Estimate</Badge></>}
              value={a.estimatedDollars === null ? <span className="text-base font-normal text-muted-foreground">Not enough data</span> : fmtMoney(a.estimatedDollars)}
              sub={a.estimatedDollars === null
                ? "Needs at least 20 won or lost deals in an account. Until then no dollar figure is shown."
                : <>{a.estimateRange && <span className="mb-1 block">Most likely between {fmtMoney(a.estimateRange.low)} and {fmtMoney(a.estimateRange.high)}.</span>}Waiting conversations x average deal x each account&apos;s win rate. A rough size of the problem, not money lost. Never added to the figure beside it.</>}
            />
            {slowIdx >= 0 && canOpenList(a.findings[slowIdx]) && <div className="mt-2 print:hidden"><button type="button" className="min-h-9 text-xs font-medium text-primary underline" onClick={() => drill.select(slowIdx)}>Show the {a.findings[slowIdx].count?.toLocaleString("en-US")} waiting {a.findings[slowIdx].count === 1 ? "conversation" : "conversations"}</button></div>}
          </div>
        </div>
        {(a.leftOut > 0 || data.hiddenAccounts > 0 || data.readLimit) && (
          <div className="mt-3 space-y-1 text-xs text-muted-foreground">
            {a.leftOut > 0 && <p>{tip("left_out", `${a.leftOut.toLocaleString("en-US")} open ${a.leftOut === 1 ? "deal is" : "deals are"} left out of every dollar figure`)} (no value, no owner, or in a closed-out stage).</p>}
            {data.hiddenAccounts > 0 && <p className="print:hidden">{data.hiddenAccounts} client {data.hiddenAccounts === 1 ? "account is" : "accounts are"} left out by the filter at the top of the app. A share link made now covers only the accounts shown here.</p>}
            {data.readLimit && <p>{data.readLimit}</p>}
          </div>
        )}

        <h2 className="mb-3 mt-6 text-base font-semibold">What needs fixing</h2>
        {a.findings.length === 0 ? (
          <EmptyState title="Nothing urgent" body="No stale deals, waiting conversations or unmarked appointments across the accounts you can see. Run it again after your next sync." />
        ) : (
          <ul className="divide-y border-y">
            {a.findings.map((f, i) => (
              <li key={f.key + i} className="ds-row grid gap-x-8 gap-y-3 px-1 py-4 md:grid-cols-[minmax(0,1fr)_auto]" data-testid="audit-finding">
                <div className="min-w-0">
                  <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Badge tone={tone[f.severity]}>{label[f.severity]}</Badge>
                    {f.kind === "estimate" && <Badge tone="info">Estimate</Badge>}
                    {f.kind === "fact" && tip(f.note, <Badge tone="neutral">Counted</Badge>)}
                    {f.kind !== "fact" && f.note && f.note !== "estimate" && tip(f.note, <span className="text-xs text-muted-foreground">How this is counted</span>)}
                  </div>
                  <p className="font-medium">{f.title}</p>
                  <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{f.detail}</p>
                  {f.window && <p className="mt-1 text-xs text-muted-foreground">Counted over: {f.window}.</p>}
                  <p className="mt-2 text-sm"><span className="font-medium">What to do:</span> {f.fix}</p>
                </div>
                <div className="flex flex-wrap content-start gap-2 md:w-56 md:flex-col md:items-stretch print:hidden [&>button]:justify-center">
                  {listButton(f, i)}
                  <Btn variant={canOpenList(f) ? "ghost" : "secondary"} onClick={() => go(f.view)}>{openLabel(f.view)}</Btn>
                </div>
              </li>
            ))}
          </ul>
        )}

        {picked && pickedList && LIST_TITLE[picked.key] && (
          <div id="audit-drill" className="print:hidden">
            <DrillPanel
              drill={drill} title={LIST_TITLE[picked.key]!.title} count={picked.count ?? pickedList.total} noun={picked.count === 1 ? LIST_TITLE[picked.key]!.one : LIST_TITLE[picked.key]!.noun}
              rows={pickedList.rows} columns={rowColumns} rowKey={(r) => r.id} backLabel="Back to the audit" empty="Nothing behind this one right now."
              toLead={(r) => ({ contactId: r.contactId, locationId: r.locationId, name: r.name, locationName: r.locationName, url: r.url, note: r.detail })}
            />
          </div>
        )}

        {a.rows.length > 0 && (
          <Card title="Where to start" className="mt-6">
            <DataList rows={a.rows} rowKey={(r) => r.locationId} onOpen={(r) => go("account", r.locationId)} caption="Where to start"
              columns={[
                { key: "name", header: "Client account", primary: true, width: "minmax(0,1.5fr)", cell: (r) => r.name },
                { key: "stale", header: "Stale deals", width: "minmax(0,1.5fr)", cell: (r) => <span className="text-muted-foreground">{fmtMoney(r.staleValue)} stale in {r.staleOpps} {r.staleOpps === 1 ? "deal" : "deals"}</span> },
                { key: "waiting", header: "Waiting", width: "6rem", cell: (r) => <span className="text-muted-foreground">{r.waiting} waiting</span> },
                { key: "est", header: "Estimate", width: "minmax(0,1.2fr)", cell: (r) => <span className="text-muted-foreground">{r.estimated !== null ? `about ${fmtMoney(r.estimated)} (estimate)` : "no estimate"}</span> },
              ]} />
            <p className="mt-2 text-xs text-muted-foreground print:hidden">Press a client account to open its own page; the way back is at the top.</p>
          </Card>
        )}
        <p className="mt-4 text-xs text-muted-foreground">{a.accountsScanned} client {a.accountsScanned === 1 ? "account" : "accounts"} checked just now from the latest sync. Nothing here changes anything in your accounts.</p>
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
                {!l.revoked && !l.expired && <Btn variant="ghost" onClick={() => revoke(l.id)}>Switch off</Btn>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Page>
  );
}
