import type { CSSProperties } from "react";
import Link from "next/link";
import { DEAL_RULE_HISTORY } from "@/lib/analytics/definitions";
import type { SharePayload } from "@/lib/analytics/share-intel";
import { accentTokens, parseHex } from "@/lib/design/color";
import { printAccent } from "@/lib/design/print";
import { PrintButton } from "./print-button";
import { BrandLogo } from "@/app/app/brand-logo";

// The page a client or prospect receives (stage F6): one honest, client-ready report. Counted facts and estimates are kept apart and labelled; every number
// has its definition on the page; there is a fix plan and a next step; the sender's own name and colour are on it (N85); nothing names a client account.
// It is plain markup with its own small stylesheet (no app shell, no script except the print button), so it prints the same everywhere. The lists behind
// the numbers stay in the app: a shared page holds only what is in the snapshot.

const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const DEFAULT_SCREEN_ACCENT = "#4db3dc";
const DEFAULT_PRINT_ACCENT = "#0a658b";

/** The colours of the page: the sender's colour where it can be read, nudged as little as needed, on the dark screen and on white paper. */
export function reportAccents(brandColor: string | null | undefined): { screen: string; print: string } {
  const ok = brandColor && parseHex(brandColor) ? brandColor : null;
  return { screen: (ok && accentTokens(ok, "dark")?.text) || DEFAULT_SCREEN_ACCENT, print: printAccent(ok) ?? DEFAULT_PRINT_ACCENT };
}

export const REPORT_CSS = `
@page { margin: 14mm; }
.audit-root { background: #000c25; color: #f1f5fb; min-height: 100vh; line-height: 1.5; font-family: var(--font-geist-sans, system-ui), system-ui, -apple-system, "Segoe UI", sans-serif; }
.audit-root * { box-sizing: border-box; }
.audit-root main { max-width: 48rem; margin: 0 auto; padding: 3rem 1.5rem 4rem; }
.audit-root section { margin-top: 2rem; }
.audit-root h1 { font-size: clamp(1.6rem, 4vw, 2.2rem); line-height: 1.2; font-weight: 600; letter-spacing: -0.01em; margin: 0.6rem 0 0.8rem; }
.audit-root h2 { font-size: 1.1rem; font-weight: 600; margin: 0 0 0.75rem; padding-bottom: 0.4rem; border-bottom: 1px solid #ffffff1f; }
.audit-root p { margin: 0; }
.audit-root a { color: inherit; }
.rp-bar { border-top: 4px solid var(--accent); padding-top: 1.1rem; }
.rp-accent { color: var(--accent); }
.rp-eyebrow { font-size: 0.8rem; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; }
.rp-meta { font-size: 0.85rem; color: #9fb0cb; }
.rp-first { border-left: 3px solid var(--accent); padding: 0.1rem 0 0.1rem 1rem; }
.rp-first p { font-size: 1.05rem; font-weight: 500; }
.rp-figures { display: grid; gap: 1rem; grid-template-columns: 1fr; }
@media (min-width: 40rem) { .rp-figures { grid-template-columns: 1fr 1fr; } }
.rp-fig { border: 1px solid #ffffff2e; border-radius: 6px; padding: 1rem 1.2rem; }
.rp-kicker { font-size: 0.75rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: #9fb0cb; }
.rp-value { font-size: 2rem; font-weight: 600; font-variant-numeric: tabular-nums; margin: 0.25rem 0; line-height: 1.15; }
.rp-value small { font-size: 1rem; font-weight: 400; color: #9fb0cb; }
.rp-sub { font-size: 0.8rem; color: #9fb0cb; margin-top: 0.3rem; }
.rp-list { list-style: none; margin: 0; padding: 0; }
.rp-list li { border-top: 1px solid #ffffff1f; padding: 0.75rem 0; font-size: 0.92rem; }
.rp-list li:first-child { border-top: 0; padding-top: 0; }
.rp-tag { font-weight: 600; }
.rp-crit { color: #ff9aa2; }
.rp-warn { color: #f5b14f; }
.rp-win { display: block; font-size: 0.78rem; color: #9fb0cb; margin-top: 0.15rem; }
.rp-steps { margin: 0; padding-left: 1.4rem; font-size: 0.92rem; }
.rp-steps li { padding: 0.35rem 0; }
.rp-steps li::marker { color: var(--accent); font-weight: 600; }
.rp-do { display: block; color: #c9d4e6; }
.rp-when { font-size: 0.75rem; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: #9fb0cb; margin-left: 0.4rem; }
.rp-notes { margin: 0; padding-left: 1.4rem; font-size: 0.82rem; color: #c9d4e6; }
.rp-notes li { padding: 0.25rem 0; }
.rp-ref { font-size: 0.7em; vertical-align: super; line-height: 0; margin-left: 0.15rem; }
.rp-foot { font-size: 0.78rem; color: #9fb0cb; margin-top: 1.75rem; }
.rp-cta { display: inline-block; margin-top: 1.5rem; padding: 0.75rem 1.25rem; border-radius: 6px; background: #4db3dc; color: #000c25 !important; font-weight: 600; text-decoration: none; }
.rp-print { margin-top: 1rem; padding: 0.45rem 0.9rem; border-radius: 6px; border: 1px solid #ffffff40; background: transparent; color: inherit; font: inherit; font-size: 0.85rem; cursor: pointer; }
@media print {
  .audit-root { background: #fff !important; color: #111 !important; min-height: 0 !important; font-size: 9.5pt; line-height: 1.35; }
  .audit-root * { color: #111 !important; background: transparent !important; border-color: #bbb !important; box-shadow: none !important; }
  .audit-root .no-print { display: none !important; }
  .audit-root main { padding: 0 !important; max-width: none !important; }
  .audit-root .rp-accent, .audit-root .rp-steps li::marker { color: var(--accent-print) !important; }
  .audit-root .rp-bar { border-top-color: var(--accent-print) !important; }
  .audit-root .rp-first { border-left-color: var(--accent-print) !important; }
  .audit-root h1 { font-size: 18pt; margin: 4pt 0 6pt; }
  .audit-root h2 { font-size: 11.5pt; margin-bottom: 5pt; padding-bottom: 2pt; }
  .audit-root section { margin-top: 10pt; break-inside: avoid; }
  .audit-root .rp-fig { padding: 8pt 10pt; }
  .audit-root .rp-value { font-size: 17pt; }
  .audit-root .rp-list li { padding: 5pt 0; font-size: 9.5pt; break-inside: avoid; }
  .audit-root .rp-steps { font-size: 9.5pt; }
  .audit-root .rp-steps li { padding: 2pt 0; break-inside: avoid; }
  .audit-root .rp-notes { font-size: 8pt; }
  .audit-root .rp-notes li { padding: 1pt 0; break-inside: avoid; }
  .audit-root .rp-meta, .audit-root .rp-sub, .audit-root .rp-win, .audit-root .rp-kicker, .audit-root .rp-foot { color: #444 !important; }
}
`;

