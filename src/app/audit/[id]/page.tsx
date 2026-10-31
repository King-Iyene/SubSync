import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import type { SharePayload } from "@/lib/analytics/share-intel";

// A shared account audit: totals and finding titles only. Never indexed, expires after 30 days.
export const metadata: Metadata = { title: "Account audit", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

export default async function SharedAudit({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(id)) notFound();
  const [row] = await sql()`select payload from shared_audits where id = ${id} and expires_at > now()`;
  if (!row) notFound();
  const p = row.payload as SharePayload;
  return (
    <div className="dark min-h-screen bg-[oklch(0.15_0.025_220)] text-white">
      <main className="mx-auto max-w-3xl space-y-8 px-6 py-14">
        <p className="text-sm font-medium uppercase tracking-widest text-teal-300">Account audit · {p.who}</p>
        <h1 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">{p.headline}</h1>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <p className="text-sm text-white/60">Stale deal value (counted)</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums">{usd(p.staleDollars)}</p>
            <p className="mt-1 text-xs text-white/50">Open deals that have not moved, across {p.accountsScanned} account{p.accountsScanned === 1 ? "" : "s"}.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <p className="text-sm text-white/60">Cost of slow follow-up (estimate)</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums">{p.estimatedDollars === null ? <span className="text-base font-normal text-white/60">Not enough data</span> : usd(p.estimatedDollars)}</p>
            <p className="mt-1 text-xs text-white/50">A rough size of the problem from win rates, not money lost.</p>
          </div>
        </div>
        {p.findings.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">What needs fixing</h2>
            <ul className="space-y-2">
              {p.findings.map((f) => (
                <li key={f.title} className="rounded-xl border border-white/10 p-4 text-sm">
                  <span className={f.severity === "critical" ? "text-red-300" : "text-amber-300"}>{f.severity === "critical" ? "Fix first · " : "Soon · "}</span>{f.title}
                  {f.dollars !== null && <span className="text-white/60"> · {usd(f.dollars)} {f.kind === "estimate" ? "(estimate)" : ""}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}
        <p className="text-xs text-white/40">Snapshot taken {new Date(p.createdAt).toUTCString()}. Names and customer details are not included.</p>
        <Link href="/" className="inline-block rounded-xl bg-teal-400 px-5 py-3 font-semibold text-slate-950 hover:bg-teal-300">Run your own free audit</Link>
      </main>
    </div>
  );
}
