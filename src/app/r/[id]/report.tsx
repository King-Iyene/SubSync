import { expiryWords, type StoredReport } from "@/lib/report-share";
import { PrintButton } from "./print-button";

// The page someone receives from "Share report": one frozen report on white, with no navigation, no link into the app and nothing from any other account. Plain markup with its own small
// stylesheet and one script (the print button), so it prints the same everywhere. Nothing on it names the product or the platform.

export const SHARED_REPORT_CSS = `
@page { margin: 14mm; }
.sr-root { background: #ffffff; color: #1d1c19; min-height: 100vh; line-height: 1.5; font-family: var(--font-geist-sans, system-ui), system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.sr-root * { box-sizing: border-box; }
.sr-root main { max-width: 52rem; margin: 0 auto; padding: 2.5rem 1.25rem 3.5rem; }
.sr-root p, .sr-root h1, .sr-root h2, .sr-root ul, .sr-root dl, .sr-root dd { margin: 0; padding: 0; }
.sr-head { border-top: 4px solid #2d5c45; padding-top: 1rem; }
.sr-brand { font-size: 0.8rem; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: #2d5c45; }
.sr-root h1 { font-size: clamp(1.5rem, 4.5vw, 2.1rem); line-height: 1.2; font-weight: 650; margin: 0.35rem 0; overflow-wrap: anywhere; }
.sr-meta { font-size: 0.88rem; color: #5a564d; }
.sr-sec { margin-top: 2rem; }
.sr-root h2 { font-size: 1.05rem; font-weight: 650; padding-bottom: 0.4rem; margin-bottom: 0.8rem; border-bottom: 1px solid #dcd7cb; break-after: avoid; }
.sr-stats { display: grid; gap: 0.75rem; grid-template-columns: repeat(auto-fill, minmax(min(100%, 13rem), 1fr)); }
.sr-stat { border: 1px solid #dcd7cb; border-radius: 8px; padding: 0.8rem 0.95rem; break-inside: avoid; }
.sr-label { font-size: 0.8rem; font-weight: 600; color: #5a564d; }
.sr-value { font-size: 1.7rem; line-height: 1.15; font-weight: 650; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.sr-note { font-size: 0.8rem; color: #5a564d; margin-top: 0.15rem; }
.sr-lines { list-style: disc; padding-left: 1.3rem !important; display: grid; gap: 0.3rem; }
.sr-lines li { break-inside: avoid; }
.sr-wrap { overflow-x: auto; }
.sr-table { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
.sr-table th, .sr-table td { text-align: left; padding: 0.45rem 0.5rem; border-bottom: 1px solid #dcd7cb; vertical-align: top; overflow-wrap: anywhere; }
.sr-table th { font-size: 0.78rem; color: #5a564d; font-weight: 650; }
.sr-table thead { display: table-header-group; }
.sr-table tr { break-inside: avoid; }
.sr-notes { margin-top: 2rem; font-size: 0.85rem; color: #5a564d; padding-left: 1.2rem !important; display: grid; gap: 0.25rem; }
.sr-foot { margin-top: 2rem; border-top: 1px solid #dcd7cb; padding-top: 0.9rem; font-size: 0.82rem; color: #5a564d; display: grid; gap: 0.4rem; }
.rp-print { margin-top: 0.9rem; padding: 0.5rem 1rem; border-radius: 8px; border: 1px solid #2d5c45; background: #2d5c45; color: #ffffff; font: inherit; font-size: 0.9rem; font-weight: 600; cursor: pointer; min-height: 2.5rem; }
@media print {
  .sr-root { min-height: 0; font-size: 10pt; }
  .sr-root main { padding: 0; max-width: none; }
  .no-print { display: none !important; }
  .sr-sec { break-inside: auto; }
  .sr-wrap { overflow: visible; }
  .sr-root, .sr-root * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;

const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export function SharedReport({ report: r, expiresAt, now = new Date() }: { report: StoredReport; expiresAt: Date; now?: Date }) {
  return (
    <div className="sr-root">
      <style dangerouslySetInnerHTML={{ __html: SHARED_REPORT_CSS }} />
      <main>
        <header className="sr-head" data-testid="shared-report-header">
          {r.brandName && <p className="sr-brand">{r.brandName}</p>}
          <h1>{r.title}</h1>
          <p className="sr-meta">{r.scope}{r.period ? `, ${r.period}` : ""}</p>
          <p className="sr-meta">Figures as of {when(r.takenAt)}. This is a snapshot: it does not change.</p>
          <PrintButton />
        </header>
        {r.sections.map((s, i) => (
          <section key={i} className="sr-sec">
            {s.heading && <h2>{s.heading}</h2>}
            {s.stats.length > 0 && (
              <div className="sr-stats">
                {s.stats.map((x, j) => (
                  <div key={j} className="sr-stat"><p className="sr-label">{x.label}</p><p className="sr-value">{x.value}</p>{x.note && <p className="sr-note">{x.note}</p>}</div>
                ))}
              </div>
            )}
            {s.lines.length > 0 && <ul className="sr-lines" style={{ marginTop: s.stats.length ? "0.9rem" : 0 }}>{s.lines.map((l, j) => <li key={j}>{l}</li>)}</ul>}
            {s.table && (
              <div className="sr-wrap" style={{ marginTop: s.stats.length || s.lines.length ? "0.9rem" : 0 }}>
                <table className="sr-table">
                  <thead><tr>{s.table.columns.map((c, j) => <th key={j} scope="col">{c}</th>)}</tr></thead>
                  <tbody>{s.table.rows.map((row, j) => <tr key={j}>{s.table!.columns.map((_, k) => <td key={k}>{row[k] ?? ""}</td>)}</tr>)}</tbody>
                </table>
              </div>
            )}
          </section>
        ))}
        {r.notes.length > 0 && <ul className="sr-notes">{r.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
        <footer className="sr-foot">
          <p>{r.namesIncluded ? "Names are included in this report." : "Names of people and other client accounts are hidden in this report."}</p>
          <p className="no-print">This link {expiryWords(expiresAt, now)} and can be switched off by the sender at any time.</p>
        </footer>
      </main>
    </div>
  );
}
