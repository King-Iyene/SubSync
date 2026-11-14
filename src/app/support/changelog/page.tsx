import type { Metadata } from "next";
import Link from "next/link";
import { SiteShell } from "@/components/site/shell";
import { NEWS } from "@/lib/whats-new";

export const metadata: Metadata = { title: "Change log | SubSync Support", description: "What is new in SubSync, with dates.", alternates: { canonical: "/support/changelog" } };

const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export default function Changelog() {
  // Only what is live for everyone: the entry about the sending switch is left out until that switch is on for all.
  const rows = NEWS.filter((e) => e.feature !== "send_messages").sort((a, b) => b.date.localeCompare(a.date));
  return (
    <SiteShell>
      <div className="wrap page narrow">
        <p className="crumbs"><Link href="/support">Support</Link> / Change log</p>
        <h1>Change log</h1>
        <p className="muted">The same list as What&apos;s new inside the app.</p>
        {rows.map((e) => (
          <div key={e.id} id={e.id} style={{ margin: "22px 0" }}>
            <p className="muted" style={{ fontSize: 14 }}>{fmt(e.date)}</p>
            <h3 style={{ margin: "2px 0 4px" }}>{e.title}</h3>
            <p>{e.line}</p>
          </div>
        ))}
      </div>
    </SiteShell>
  );
}
