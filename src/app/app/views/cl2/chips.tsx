import type { Cl2Plan } from "@/lib/analytics/clients2-types";

// Small status chips for Clients v2. A status always has its words, so it never relies on colour alone.
const TONE: Record<string, string | undefined> = { past_due: "amber", cancelled: "amber", paused: "cyan", other: "cyan" };
export function PayChip({ plan }: { plan: Cl2Plan }) {
  return <span className="ap-chip" data-tone={TONE[plan.pay]} data-testid="cl2-pay">{plan.payLabel}</span>;
}
export function LevelDot({ level }: { level: "ok" | "watch" | "act" | "unknown" }) {
  const t = level === "act" ? ["Act now", "amber"] : level === "watch" ? ["Keep an eye", "cyan"] : level === "unknown" ? ["No data yet", ""] : ["Fine", ""];
  return <span className="ap-chip" data-tone={t[1] || undefined}>{t[0]}</span>;
}
