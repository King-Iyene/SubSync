import type { Metadata } from "next";
import { headers } from "next/headers";
import { connection } from "next/server";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { findShared } from "@/lib/analytics/share-queries";
import { createLimiter } from "@/lib/rate-limit";
import { AuditReport } from "./report";

// A shared account audit: totals, finding titles, a fix plan and how each number is counted. No account or client names, never indexed, no preview that
// names anyone, expires after 14 days, can be switched off by its owner, and counts how often it was opened.
export const metadata: Metadata = {
  title: "Account audit",
  description: "A snapshot of what needs attention across a set of client accounts.",
  robots: { index: false, follow: false, noarchive: true, nosnippet: true, noimageindex: true },
  referrer: "no-referrer",
  openGraph: { title: "Account audit", description: "A snapshot of what needs attention across a set of client accounts.", type: "website" },
  twitter: { card: "summary", title: "Account audit", description: "A snapshot of what needs attention across a set of client accounts." },
};

// Someone asking for many links is turned away before the database is touched. The token itself is 192 random bits.
const lookups = createLimiter(30, 60_000);

// The data is read per request, so it sits behind a Suspense boundary (required by this project's rendering mode).
export default function SharedAudit({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#000c25]" />}>
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
  const found = await findShared(id);
  if (!found) notFound();
  return <AuditReport payload={found.payload} expiresAt={found.expiresAt} />;
}
