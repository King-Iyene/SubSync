import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { headers } from "next/headers";
import { connection } from "next/server";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { findProofPage } from "@/lib/analytics/reply-proof";
import { durationText, PROOF_NOTE } from "@/lib/analytics/moat-core";
import { createLimiter } from "@/lib/rate-limit";
import { REPORT_CSS, reportAccents } from "@/app/audit/[id]/report";
import { BrandLogo } from "@/app/app/brand-logo";

// A shared reply-time page for one client account, branded with the agency's own name and colour. The figures are measured from the account's own records and stored
// with a hash chain, so the page says whether it is unchanged. It never names a contact, is never indexed, expires, and the owner can switch it off.
export const metadata: Metadata = {
  title: "Reply times",
  description: "How quickly new leads were answered, measured from the account's own records.",
  robots: { index: false, follow: false, noarchive: true, nosnippet: true, noimageindex: true },
  referrer: "no-referrer",
};

const lookups = createLimiter(30, 60_000);
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export default function ReplyProof({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#000c25]" />}>
      <Body params={params} />
    </Suspense>
  );
}

async function Body({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (!lookups.allow(ip)) notFound();
  const found = await findProofPage(id);
  if (!found) notFound();
  const p = found.payload;
  const v = found.verification;
  const accents = reportAccents(p.brand.color);
  const style = { "--accent": accents.screen, "--accent-print": accents.print } as CSSProperties;
  return (
    <div className="audit-root" style={style}>
      <style dangerouslySetInnerHTML={{ __html: REPORT_CSS }} />
      <main>
        <header className="rp-bar">
          {p.brand.logoUrl && <BrandLogo url={p.brand.logoUrl} name={p.brand.name} height={40} className="rp-logo" fallback={null} />}
          <p className="rp-eyebrow rp-accent">Reply times · {p.brand.name}</p>
          <h1>{p.account}</h1>
          <p className="rp-meta">Measured {day(p.periodFrom)} to {day(p.periodTo)}. This link works until {day(found.expiresAt.toISOString())}.</p>
        </header>
        <section className="rp-figures" aria-label="Measured reply times">
          <div className="rp-fig"><p className="rp-kicker">Typical first reply</p><p className="rp-value">{p.medianMinutes === null ? "n/a" : durationText(p.medianMinutes)}</p><p className="rp-sub">Half of new leads were answered at least this fast</p></div>
          <div className="rp-fig"><p className="rp-kicker">Answered within {durationText(p.targetMinutes)}</p><p className="rp-value">{p.withinTargetPct === null ? "n/a" : `${p.withinTargetPct}%`}</p><p className="rp-sub">Of {p.leads} new leads</p></div>
          <div className="rp-fig"><p className="rp-kicker">Slowest tenth</p><p className="rp-value">{p.p90Minutes === null ? "n/a" : durationText(p.p90Minutes)}</p><p className="rp-sub">9 in 10 were answered at least this fast</p></div>
          <div className="rp-fig"><p className="rp-kicker">Never answered</p><p className="rp-value">{p.neverAnswered}</p><p className="rp-sub">Of {p.leads} new leads in the period</p></div>
        </section>
        <section>
          <h2>How this was measured</h2>
          <p className="rp-sub" style={{ fontSize: "0.92rem" }}>{p.method} Time counted: {p.clock}.</p>
          <p className="rp-sub" style={{ fontSize: "0.92rem", marginTop: "0.6rem" }}>{PROOF_NOTE}</p>
        </section>
        <section>
          <h2>Is this page unchanged?</h2>
          <p className="rp-sub" style={{ fontSize: "0.92rem" }} data-testid="proof-check">
            {v.ok ? "Yes. The figures match the record made when this page was created" : "This page could not be verified, so do not rely on it"}
            {v.ok && v.signed ? ", and the record is signed." : v.ok ? "." : "."}
          </p>
          <p className="rp-meta" style={{ marginTop: "0.5rem", wordBreak: "break-all" }}>Record {found.seq}. Fingerprint {found.chainHash.slice(0, 16)}</p>
        </section>
      </main>
    </div>
  );
}
