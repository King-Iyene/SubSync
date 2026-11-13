"use client";

import { useEffect, useMemo, useState } from "react";
import type { Rec, RecordsSpec } from "@/lib/analytics/today-records";
import type { Trend } from "@/lib/analytics/quality";
import { EmptyState, ErrorState, HowTo, InlineAlert, RecordsPanel, RowButton, Section, SkeletonCards, remember, remembered } from "../ds";
import { useApiClient, useData } from "../session";
import { fmtInt } from "../ui";
import { CleanupView } from "./cleanup";
import { BTN, FIELD, PRIMARY, QUIET, ScoreMeter, ScoreRing, TrendLine, plural } from "./cleanup-parts";

// Data quality (stage CLEANUP): one score per client account and for the whole portfolio, the clients to fix first, and for one client the exact problems with the exact
// contacts behind every number. SubSync only reads: it shows the fix, copies it as a CSV and opens each contact in your CRM. The same scan makes the number and the list,
// so the count on a row always equals the rows you open.

type Portfolio = {
  kind: "portfolio"; multi: boolean; portfolio: { score: number | null; accounts: number; scored: number; word: string | null }; trend: Trend; pending: number; scannedNow: number;
  totals: { contacts: number; duplicateGroups: number; problems: number };
  accounts: { rows: Array<{ locationId: string; name: string | null; score: number | null; word: string | null; contacts: number; day: string | null; duplicateGroups: number; problems: number }>; page: number; pages: number; total: number; from: number; to: number };
};
type Finding = { id: string; label: string; todo: string; group: string; groupLabel: string; fixable: boolean; count: number };
type AccountQ = {
  kind: "account"; examples: Record<string, { before: string; after: string } | null>; locationId: string; name: string | null; contacts: number; score: { score: number; word: string; parts: Record<string, number> } | null; partLabels: Record<string, string>; trend: Trend;
  minContacts: number; duplicates: { groups: number; extra: number; newGroups: number }; scannedAt: string; findings: Finding[];
};
type ListQ = { finding: string; label: string; todo: string; account: string | null; locationId: string; count: number; cut: boolean; rows: Array<{ id: string; name: string; email: string | null; phone: string | null; fix: Array<{ field: string; before: string; after: string }> | null; url: string }> };
type ImportRes = {
  total: number; shown: number; counts: Record<string, number>; rows: Array<{ row: number; name: string; email: string; phone: string; verdict: string; why: string; match: { id: string; name: string } | null; url: string | null }>;
  problem: string | null; accountName: string | null; cleanCsv: string; existingCount: number; found: { name: boolean; email: boolean; phone: boolean };
};

const FIELD_WORD: Record<string, string> = { email: "Email", phone: "Phone", firstName: "First name", lastName: "Last name" };
const VERDICT: Record<string, string> = { exists: "Already in this account", maybe: "Could already be here", again: "Twice in the file", new: "New", invalid: "Cannot work" };

function specOf(l: ListQ): RecordsSpec {
  const rows: Rec[] = l.rows.map((r) => ({
    id: r.id,
    cells: { name: r.name, email: r.email, phone: r.phone, fix: r.fix ? r.fix.map((f) => `${FIELD_WORD[f.field] ?? f.field}: ${f.before} to ${f.after}`).join("; ") : null, crm: r.url },
    url: r.url, lead: { contactId: r.id, locationId: l.locationId, name: r.name, account: l.account ?? "", note: l.label },
  }));
  return {
    key: `quality-${l.finding}-${l.locationId}`, title: l.label, subtitle: l.todo, noun: l.count === 1 ? "contact" : "contacts", count: l.count,
    cols: [
      { key: "name", header: "Name", type: "text", primary: true, w: 12 }, { key: "email", header: "Email", type: "text", w: 14 }, { key: "phone", header: "Phone", type: "text", w: 10 },
      { key: "fix", header: "Suggested fix", type: "text", w: 16 }, { key: "crm", header: "CRM", type: "link", w: 8 },
    ].filter((c) => c.primary || rows.some((r) => r.cells[c.key])) as RecordsSpec["cols"],
    rows, note: l.cut ? `SubSync loaded the first ${fmtInt(l.rows.length)} of ${fmtInt(l.count)}. Download the CSV for all of them.` : null, dateKey: null, preset: {}, exportName: `subsync-${l.finding}`,
  };
}

