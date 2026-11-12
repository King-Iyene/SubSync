import type { Metadata } from "next";
import { headers } from "next/headers";
import { connection } from "next/server";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { findPublic } from "@/lib/analytics/proof-queries";
import { defaultSections, MONTH_SHAPE, reportText, samplePayload, SAMPLE_TOKEN, TOKEN_SHAPE, type Brand } from "@/lib/analytics/proof-core";
import { createLimiter } from "@/lib/rate-limit";
import { ProofReport, accentVars } from "@/app/app/views/pr/report";
import { PR_CSS } from "@/app/app/views/pr/report-css";
import { ReportActions } from "@/app/app/views/pr/actions";

// The monthly report a company sends to one of its clients. The address holds a long random token: only its hash is stored, and it names exactly one client account and nothing else. Nobody signs
// in. The company can switch the link off or replace it at any time. It never names a contact or another account, never names the product or the platform, is rate limited and never indexed.
export const metadata: Metadata = {
  title: "Monthly report",
  description: "A monthly report of how new leads were handled.",
  robots: { index: false, follow: false, noarchive: true, nosnippet: true, noimageindex: true },
  referrer: "no-referrer",
  // A plain coloured square, so the tab never shows the product's own icon.
  icons: { icon: [{ url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='4' fill='%230a658b'/%3E%3C/svg%3E", type: "image/svg+xml" }], shortcut: [], apple: [] },
  openGraph: { title: "Monthly report", description: "A monthly report of how new leads were handled.", type: "website" },
  twitter: { card: "summary", title: "Monthly report", description: "A monthly report of how new leads were handled." },
};

const lookups = createLimiter(30, 60_000);

export default function ProofPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ m?: string | string[] }> }) {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh" }} />}>
      <Body params={params} searchParams={searchParams} />
    </Suspense>
  );
}

const SAMPLE_BRAND: Brand = { name: "Sample Marketing Co", logoUrl: null, color: "#0a658b" };

async function Body({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ m?: string | string[] }> }) {
  await connection();
  const { id } = await params;
  const sp = await searchParams;
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (!lookups.allow(ip)) notFound();
  const m = typeof sp.m === "string" && MONTH_SHAPE.test(sp.m) ? sp.m : null;

  if (id === SAMPLE_TOKEN) {
    const p = samplePayload();
    return (
      <main className="pr-print-root" style={{ minHeight: "100vh", ...accentVars(SAMPLE_BRAND.color) }}>
        <ProofReport p={p} brand={SAMPLE_BRAND} intro="Here is how your leads were handled this month." sections={defaultSections()} nameStaff={false} sample auto>
          <ReportActions text={reportText(p, SAMPLE_BRAND, null, defaultSections())} />
        </ProofReport>
      </main>
    );
  }
  if (!TOKEN_SHAPE.test(id)) notFound();
  const found = await findPublic(id, m).catch(() => null);
  if (!found) notFound();
  if (!found.report) {
    return (
      <main className="pr-print-root" style={{ minHeight: "100vh", ...accentVars(found.brand.color) }}>
        <style dangerouslySetInnerHTML={{ __html: PR_CSS }} />
        <div className="pr-doc" data-auto="" style={{ minHeight: "100vh", ...accentVars(found.brand.color) }}>
          <div className="pr-wrap"><header className="pr-head"><p className="pr-brand-name">{found.brand.name}</p><p className="pr-eyebrow">Monthly report</p><h1>No report yet</h1></header>
            <p className="pr-calm" style={{ marginTop: "1.5rem" }}>The first monthly report has not been shared yet. Please check back soon.</p></div>
        </div>
      </main>
    );
  }
  const r = found.report;
  const cur = r.payload.month;
  return (
    <main className="pr-print-root" style={{ minHeight: "100vh", background: "var(--pr-bg, #fff)", ...accentVars(found.brand.color) }}>
      <ProofReport p={r.payload} brand={found.brand} intro={r.intro} sections={r.sections} nameStaff={r.nameStaff} auto>
        <ReportActions text={reportText(r.payload, found.brand, r.intro, r.sections)} />
        {found.months.length > 1 && (
          <nav className="pr-switch pr-noprint" aria-label="Earlier reports">
            {found.months.map((x) => <a key={x.month} href={`?m=${x.month}`} aria-current={x.month === cur ? "page" : undefined}>{x.label}</a>)}
          </nav>
        )}
      </ProofReport>
    </main>
  );
}
