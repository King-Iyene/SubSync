import type { churn, headline, ledger, movement, overview, revenue, setup } from "@/lib/analytics/finance-queries";
import type { statement, summary, listPeriods, listRates, disputeList } from "@/lib/analytics/finance-pay";

// Response shapes of GET /api/app/finance?part=... (type only, erased at build: nothing from the server files is bundled into the browser).
type Wrap<T> = T & { generatedAt: string; manager: boolean; flags: Record<string, boolean> };
export type FnOverview = Wrap<Awaited<ReturnType<typeof overview>>>;
export type FnMovement = Wrap<Awaited<ReturnType<typeof movement>>>;
export type FnRevenue = Wrap<Awaited<ReturnType<typeof revenue>>>;
export type FnChurn = Wrap<Awaited<ReturnType<typeof churn>>>;
export type FnLedger = Wrap<Awaited<ReturnType<typeof ledger>>>;
export type FnSetup = Wrap<Awaited<ReturnType<typeof setup>>>;
export type FnHeadline = Wrap<Awaited<ReturnType<typeof headline>>>;
export type FnPayouts = Wrap<Awaited<ReturnType<typeof summary>> & { rates: Awaited<ReturnType<typeof listRates>>; disputes: Awaited<ReturnType<typeof disputeList>> }>;
export type FnStatement = Wrap<Awaited<ReturnType<typeof statement>>>;
export type FnPeriods = Wrap<{ rows: Awaited<ReturnType<typeof listPeriods>> }>;
export type FnOptions = Wrap<{ settings: { payoutBasis: "booked" | "showed" | "won"; currency: string; dealWindowDays: number; saved: boolean }; level: string; selfId: string | null; role: string | null; tabs: string[]; accounts: number }>;
export type FnPage<R> = { rows: R[]; total: number; next: string | null };
