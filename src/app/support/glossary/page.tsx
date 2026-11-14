import type { Metadata } from "next";
import Link from "next/link";
import { SiteShell } from "@/components/site/shell";
import { GLOSSARY } from "@/lib/site/docs";

export const metadata: Metadata = { title: "Glossary | SubSync Support", description: "The words SubSync uses, in plain language.", alternates: { canonical: "/support/glossary" } };

export default function Glossary() {
  const rows = [...GLOSSARY].sort((a, b) => a[0].localeCompare(b[0]));
  return (
    <SiteShell>
      <div className="wrap page narrow">
        <p className="crumbs"><Link href="/support">Support</Link> / Glossary</p>
        <h1>Glossary</h1>
        <p className="muted">The words SubSync uses, in plain language.</p>
        <dl className="defs">{rows.map(([t, d]) => <div key={t} id={t.toLowerCase().replace(/[^a-z]+/g, "-")}><dt>{t}</dt><dd>{d}</dd></div>)}</dl>
      </div>
    </SiteShell>
  );
}