export function QualityTab({ canFix }: { canFix: boolean }) {
  const api = useApiClient();
  const [page, setPage] = useState(0);
  const [all, setAll] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [cc, setCc] = useState(() => remembered("quality-cc") ?? "");
  const [list, setList] = useState<{ spec: RecordsSpec } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  const top = useData<Portfolio>(picked ? null : `cleanup/quality?page=${page}&size=${all ? 25 : 5}`);
  const single = top.data && !top.data.multi && top.data.accounts.rows[0] ? top.data.accounts.rows[0].locationId : null;
  const loc = picked ?? single;
  const ccq = cc.replace(/\D/g, "").slice(0, 4);
  const acct = useData<AccountQ>(loc ? `cleanup/quality?account=${encodeURIComponent(loc)}${ccq ? `&cc=${ccq}` : ""}` : null);

  const open = async (f: Finding) => {
    setProblem(null);
    try {
      const l = await api.get<ListQ>(`cleanup/quality/list?account=${encodeURIComponent(loc!)}&finding=${f.id}${ccq ? `&cc=${ccq}` : ""}`);
      setList({ spec: specOf(l) });
    } catch (e) { setProblem((e as Error).message); }
  };
  const csv = (f: Finding) => api.download(`cleanup/quality/csv?account=${encodeURIComponent(loc!)}&finding=${f.id}${ccq ? `&cc=${ccq}` : ""}`, `subsync-${f.id}.csv`).catch((e: Error) => setProblem(e.message));
  useEffect(() => { remember("quality-cc", cc); }, [cc]);

  if (!picked && top.loading && !top.data) return <SkeletonCards cards={3} label="Scoring your contact lists..." />;
  if (!picked && top.error && !top.data) return <ErrorState error={top.error} onRetry={top.reload} />;
  const p = top.data;

  return (
    <div data-testid="quality-tab">
      <HowTo id="quality" title="How the score works">
        SubSync reads each client&apos;s contacts and finds what is missing, cannot work, needs tidying or is junk, then adds the duplicates. 100 means nothing to fix. It only reads: you see the exact fix and open the contact in your CRM.
      </HowTo>
      {problem && <div className="mb-4"><InlineAlert tone="danger" onDismiss={() => setProblem(null)}>{problem}</InlineAlert></div>}

      {!loc && p && (
        <>
          <section className="mb-6" aria-label="Data quality at a glance" data-testid="quality-head">
            <ScoreRing score={p.portfolio.score} word={p.portfolio.word} label="Data quality" testId="quality-score" />
            <p className="mt-2 text-sm text-muted-foreground">
              {p.portfolio.scored === 0 ? "No client has enough contacts to score yet." : `Across ${plural(p.portfolio.scored, "client account", "client accounts")}`}
              {` · ${fmtInt(p.totals.contacts)} contacts · ${plural(p.totals.problems, "problem", "problems")} to fix · ${plural(p.totals.duplicateGroups, "duplicate group", "duplicate groups")}`}
            </p>
            <div className="mt-2 max-w-md"><TrendLine trend={p.trend} label="Portfolio data quality" /></div>
            {p.pending > 0 && <p className="mt-2 text-sm text-muted-foreground" data-testid="quality-pending">{plural(p.pending, "client account is", "client accounts are")} scored overnight. They appear here tomorrow.</p>}
          </section>

          <Section title="Clients to fix first" hint="Lowest score first." id="quality-clients">
            {p.accounts.rows.length === 0 ? <EmptyState title="No client accounts yet" body="Connect a client account and SubSync scores its contacts." /> : (
              <ul data-testid="quality-clients">
                {p.accounts.rows.map((r) => (
                  <li key={r.locationId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t py-3" data-testid="quality-client">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{r.name ?? "Unnamed account"}</p>
                      <p className="text-sm text-muted-foreground">{r.score === null ? (r.day ? "Not enough contacts to score" : "Not scored yet") : `${r.score} out of 100 · ${r.word}`} · {fmtInt(r.contacts)} contacts · {plural(r.problems, "problem", "problems")} · {plural(r.duplicateGroups, "duplicate group", "duplicate groups")}</p>
                    </div>
                    <RowButton onClick={() => setPicked(r.locationId)} label="Open" sr={`${r.name ?? "this client"}'s data quality`} testId="quality-open" />
                  </li>
                ))}
              </ul>
            )}
            {p.accounts.total > 5 && (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                {!all ? <button type="button" className={BTN} onClick={() => { setAll(true); setPage(0); }} data-testid="quality-see-all">See all {fmtInt(p.accounts.total)} clients</button>
                  : <><span className="text-sm text-muted-foreground">Showing {fmtInt(p.accounts.from)} to {fmtInt(p.accounts.to)} of {fmtInt(p.accounts.total)}</span>
                    <span className="flex gap-2"><button type="button" className={BTN} disabled={p.accounts.page === 0} onClick={() => setPage(p.accounts.page - 1)}>Previous</button><button type="button" className={BTN} disabled={p.accounts.page >= p.accounts.pages - 1} onClick={() => setPage(p.accounts.page + 1)}>Next</button><button type="button" className={QUIET} onClick={() => { setAll(false); setPage(0); }}>Show fewer</button></span></>}
              </div>
            )}
          </Section>
        </>
      )}

      {loc && (
        <div data-testid="quality-account">
          {picked && <button type="button" className={`${QUIET} -ml-3 mb-2`} onClick={() => { setPicked(null); setList(null); }} data-testid="quality-back">Back to all clients</button>}
          {acct.loading && !acct.data ? <SkeletonCards cards={3} label="Reading this client's contacts..." /> : acct.error ? <ErrorState error={acct.error} onRetry={acct.reload} /> : acct.data && (
            <>
              <section className="mb-6" aria-label="This client's data quality">
                <h2 className="mb-2 text-lg font-semibold">{acct.data.name ?? "This client"}</h2>
                <ScoreRing score={acct.data.score?.score ?? null} word={acct.data.score?.word} label="Data quality" testId="quality-account-score" />
                {acct.data.score === null && <p className="mt-1 text-sm text-muted-foreground">A score needs at least {acct.data.minContacts} contacts; this client has {fmtInt(acct.data.contacts)}. The problems are still listed below.</p>}
                {acct.data.score && (
                  <ul className="mt-4 grid max-w-xl gap-x-6 gap-y-3 sm:grid-cols-2" data-testid="quality-parts">
                    {Object.entries(acct.data.partLabels).map(([k, label]) => <li key={k}><ScoreMeter score={acct.data!.score!.parts[k] ?? 0} label={label} testId={`quality-part-${k}`} /><p className="text-sm text-muted-foreground">{label}</p></li>)}
                  </ul>
                )}
                <div className="mt-3 max-w-md"><TrendLine trend={acct.data.trend} label={`${acct.data.name ?? "Client"} data quality`} /></div>
                <p className="mt-2 text-sm text-muted-foreground">{fmtInt(acct.data.contacts)} contacts read from SubSync&apos;s copy; {plural(acct.data.duplicates.groups, "duplicate group", "duplicate groups")} in the Duplicates tab.</p>
              </section>

              <FixCards findings={acct.data.findings} examples={acct.data.examples} onShow={(f) => void open(f)} />

              <Section title="Every kind of problem" hint="Each row opens the exact contacts. Counts equal the rows." id="quality-findings">
                <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                  <label htmlFor="q-cc" className="text-sm text-muted-foreground">Country code for local phone numbers</label>
                  <input id="q-cc" className={`${FIELD} w-24`} placeholder="+1" inputMode="tel" value={cc} onChange={(e) => setCc(e.target.value)} data-testid="quality-cc" />
                  <span className="text-sm text-muted-foreground">Left blank, a number without one is never guessed.</span>
                </div>
                {acct.data.findings.length === 0 ? <EmptyState title="Nothing to fix" body="No missing, broken or junk details were found in this client's contacts." /> : (
                  <ul data-testid="quality-findings-list">
                    {acct.data.findings.map((f, i) => (
                      <li key={f.id} className="border-t py-3" data-testid="quality-finding" data-finding={f.id}>
                        {(i === 0 || acct.data!.findings[i - 1].groupLabel !== f.groupLabel) && <p className="mb-1 text-sm font-medium uppercase tracking-wide text-muted-foreground">{f.groupLabel}</p>}
                        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium"><span className="tabular-nums" data-testid="finding-count">{fmtInt(f.count)}</span> {f.label.toLowerCase()}</p>
                            <p className="line-clamp-2 text-sm text-muted-foreground">{f.todo}</p>
                          </div>
                          <div className="flex items-center gap-1">
                            <button type="button" className={QUIET} onClick={() => void csv(f)} data-testid="finding-csv">{f.fixable ? "Copy the fixes as a CSV" : "Download as CSV"}<span className="sr-only"> for {f.label.toLowerCase()}</span></button>
                            <RowButton onClick={() => void open(f)} label="Show" sr={`${f.count} ${f.label}`} testId="finding-show" />
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </>
          )}
        </div>
      )}

      {loc && <ImportCheck locationId={loc} name={acct.data?.name ?? null} />}

      {canFix && (
        <Section title="Fix in bulk from SubSync" hint="Needs your say-so for each client first. You see every change before it happens and can undo it." id="quality-fix" className="mt-8">
          <details open data-testid="quality-bulk">
            <summary className="min-h-11 cursor-pointer text-sm font-medium">Open the bulk fixer</summary>
            <div className="mt-3"><CleanupView embedded /></div>
          </details>
        </Section>
      )}

      {list && <RecordsPanel key={list.spec.key} spec={list.spec} onClose={() => setList(null)} now={now} canExport />}
    </div>
  );
}

// ---------------- check before you import ----------------

// Three big cards for the three things most people want to do: fix phone numbers, fix emails, remove junk. Each says how many, shows one real before and after, and has one button.
function FixCards({ findings, examples, onShow }: { findings: Finding[]; examples: Record<string, { before: string; after: string } | null>; onShow: (f: Finding) => void }) {
  const by = (ids: string[]) => findings.filter((f) => ids.includes(f.id));
  const cards = [
    { id: "phones", title: "Fix phone numbers", ids: ["phone_format", "bad_phone", "placeholder_phone"], ex: examples.phone_format, empty: "Every phone number looks right." },
    { id: "emails", title: "Fix emails", ids: ["email_typo", "bad_email", "disposable_email"], ex: examples.email_typo, empty: "Every email looks right." },
    { id: "junk", title: "Remove junk", ids: ["test_record", "empty_record"], ex: null, empty: "No test or empty contacts." },
  ];
  return (
    <div className="mb-8 grid gap-4 md:grid-cols-3" data-testid="fix-cards">
      {cards.map((c) => {
        const fs = by(c.ids);
        const n = fs.reduce((s, f) => s + f.count, 0);
        const main = fs.slice().sort((a, b) => b.count - a.count)[0];
        return (
          <section key={c.id} className="flex flex-col rounded-xl border bg-card p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md motion-reduce:transform-none motion-reduce:transition-none" data-testid="fix-card" data-card={c.id} aria-label={c.title}>
            <h3 className="text-base font-semibold">{c.title}</h3>
            <p className="mt-2 text-4xl font-semibold tabular-nums" data-testid="fix-card-count">{fmtInt(n)}</p>
            <p className="text-sm text-muted-foreground">{n === 0 ? c.empty : c.id === "junk" ? "test or empty contacts" : c.id === "phones" ? "phone numbers need fixing" : "emails need fixing"}</p>
            {c.ex && n > 0 && <p className="mt-3 break-words text-sm" data-testid="fix-card-example"><span className="text-muted-foreground line-through">{c.ex.before}</span> <span aria-hidden="true">to</span><span className="sr-only">becomes</span> <span className="font-medium">{c.ex.after}</span></p>}
            <div className="mt-auto pt-4">{main && n > 0 ? <button type="button" className={PRIMARY} onClick={() => onShow(main)} data-testid="fix-card-show">Show them<span className="sr-only"> ({c.title.toLowerCase()})</span></button> : null}</div>
          </section>
        );
      })}
    </div>
  );
}

function ImportCheck({ locationId, name }: { locationId: string; name: string | null }) {
  const api = useApiClient();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<ImportRes | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const counts = useMemo(() => res?.counts ?? {}, [res]);

  const run = async () => {
    setBusy(true); setErr(null); setRes(null);
    try { setRes(await api.post<ImportRes>("cleanup/import-check", { locationId, csv: text })); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const readFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 1_500_000) { setErr("That file is too big to check here. Split it into files of 5,000 rows or fewer."); return; }
    setText(await f.text());
  };
  const copy = async () => { try { await navigator.clipboard.writeText(res!.cleanCsv); setCopied(true); } catch { setErr("Your browser would not copy it. Select the rows and copy them by hand."); } };
  const stats = useMemo(() => (res ? (["exists", "maybe", "again", "invalid", "new"] as const).filter((k) => (counts[k] ?? 0) > 0) : []), [res, counts]);

  return (
    <Section title="Check a file before you import it" hint={`Paste a list of people (Name, Email, Phone) and see who is already in ${name ?? "this client"}. The file is read here and never stored.`} id="quality-import" className="mt-8">
      <div className="grid gap-2">
        <textarea className="min-h-28 w-full rounded-lg border bg-card p-3 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30" placeholder={"Name,Email,Phone\nAda Lovelace,ada@example.co,+15550102030"} aria-label="The list to check, as CSV" value={text} onChange={(e) => { setText(e.target.value); setRes(null); }} data-testid="import-text" />
        <div className="flex flex-wrap items-center gap-2">
          <label className={`${BTN} cursor-pointer`}>Choose a CSV file<input type="file" accept=".csv,text/csv,text/plain" className="sr-only" onChange={(e) => void readFile(e.target.files?.[0])} data-testid="import-file" /></label>
          <button type="button" className={PRIMARY} disabled={busy || text.trim().length === 0} onClick={() => void run()} data-testid="import-run">{busy ? "Checking..." : "Check this list"}</button>
          <span className="text-sm text-muted-foreground">Up to 5,000 people at a time.</span>
        </div>
      </div>
      {err && <div className="mt-3"><InlineAlert tone="danger" onDismiss={() => setErr(null)}>{err}</InlineAlert></div>}
      {res && (
        <div className="mt-4" data-testid="import-result" role="status">
          {res.problem && <div className="mb-3"><InlineAlert tone="warning">{res.problem}</InlineAlert></div>}
          {res.total > 0 && (
            <>
              <p className="text-sm" data-testid="import-summary"><strong>{fmtInt(counts.new ?? 0)}</strong> of {fmtInt(res.total)} are new{stats.filter((k) => k !== "new").map((k) => `, ${fmtInt(counts[k])} ${VERDICT[k].toLowerCase()}`).join("")}. Compared with {fmtInt(res.existingCount)} contacts in {res.accountName ?? "this client"}.</p>
              <ul className="mt-2" data-testid="import-rows">
                {res.rows.filter((r) => r.verdict !== "new").slice(0, 100).map((r) => (
                  <li key={r.row} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t py-2.5 text-sm" data-verdict={r.verdict}>
                    <div className="min-w-0"><p className="truncate font-medium">Row {r.row}: {r.name || r.email || r.phone || "no details"}</p><p className="line-clamp-2 text-sm text-muted-foreground">{VERDICT[r.verdict]} · {r.why}{r.match ? ` (${r.match.name || "unnamed"})` : ""}</p></div>
                    {r.url ? <RowButton href={r.url} label="Open" sr={r.match?.name ?? "the contact"} /> : null}
                  </li>
                ))}
              </ul>
              {res.shown < res.total && <p className="mt-1 text-sm text-muted-foreground">The first {fmtInt(res.shown)} rows are listed; the numbers above cover the whole file.</p>}
              {(counts.new ?? 0) > 0 && <div className="mt-3"><button type="button" className={BTN} onClick={() => void copy()} data-testid="import-copy">{copied ? "Copied" : `Copy only the ${fmtInt(counts.new ?? 0)} new people (CSV)`}</button></div>}
            </>
          )}
        </div>
      )}
    </Section>
  );
}
