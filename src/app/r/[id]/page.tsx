import type { Metadata } from "next";
import { headers } from "next/headers";
import { connection } from "next/server";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { findSharedReport } from "@/lib/report-share-queries";
import { createLimiter } from "@/lib/rate-limit";
import { SharedReport } from "./report";

// A shared report: one frozen snapshot behind a 192-bit random id. It expires, can be switched off by its owner, is rate limited, is never indexed, has no preview that names anyone, and shows
// only that one stored row: no navigation, no link into the app, no other account.
export const metadata: Metadata = {
  title: "Shared report",
  description: "A snapshot of a report.",
  robots: { index: false, follow: false, noarchive: true, nosnippet: true, noimageindex: true },
  referrer: "no-referrer",
  openGraph: { title: "Shared report", description: "A snapshot of a report.", type: "website" },
  twitter: { card: "summary", title: "Shared report", description: "A snapshot of a report." },
};

const lookups = createLimiter(30, 60_000);

export default function SharedReportPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-white" />}>
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
  const found = await findSharedReport(id);
  if (!found) notFound();
  return <SharedReport report={found.report} expiresAt={found.expiresAt} />;
}
