import { SiteShell } from "./shell";

export type LegalSection = { id: string; title: string };

/** The frame of Trust, Privacy and Terms: title, last updated date, a table of contents with anchors, and print-friendly styles. Sections are drawn by the caller. */
export function LegalDoc({ title, updated, intro, sections, children }: { title: string; updated: string; intro: string; sections: LegalSection[]; children: React.ReactNode }) {
  return (
    <SiteShell>
      <article className="wrap page narrow legal">
        <h1>{title}</h1>
        <p className="upd">Last updated: {updated}</p>
        <p style={{ marginTop: 14 }}>{intro}</p>
        <nav className="toc" aria-label="On this page">
          <strong>Contents</strong>
          <ul>{sections.map((s) => <li key={s.id}><a href={`#${s.id}`}>{s.title}</a></li>)}</ul>
        </nav>
        {children}
      </article>
    </SiteShell>
  );
}
