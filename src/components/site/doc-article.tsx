import Image from "next/image";
import Link from "next/link";
import { CRM_NOTE, docHref, pageBySlug, type DocView } from "@/lib/site/docs";

const TOC: Array<[string, string]> = [["what", "What it is"], ["who", "Who it is for"], ["see", "What you will see"], ["use", "How to use it"], ["reads", "What SubSync reads and changes"], ["numbers", "Numbers explained"], ["faq", "Common questions"], ["crm", "Where to find it"], ["related", "Related pages"]];

/** One documentation page. Everything on it comes from DocView, which is built from the in-app guides (src/lib/site/docs.ts). */
export function DocArticle({ v }: { v: DocView }) {
  const toc = TOC.filter(([id]) => (id === "numbers" ? v.numbers.length > 0 : id === "faq" ? v.faq.length > 0 : id === "related" ? v.related.length > 0 : true));
  return (
    <div className="wrap page narrow">
      <p className="crumbs"><Link href="/support">Support</Link> / {v.group}</p>
      <h1>{v.title}</h1>
      <p className="muted" style={{ fontSize: 19 }} id="what">{v.summary}</p>
      <nav className="toc" aria-label="On this page">
        <strong>On this page</strong>
        <ul>{toc.map(([id, t]) => <li key={id}><a href={`#${id}`}>{t}</a></li>)}</ul>
      </nav>
      {v.shot && (
        <div className="shot" style={{ margin: "18px 0" }}>
          <Image src={`/site/${v.shot}-800.webp`} alt={`The ${v.title} page of SubSync, shown with demo data`} width={800} height={450} sizes="(min-width: 800px) 760px, 100vw" />
        </div>
      )}
      <h2 id="who">Who it is for</h2>
      <p>{v.who}</p>
      <h2 id="see">What you will see</h2>
      {v.sees.map((s, i) => (
        <div key={s.id ?? i} id={s.id}>
          {s.title && <h3>{s.title}</h3>}
          <ul>{s.bullets.map((b) => <li key={b}>{b}</li>)}</ul>
          {s.next && <p className="muted"><strong>Do next:</strong> {s.next}</p>}
        </div>
      ))}
      <h2 id="use">How to use it</h2>
      <ol>{v.steps.map((s) => <li key={s}>{s}</li>)}</ol>
      {v.tryView && <p className="callout">In the app, the Try it now button on this guide opens the page for you. You can also press the ? button at the top of any page.</p>}
      <h2 id="reads">What SubSync reads and changes</h2>
      <p><strong>Reads.</strong> {v.reads}</p>
      <p><strong>Changes.</strong> {v.changes}</p>
      <p className="muted">The full list of permissions and what each is for is on the <Link href="/trust#read">Trust page</Link>.</p>
      {v.numbers.length > 0 && (<><h2 id="numbers">Numbers explained</h2><dl className="defs">{v.numbers.map(([t, d]) => <div key={t}><dt>{t}</dt><dd>{d}</dd></div>)}</dl><p className="muted">Every estimate is labelled as one, and the formula is one tap away in the app.</p></>)}
      {v.faq.length > 0 && (<><h2 id="faq">Common questions</h2>{v.faq.map(([q, a]) => <details className="faq" key={q}><summary>{q}</summary><p>{a}</p></details>)}</>)}
      <h2 id="crm">Where to find it</h2>
      <p>{CRM_NOTE}</p>
      {v.related.length > 0 && (
        <>
          <h2 id="related">Related pages</h2>
          <ul>{v.related.map((r) => { const p = pageBySlug(r); return p ? <li key={r}><Link href={docHref(r)}>{p.title}</Link></li> : null; })}</ul>
        </>
      )}
      <p className="callout">Still stuck? Email the address on the <Link href="/support#contact">Support page</Link>, or press Report a problem at the bottom of any page in the app.</p>
    </div>
  );
}
