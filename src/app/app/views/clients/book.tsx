"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { COLUMN_HELP, USER_ENTERED_LABEL, type Filter } from "@/lib/analytics/clients-v2";
import { useApiClient, useData } from "../../session";
import type { GoFn } from "../../nav";
import { EmptyState, ErrorState, HeadlineBlock, HowTo, SkeletonRows } from "../../ds";
import { fmtMoney } from "../../ui";
import { PrimaryButton } from "../today-chrome";
import { ClientList } from "./book-all";
import { ClientRows, copyText, RenewalRows, type Editing } from "./book-rows";
import type { BookHome, BookOne } from "./types";

// The Clients book, rebuilt (docs/CLIENTS_REVIEW.md). One question: "which of my clients may leave, and what do they pay me?". Top to bottom: one sentence ("3 clients look at risk,
// 2 renewals due within 30 days, $4,200 a month at stake."), one button ("Check in with the 3 clients at risk"), the five clients who need you most (See all opens the whole book,
// searched and paged on the server), the renewals of the next 60 days, three plain figures, and the column help behind "More detail". Health is worked out by SubSync; fee, renewal
// date and industry are typed by the agency, in the row, and the screen says so.

const ListHead = ({ title, hint, right }: { title: string; hint?: React.ReactNode; right?: React.ReactNode }) => (
  <div className="mb-2 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
    <div className="min-w-0"><h2 className="text-lg font-semibold tracking-tight">{title}</h2>{hint && <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>}</div>
    {right}
  </div>
);
const SEE_ALL = "ds-press min-h-11 rounded-md px-2.5 text-sm font-medium text-primary underline-offset-4 hover:bg-muted hover:underline sm:min-h-9";

type ListSpec = { filter: Filter; autoEditFee?: boolean };

