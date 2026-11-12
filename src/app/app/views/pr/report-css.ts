// The stylesheet of the client report. One block, scoped to .pr-doc, used by the public page and by the preview inside the app, so both look the same. Calm and flat: white paper, one accent
// (the company's own colour), thin lines, no shadows. Light by default; dark follows the app's own theme (.dark) or, on the public page, the reader's system setting. Print is always the
// light theme, on A4 or Letter margins, with nothing split across two sheets. Nothing here names the product or the platform.
export const PR_CSS = `
.pr-doc { --pr-bg: #ffffff; --pr-fg: #21201d; --pr-muted: #6c685f; --pr-card: #faf9f7; --pr-line: #e8e5df; --pr-good: #2b5a48; --pr-bad: #9d3a34; --pr-flat: #6c685f;
  background: var(--pr-bg); color: var(--pr-fg); line-height: 1.55; font-family: var(--font-geist-sans, system-ui), system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; -webkit-text-size-adjust: 100%; }
.dark .pr-doc { --pr-bg: #201f1c; --pr-fg: #f5f4f1; --pr-muted: #bab7b1; --pr-card: #2c2a26; --pr-line: #45423c; --pr-good: #61b491; --pr-bad: #dfa5a0; --pr-flat: #bab7b1; --pr-accent-text: var(--pr-accent-text-d); }
@media (prefers-color-scheme: dark) { .pr-doc[data-auto] { --pr-bg: #201f1c; --pr-fg: #f5f4f1; --pr-muted: #bab7b1; --pr-card: #2c2a26; --pr-line: #45423c; --pr-good: #61b491; --pr-bad: #dfa5a0; --pr-flat: #bab7b1; --pr-accent-text: var(--pr-accent-text-d); } }
.pr-doc[data-auto] { min-height: 100vh; }
.pr-doc *, .pr-doc *::before, .pr-doc *::after { box-sizing: border-box; }
:where(.pr-doc) :is(p, h1, h2, h3, ul, ol, dl, dd) { margin: 0; padding: 0; }
.pr-wrap { max-width: 46rem; margin: 0 auto; padding: 2rem 1rem 3rem; }
.pr-head { border-top: 4px solid var(--pr-accent); padding-top: 1.1rem; display: grid; gap: 0.35rem; }
.pr-brand { display: flex; align-items: center; gap: 0.75rem; min-height: 2.25rem; flex-wrap: wrap; }
.pr-brand img { max-height: 40px; width: auto; max-width: 12rem; }
.pr-brand-name { font-weight: 600; font-size: 1.05rem; }
.pr-eyebrow { font-size: 0.78rem; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--pr-accent-text); }
.pr-doc h1 { font-size: clamp(1.55rem, 5vw, 2.1rem); line-height: 1.15; font-weight: 650; letter-spacing: -0.015em; overflow-wrap: anywhere; }
.pr-meta { font-size: 0.86rem; color: var(--pr-muted); }
.pr-intro { margin-top: 1.25rem; color: var(--pr-fg); white-space: pre-line; }
.pr-lead { margin-top: 1.25rem; font-size: clamp(1.05rem, 3.4vw, 1.25rem); line-height: 1.45; font-weight: 500; border-left: 3px solid var(--pr-accent); padding: 0.15rem 0 0.15rem 1rem; }
.pr-sec { margin-top: 2.25rem; break-inside: avoid-page; }
.pr-doc h2 { font-size: 1.02rem; font-weight: 650; padding-bottom: 0.45rem; margin-bottom: 0.9rem; border-bottom: 1px solid var(--pr-line); }
.pr-grid { display: grid; gap: 0.75rem; grid-template-columns: repeat(auto-fill, minmax(min(100%, 15rem), 1fr)); }
.pr-card { background: var(--pr-card); border: 1px solid var(--pr-line); border-radius: 10px; padding: 0.95rem 1rem 0.85rem; display: grid; gap: 0.2rem; align-content: start; break-inside: avoid; }
.pr-kicker { font-size: 0.8rem; color: var(--pr-muted); font-weight: 600; }
.pr-value { font-size: 1.85rem; line-height: 1.1; font-weight: 650; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.pr-value small { font-size: 0.95rem; font-weight: 500; color: var(--pr-muted); letter-spacing: 0; }
.pr-na { font-size: 0.98rem; font-weight: 500; color: var(--pr-muted); line-height: 1.35; }
.pr-change { font-size: 0.84rem; font-weight: 600; }
.pr-change[data-tone="good"] { color: var(--pr-good); } .pr-change[data-tone="bad"] { color: var(--pr-bad); } .pr-change[data-tone="flat"] { color: var(--pr-flat); }
.pr-mean { font-size: 0.86rem; color: var(--pr-muted); margin-top: 0.15rem; }
.pr-how { margin-top: 0.35rem; font-size: 0.82rem; }
.pr-how summary { cursor: pointer; color: var(--pr-accent-text); font-weight: 600; list-style: none; padding: 0.25rem 0; }
.pr-how summary::-webkit-details-marker { display: none; }
.pr-how summary::before { content: "+ "; } .pr-how[open] summary::before { content: "- "; }
.pr-how p { color: var(--pr-muted); padding: 0.15rem 0 0.25rem; }
.pr-tl { list-style: none; display: grid; gap: 0; border-left: 2px solid var(--pr-line); margin-left: 0.3rem; }
.pr-tl li { position: relative; padding: 0 0 0.95rem 1.1rem; break-inside: avoid; }
.pr-tl li::before { content: ""; position: absolute; left: -0.36rem; top: 0.5rem; width: 0.55rem; height: 0.55rem; border-radius: 50%; background: var(--pr-accent); }
.pr-tl time { display: block; font-size: 0.78rem; color: var(--pr-muted); font-weight: 600; }
.pr-charts { display: grid; gap: 0.75rem; grid-template-columns: repeat(auto-fit, minmax(min(100%, 19rem), 1fr)); }
.pr-chart svg { width: 100%; height: auto; display: block; margin-top: 0.4rem; overflow: visible; }
.pr-chart .ln { fill: none; stroke: var(--pr-accent-text); stroke-width: 2.2; stroke-linejoin: round; stroke-linecap: round; }
.pr-chart .dot { fill: var(--pr-bg); stroke: var(--pr-accent-text); stroke-width: 2; }
.pr-chart .tx { fill: var(--pr-muted); font-size: 10px; font-family: inherit; }
.pr-chart .vx { fill: var(--pr-fg); font-size: 11px; font-weight: 600; font-family: inherit; }
.pr-chart .gd { stroke: var(--pr-line); stroke-width: 1; }
.pr-calm { background: var(--pr-card); border: 1px dashed var(--pr-line); border-radius: 10px; padding: 0.9rem 1rem; color: var(--pr-muted); font-size: 0.9rem; }
.pr-team { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
.pr-team th, .pr-team td { text-align: left; padding: 0.45rem 0.4rem; border-bottom: 1px solid var(--pr-line); }
.pr-team th { font-size: 0.78rem; color: var(--pr-muted); font-weight: 600; }
.pr-foot { margin-top: 2.5rem; border-top: 1px solid var(--pr-line); padding-top: 1rem; font-size: 0.84rem; color: var(--pr-muted); display: grid; gap: 0.5rem; }
.pr-formulas { display: none; }
.pr-formulas dt { font-weight: 650; color: var(--pr-fg); margin-top: 0.5rem; }
.pr-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 1rem; margin-bottom: 0.25rem; }
.pr-btn { appearance: none; border: 1px solid var(--pr-line); background: var(--pr-bg); color: var(--pr-fg); border-radius: 8px; padding: 0.5rem 0.9rem; font: inherit; font-size: 0.9rem; font-weight: 600; cursor: pointer; min-height: 2.5rem; }
.pr-btn[data-kind="primary"] { background: var(--pr-accent); border-color: var(--pr-accent); color: var(--pr-on-accent); }
.pr-btn:focus-visible, .pr-how summary:focus-visible { outline: 2px solid var(--pr-accent-text); outline-offset: 2px; }
.pr-switch { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.75rem; }
.pr-switch a { font-size: 0.84rem; padding: 0.25rem 0.65rem; border: 1px solid var(--pr-line); border-radius: 999px; color: var(--pr-fg); text-decoration: none; }
.pr-switch a[aria-current="page"] { background: var(--pr-accent); border-color: var(--pr-accent); color: var(--pr-on-accent); }
.pr-sample { background: #f7f3e8; color: #443816; border: 1px solid #ddcc99; border-radius: 8px; padding: 0.5rem 0.8rem; font-size: 0.88rem; font-weight: 600; margin-bottom: 1rem; }
@page { margin: 14mm; }
.pr-portal { display: none; }
@media print {
  .pr-doc, .dark .pr-doc { --pr-bg: #ffffff; --pr-fg: #21201d; --pr-muted: #5f5b54; --pr-card: #ffffff; --pr-line: #d7d5d1; --pr-good: #25503f; --pr-bad: #8b332e; --pr-flat: #5f5b54; --pr-accent-text: var(--pr-accent-text-l); }
  .pr-doc { background: #ffffff; font-size: 10.5pt; }
  .pr-wrap { max-width: none; padding: 0; }
  .pr-noprint, .pr-actions, .pr-switch { display: none !important; }
  .pr-how { display: none; } .pr-formulas { display: block; }
  .pr-card, .pr-tl li, .pr-chart, .pr-sec h2 { break-inside: avoid; }
  .pr-sec h2 { break-after: avoid; }
  .pr-card { background: #ffffff; }
  .pr-head { border-top-color: var(--pr-accent-text-l); }
  .pr-lead, .pr-tl li::before { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html[data-pr-printing] body > *:not(.pr-portal) { display: none !important; }
  html[data-pr-printing] .pr-portal { display: block !important; }
}
`;
