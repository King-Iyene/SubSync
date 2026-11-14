"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { SearchEntry } from "@/lib/site/docs";

/** Search over page titles and keywords, entirely in the browser: the index is built on the server from the same guides the app shows. */
export function DocsSearch({ entries }: { entries: SearchEntry[] }) {
  const [q, setQ] = useState("");
  const found = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    return entries
      .map((e) => ({ e, score: words.reduce((a, w) => a + (e.title.toLowerCase().includes(w) ? 3 : 0) + (e.text.includes(w) ? 1 : 0), 0), all: words.every((w) => e.text.includes(w)) }))
      .filter((r) => r.all)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
  }, [q, entries]);
  return (
    <div>
      <label htmlFor="doc-q" style={{ position: "absolute", left: -9999 }}>Search the help pages</label>
      <input id="doc-q" type="search" className="search" placeholder="Search: for example no-show, duplicates, Slack" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
      <div aria-live="polite">
        {q.trim() && found.length === 0 && <p className="fine">No page matches. Try another word, or email us.</p>}
        {found.length > 0 && (
          <ul className="results">
            {found.map(({ e }) => (
              <li key={e.slug}><Link href={`/support/${e.slug}`}>{e.title}<small>{e.summary}</small></Link></li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