export function BookTab({ go, onOpen }: { go: GoFn; onOpen: (id: string) => void }) {
  const api = useApiClient();
  const [version, setVersion] = useState(0);
  const [list, setList] = useState<ListSpec | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [more, setMore] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const { data, error, loading, reload } = useData<BookHome>(`clients?part=home&v=${version}`);
  const changed = () => setVersion((v) => v + 1);
  const copy = async (id: string) => {
    try { const one = await api.get<BookOne>(`clients?part=one&id=${id}`); const ok = await copyText(one.summary); setCopied(ok ? `Summary of ${one.row.name} copied to your clipboard.` : null); } catch (e) { setCopied((e as Error).message); }
    setTimeout(() => setCopied(null), 3500);
  };

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <SkeletonRows rows={6} label="Reading your clients..." />;
  const d = data;
  const s = d.summary;
  if (s.total === 0) return <EmptyState title="No clients yet" body="Client accounts appear here once SubSync has finished its first read. It usually takes a few minutes." />;
  const stale = loading && version > 0;

  const primary = d.primary;
  const queueFirst = d.needs.ids[0] ?? null;
  const button = primary ? <PrimaryButton p={{
    label: primary.label, sr: primary.kind === "fee" ? "opens the first client's fee" : "opens the first client who needs you",
    onClick: () => (primary.kind === "fee" ? setList({ filter: "no_fee", autoEditFee: true }) : queueFirst ? onOpen(queueFirst) : setList({ filter: primary.filter ?? "needs" })),
  }} /> : undefined;
  const counts: Array<[Filter, number, string]> = [["at_risk", s.atRisk, "at risk"], ["watch", s.watch, "to watch"], ["healthy", s.healthy, "healthy"], ["new", s.newClients, "new"], ["not_read", s.notRead, "not read yet"]];

  return (
    <div className="ds-enter" data-testid="book" aria-busy={stale}>
      <HowTo id="clients-book" title="How this page works" action={<button type="button" onClick={() => go("help")} className="text-xs font-medium text-primary underline">More in Getting started</button>}>
        Health is worked out by SubSync from what it reads in your CRM. Fee, renewal date and industry are typed by you, right in the row: press <strong>Add fee</strong> or a date. {USER_ENTERED_LABEL} Value created and what to say to each client are on the client&apos;s page.
      </HowTo>

      {d.reading.reading && <p className="mb-4 text-sm text-muted-foreground" role="status" data-testid="book-reading">{d.reading.text}</p>}

      <HeadlineBlock headline={{ ...d.headline, breakdown: null, accounts: s.total, dollars: s.atRiskFee } as never} action={button}>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground" data-testid="book-support">
          {d.support}
          {s.noFees && primary?.kind !== "fee" && <> <button type="button" onClick={() => setList({ filter: "no_fee", autoEditFee: true })} className="ds-press min-h-9 font-medium text-primary underline underline-offset-4" data-testid="add-first-fee">Add your first client fee</button></>}
        </p>
        <p className="mt-2 flex flex-wrap items-center gap-x-1 text-sm text-muted-foreground" data-testid="book-counts">
          {counts.filter(([, n]) => n > 0).map(([f, n, word], i) => (
            <span key={f} className="inline-flex items-center">{i > 0 && <span aria-hidden className="mr-1">·</span>}
              <button type="button" onClick={() => setList({ filter: f })} className="ds-press min-h-9 rounded-md px-1 underline underline-offset-4 hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-[var(--ring)]" data-testid={`count-${f}`}>{n.toLocaleString("en-US")} {word}</button>
            </span>
          ))}
        </p>
        {d.next && <p className="mt-2 text-sm" data-testid="book-next"><span className="font-medium">Next best step.</span> {d.next}</p>}
      </HeadlineBlock>
      {copied && <p className="mb-3 text-sm text-muted-foreground" role="status" data-testid="book-copied">{copied}</p>}

      <div className={stale ? "opacity-70" : ""}>
        {list ? (
          <ClientList key={`${list.filter}-${list.autoEditFee ? "fee" : ""}`} initial={list.filter} version={version} autoEditFee={list.autoEditFee} onChanged={changed} onOpen={onOpen} onCopy={copy} onBack={() => setList(null)} />
        ) : (
          <>
            {d.needs.total > 0 && (
              <section className="mb-9" aria-label="Who needs you" data-testid="who-needs-you">
                <ListHead title="Who needs you"
                  hint={<span data-testid="needs-summary">{d.needs.total.toLocaleString("en-US")} {d.needs.total === 1 ? "client needs" : "clients need"} you. At risk first, then the ones to watch and renewals that are due.</span>}
                  right={d.needs.total > d.needs.rows.length ? <button type="button" onClick={() => setList({ filter: "needs" })} className={SEE_ALL} data-testid="needs-all">See all {d.needs.total.toLocaleString("en-US")} clients</button> : undefined} />
                <ClientRows rows={d.needs.rows} choices={d.industryChoices} inNeeds editing={editing} setEditing={setEditing} onChanged={changed} onOpen={onOpen} onCopy={copy} testId="needs-rows" />
              </section>
            )}

            {d.needs.total === 0 && (
              <section className="mb-9 border-y py-5" aria-label="All clear" data-testid="all-clear">
                <p className="font-medium">Nobody needs a check-in right now.</p>
                <p className="mt-1 text-sm text-muted-foreground">No client has gone quiet, has people waiting too long, or has a renewal due.</p>
                <button type="button" onClick={() => setList({ filter: "all" })} className={`${SEE_ALL} mt-2 -ml-2.5`} data-testid="all-clients">See all {d.facets.all.toLocaleString("en-US")} clients</button>
              </section>
            )}

            {d.renewals.total > 0 && (
              <section className="mb-9" aria-label="Renewals" data-testid="renewals">
                <ListHead title={`Renewals in the next ${d.renewals.windowDays} days`}
                  hint={<span data-testid="renewals-summary">{d.renewals.total.toLocaleString("en-US")} {d.renewals.total === 1 ? "renewal" : "renewals"}{d.renewals.fee > 0 ? `, ${fmtMoney(d.renewals.fee)} a month` : ""}. Soonest first{d.renewals.overdue > 0 ? `; ${d.renewals.overdue} overdue at the top` : ""}. The dates are typed by you.</span>}
                  right={d.renewals.total > d.renewals.rows.length ? <button type="button" onClick={() => setList({ filter: "renewing" })} className={SEE_ALL} data-testid="renewals-all">See all {d.renewals.total.toLocaleString("en-US")}</button> : undefined} />
                <RenewalRows rows={d.renewals.rows} onOpen={onOpen} />
              </section>
            )}

            <section className="mb-9" aria-label="At a glance" data-testid="glance">
              <h2 className="mb-2 text-lg font-semibold tracking-tight">At a glance</h2>
              <dl className="grid gap-x-8 gap-y-5 border-y py-4 sm:grid-cols-3">
                <Figure label="Monthly fees" value={s.noFees ? "Not set up yet" : fmtMoney(s.feeTotal)} sub={s.noFees ? undefined : `${s.feeCount} of ${s.total} clients have a fee`} help={COLUMN_HELP.monthlyFees}
                  action={s.noFees || s.feeCount < s.total ? <button type="button" onClick={() => setList({ filter: "no_fee", autoEditFee: true })} className="ds-press mt-1 min-h-9 text-sm font-medium text-primary underline underline-offset-4" data-testid="glance-add-fee">{s.noFees ? "Add your first client fee" : `Add the ${s.total - s.feeCount} missing`}</button> : undefined} />
                <Figure label="Fees at risk" value={s.noFees ? "Needs fees" : fmtMoney(s.atRiskFee)} sub={s.atRisk === 0 ? "No client looks at risk" : `${s.atRisk} ${s.atRisk === 1 ? "client" : "clients"} at risk`} help={COLUMN_HELP.feesAtRisk} />
                <Figure label={`Renewals in ${d.renewals.windowDays} days`} value={s.noRenewals ? "No dates yet" : String(s.renewals60)} sub={s.noRenewals ? undefined : s.renewals60Fee > 0 ? `${fmtMoney(s.renewals60Fee)} a month` : undefined} help={COLUMN_HELP.renewals} />
              </dl>
            </section>
          </>
        )}
      </div>

      <section className="mb-4 border-t pt-4 print:hidden" aria-label="More detail">
        <button type="button" onClick={() => setMore(!more)} aria-expanded={more} data-testid="book-more-toggle"
          className="ds-press inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-[var(--ring)]">
          What each column means<ChevronDown aria-hidden className={`size-4 transition-transform ${more ? "rotate-180" : ""}`} />
        </button>
        {more && (
          <dl className="mt-3 grid gap-4 sm:grid-cols-2" data-testid="column-help">
            {([["Health", "health"], ["Fee", "fee"], ["Renews", "renews"], ["Industry", "industry"]] as const).map(([name, k]) => (
              <div key={k}><dt className="font-medium">{name}</dt><dd className="text-sm text-muted-foreground"><span className="block">{COLUMN_HELP[k][0]}</span><span className="block">{COLUMN_HELP[k][1]}</span></dd></div>
            ))}
          </dl>
        )}
        <p className="mt-4 text-xs text-muted-foreground">{d.readLimit ? `${d.readLimit} ` : ""}Replies are judged against a {d.targetMinutes}-minute target over the last 14 days; people waiting, no-shows and quiet deals are counted by the same rules as Today and Account audit.</p>
      </section>
    </div>
  );
}

function Figure({ label, value, sub, help, action }: { label: string; value: string; sub?: string; help: [string, string]; action?: React.ReactNode }) {
  return (
    <div className="min-w-0" data-testid="glance-figure">
      <dt className="text-sm font-medium">{label}</dt>
      <dd>
        <span className={`tnum block ${value.length > 9 ? "text-base" : "text-2xl"} font-semibold leading-8`}>{value}</span>
        {sub && <span className="block text-sm text-muted-foreground">{sub}</span>}
        {action}
        <span className="mt-1 block text-xs leading-5 text-muted-foreground"><span className="block">{help[0]}</span><span className="block">{help[1]}</span></span>
      </dd>
    </div>
  );
}

