import type { Metadata } from "next";
import { headers } from "next/headers";
import { connection } from "next/server";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import { createLimiter } from "@/lib/rate-limit";
import type { SharePayload } from "@/lib/analytics/share-intel";

// A shared account audit: totals, finding titles and a fix plan only. No account or client names, never indexed, no preview that names
// anyone, expires after 14 days, can be switched off by its owner, and counts how often it was opened.
export const metadata: Metadata = {
  title: "Account audit",
  description: "A snapshot of what needs attention across a set of client accounts.",
  robots: { index: false, follow: false, noarchive: true, nosnippet: true, noimageindex: true },
  referrer: "no-referrer",
  openGraph: { title: "Account audit", description: "A snapshot of what needs attention across a set of client accounts.", type: "website" },
  twitter: { card: "summary", title: "Account audit", description: "A snapshot of what needs attention across a set of client accounts." },
};

const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

// Someone asking for many links is turned away before the database is touched. The token itself is 192 random bits.
const lookups = createLimiter(30, 60_000);

// The data is read per request, so it sits behind a Suspense boundary (required by this project's rendering mode).
export default function SharedAudit({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<div className="dark min-h-screen bg-[oklch(0.15_0.025_220)]" />}>
      <AuditBody params={params} />
    </Suspense>
  );
}

async function AuditBody({ params }: { params: Promise<{ id: string }> }) {
  await connection(); // the page reads the clock and the database per request, never at build time
  const { id } = await params;
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (!lookups.allow(ip)) notFound();
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(id)) notFound();
  const [row] = await sql()`select payload, expires_at from shared_audits where id = ${id} and expires_at > now() and revoked_at is null`;
  if (!row) notFound();
  await sql()`update shared_audits set views = views + 1, last_viewed_at = now() where id = ${id}`.catch(() => undefined);
  const p = row.payload as SharePayload;
  const plan = p.findings.slice(0, 5);
  return (
    <div className="audit-root dark min-h-screen bg-[oklch(0.15_0.025_220)] text-white">
      <style>{`@page { margin: 14mm; } @media print { .audit-root { background: #fff !important; color: #111 !important; min-height: 0 !important; } .audit-root * { color: #111 !important; background: transparent !important; border-color: #bbb !important; box-shadow: none !important; } .audit-root .no-print { display: none !important; } .audit-root li, .audit-root section { break-inside: avoid; } .audit-root { font-size: 10pt !important; } .audit-root main { padding: 0 !important; max-width: none !important; } .audit-root h1 { font-size: 20pt !important; line-height: 1.2 !important; } .audit-root .text-3xl { font-size: 18pt !important; } .audit-root .space-y-8 > * + * { margin-top: 12pt !important; } .audit-root .space-y-3 > * + *, .audit-root .space-y-2 > * + * { margin-top: 6pt !important; } .audit-root li.rounded-xl, .audit-root .rounded-2xl { padding: 8pt !important; } }`}</style>
      <main className="mx-auto max-w-3xl space-y-8 px-6 py-14">
        <p className="text-sm font-medium uppercase tracking-widest text-teal-300">Account audit · {p.who}</p>
        <h1 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">{p.headline}</h1>
        <p className="text-sm text-white/60">Snapshot taken {day(p.createdAt)}. This link works until {day((row.expires_at as Date).toISOString())}.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <p className="text-sm text-white/60">Stale deal value (counted)</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums">{usd(p.staleDollars)}</p>
            <p className="mt-1 text-xs text-white/50">Fact: open deals that have not moved, across {p.accountsScanned} account{p.accountsScanned === 1 ? "" : "s"}. Deals with no value or no owner are not counted.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <p className="text-sm text-white/60">Cost of slow follow-up (estimate)</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums">{p.estimatedDollars === null ? <span className="text-base font-normal text-white/60">Not enough data</span> : usd(p.estimatedDollars)}</p>
            <p className="mt-1 text-xs text-white/50">Estimate, not a fact: waiting conversations x average deal x win rate. A rough size of the problem, not money lost.</p>
          </div>
        </div>
        {p.findings.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">What we found</h2>
            <ul className="space-y-2">
              {p.findings.map((f) => (
                <li key={f.title} className="rounded-xl border border-white/10 p-4 text-sm">
                  <span className={f.severity === "critical" ? "text-red-300" : "text-amber-300"}>{f.severity === "critical" ? "Fix first · " : "Soon · "}</span>{f.title}
                  {f.dollars !== null && <span className="text-white/60"> · {usd(f.dollars)} {f.kind === "estimate" ? "(estimate)" : "(counted)"}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}
        {plan.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">One-page fix plan</h2>
            <ol className="list-decimal space-y-3 pl-5 text-sm">
              {plan.map((f) => (
                <li key={f.title}><span className="font-medium">{f.title}</span>{f.fix ? <span className="block text-white/70">What to do: {f.fix}</span> : null}</li>
              ))}
            </ol>
          </section>
        )}
        <p className="text-xs text-white/40">Names and customer details are not included. Nothing in this snapshot changes anything in any account.</p>
        <Link href="/" className="no-print inline-block rounded-xl bg-teal-400 px-5 py-3 font-semibold text-slate-950 hover:bg-teal-300">Run your own free audit</Link>
      </main>
    </div>
  );
}