const refFor = (notes: NonNullable<SharePayload["notes"]>, key: string | undefined) => {
  const i = key ? notes.findIndex((n) => n.key === key) : -1;
  return i < 0 ? null : <sup className="rp-ref"><a href={`#note-${i + 1}`} aria-label={`How this is counted, note ${i + 1}`}>[{i + 1}]</a></sup>;
};

export function AuditReport({ payload: p, expiresAt }: { payload: SharePayload; expiresAt: Date }) {
  const notes = p.notes ?? [];
  const plan = p.findings.slice(0, 5);
  const accents = reportAccents(p.brandColor);
  const sender = p.branded === false ? null : p.who;
  const rules = p.rulesVersion === undefined ? null : DEAL_RULE_HISTORY.find((r) => r.version === p.rulesVersion) ?? null;
  const staleFinding = p.findings.find((f) => f.note === "stale");
  const style = { "--accent": accents.screen, "--accent-print": accents.print } as CSSProperties;
  return (
    <div className="audit-root" style={style}>
      <style dangerouslySetInnerHTML={{ __html: REPORT_CSS }} />
      <main>
        <header className="rp-bar">
          {sender && p.brandLogoUrl && <BrandLogo url={p.brandLogoUrl} name={sender} height={40} className="rp-logo" fallback={null} />}
          <p className="rp-eyebrow rp-accent">Account audit{sender ? ` · ${sender}` : ""}</p>
          <h1>{p.headline}</h1>
          {p.verdictSub && <p className="rp-sub" style={{ fontSize: "0.95rem", marginTop: 0 }} data-testid="report-sub">{p.verdictSub}</p>}
          {p.grade && <p className="rp-sub" data-testid="report-grade">{p.grade}</p>}
          <p className="rp-meta">
            Snapshot taken {day(p.createdAt)}. This link works until {day(expiresAt.toISOString())}. It covers {p.accountsScanned} client {p.accountsScanned === 1 ? "account" : "accounts"}.
          </p>
          <PrintButton />
        </header>

        {p.fixFirst && (
          <section className="rp-first" aria-label="What to fix first">
            <p className="rp-kicker">What to fix first</p>
            <p>{p.fixFirst}</p>
          </section>
        )}

        <section className="rp-figures" aria-label="The two figures">
          <div className="rp-fig">
            <p className="rp-kicker">Counted from the CRM{refFor(notes, "stale")}</p>
            <p className="rp-value">{usd(p.staleDollars)}</p>
            <p className="rp-sub">Deals that have stopped moving, across {p.accountsScanned} client {p.accountsScanned === 1 ? "account" : "accounts"}. Deals with no value or no owner are not counted.{staleFinding?.window ? ` ${staleFinding.window}.` : ""}</p>
            {p.outlier && <p className="rp-sub">One deal ({usd(p.outlier.value)}) is {Math.round(p.outlier.share * 100)}% of this figure, so check that it is a real deal before relying on it.</p>}
          </div>
          <div className="rp-fig">
            <p className="rp-kicker">Estimate, not a fact{refFor(notes, "estimate")}</p>
            <p className="rp-value">{p.estimatedDollars === null ? <small>Not enough data</small> : usd(p.estimatedDollars)}</p>
            {p.estimateRange && p.estimatedDollars !== null && <p className="rp-sub">Most likely between {usd(p.estimateRange.low)} and {usd(p.estimateRange.high)}.</p>}
            <p className="rp-sub">What leaks each month: people waiting for a reply and no-shows not rebooked, each counted once, x average deal x win rate. A rough size of the problem, not money lost. It is never added to the counted figure.</p>
          </div>
        </section>
        {(p.leftOut ?? 0) > 0 && <p className="rp-sub" style={{ marginTop: "0.75rem" }}>{(p.leftOut as number).toLocaleString("en-US")} open {p.leftOut === 1 ? "deal is" : "deals are"} left out of every dollar figure (no value, no owner, or in a closed-out stage).{refFor(notes, "left_out")}</p>}

        {p.findings.length > 0 && (
          <section aria-label="What we found">
            <h2>What we found</h2>
            <ul className="rp-list">
              {p.findings.map((f) => (
                <li key={f.title}>
                  <span className={`rp-tag ${f.severity === "critical" ? "rp-crit" : "rp-warn"}`}>{f.severity === "critical" ? "Urgent · " : "Soon · "}</span>{f.title}
                  {f.dollars !== null && <span className="rp-sub"> · {usd(f.dollars)} {f.kind === "estimate" ? "(estimate)" : "(counted)"}</span>}
                  {refFor(notes, f.note)}
                  {f.what && <span className="rp-win">{f.what}</span>}
                  {f.window && <span className="rp-win">Counted over: {f.window}.</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {(p.healthy?.length ?? 0) > 0 && (
          <section aria-label="What is healthy">
            <h2>What is healthy</h2>
            <ul className="rp-list">
              {p.healthy!.map((h) => <li key={h}>{h}</li>)}
            </ul>
          </section>
        )}

        {plan.length > 0 && (
          <section aria-label="One-page fix plan">
            <h2>One-page fix plan</h2>
            <ol className="rp-steps">
              {plan.map((f) => (
                <li key={f.title}>
                  <span className="rp-tag">{f.title}</span><span className="rp-when">{f.severity === "critical" ? "Start today" : "This week"}</span>
                  {f.fix ? <span className="rp-do">What to do: {f.fix}</span> : null}
                </li>
              ))}
            </ol>
          </section>
        )}

        <section aria-label="Next step">
          <h2>Next step</h2>
          <p style={{ fontSize: "0.92rem" }}>
            {p.branded === true ? `Ask ${p.who} to start on step 1 of the fix plan.` : "Start on step 1 of the fix plan."} Run this audit again in two weeks: the numbers above are counted the same way each time, so you will see what moved.
          </p>
        </section>

        {notes.length > 0 && (
          <section aria-label="How each number is counted">
            <h2>How each number is counted</h2>
            <ol className="rp-notes">
              {notes.map((n, i) => (
                <li key={n.key} id={`note-${i + 1}`}><strong>{n.title}.</strong> {n.text}</li>
              ))}
            </ol>
          </section>
        )}

        <p className="rp-foot">
          Names and customer details are not included. Nothing in this snapshot changes anything in any account.
          {rules ? ` Deals are counted with the rules in force from ${day(`${rules.from}T00:00:00Z`)}.` : ""}
        </p>
        {p.branded !== true && <Link href="/" className="no-print rp-cta">Run your own free audit</Link>}
      </main>
    </div>
  );
}
