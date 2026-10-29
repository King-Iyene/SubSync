// Account scoring, built only from activity data we can read (contacts, deals, conversations).
// Login activity is not available through the API, so it is deliberately not used.

export type AccountMetrics = {
  contacts: number;
  newContacts30d: number;
  openOpportunities: number;
  staleOpportunities: number;
  /** Inbound conversations nobody has answered within the SLA. */
  unansweredOverSla: number;
  completenessPct: number;
  /** Days since the last sign of activity (contact, deal or message); null if never. */
  daysInactive: number | null;
};

export type ScoreBand = "thriving" | "healthy" | "watch" | "at_risk";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export type ScoreComponent = { key: string; label: string; points: number; max: number; why: string };
export type ScoreBreakdown = { total: number; components: ScoreComponent[] };

/**
 * The score and exactly where every point came from. There are no hidden caps or
 * adjustments: the total is the sum of the five components shown to the user.
 */
export function engagementBreakdown(m: AccountMetrics): ScoreBreakdown {
  const d = m.daysInactive ?? 365;
  // Recency (40): how recently anything happened.
  const recency = d <= 3 ? 40 : d <= 7 ? 34 : d <= 14 ? 26 : d <= 30 ? 16 : d <= 60 ? 6 : 0;
  // Growth (20): new contacts in 30 days, full marks at about 5% of the list (min 5 contacts).
  const target = Math.max(5, m.contacts * 0.05);
  const growth = Math.round(20 * Math.min(1, m.newContacts30d / target));
  // Pipeline health (20): share of open deals that are not stale; no pipeline is neutral-low.
  const pipeline = m.openOpportunities === 0 ? 8 : Math.round(20 * (1 - clamp(m.staleOpportunities / m.openOpportunities, 0, 1)));
  // Responsiveness (10): unanswered inbound conversations cost 2 points each.
  const responsiveness = Math.max(0, 10 - m.unansweredOverSla * 2);
  // Data quality (10).
  const quality = Math.round(clamp(m.completenessPct, 0, 100) / 10);

  const components: ScoreComponent[] = [
    {
      key: "recency", label: "Recent activity", points: recency, max: 40,
      why: m.daysInactive === null ? "No activity recorded yet" : `Last activity ${d} day${d === 1 ? "" : "s"} ago`,
    },
    {
      key: "growth", label: "New contacts", points: growth, max: 20,
      why: `${m.newContacts30d} new contact${m.newContacts30d === 1 ? "" : "s"} in 30 days (target ${Math.ceil(target)})`,
    },
    {
      key: "pipeline", label: "Pipeline health", points: pipeline, max: 20,
      why: m.openOpportunities === 0
        ? "No open deals"
        : `${m.staleOpportunities} of ${m.openOpportunities} open deals are stale`,
    },
    {
      key: "responsiveness", label: "Responsiveness", points: responsiveness, max: 10,
      why: m.unansweredOverSla === 0
        ? "No inbound conversations waiting past the SLA"
        : `${m.unansweredOverSla} inbound conversation${m.unansweredOverSla === 1 ? "" : "s"} waiting past the SLA`,
    },
    {
      key: "quality", label: "Data quality", points: quality, max: 10,
      why: `${Math.round(m.completenessPct)}% of contacts have an email, phone and tags`,
    },
  ];
  return { total: clamp(recency + growth + pipeline + responsiveness + quality, 0, 100), components };
}

export function engagementScore(m: AccountMetrics): number {
  return engagementBreakdown(m).total;
}

export function scoreBand(score: number): ScoreBand {
  if (score >= 75) return "thriving";
  if (score >= 55) return "healthy";
  if (score >= 35) return "watch";
  return "at_risk";
}

export function isDormant(daysInactive: number | null, dormantDays: number): boolean {
  return daysInactive === null || daysInactive >= dormantDays;
}

export type ChurnRisk = { level: "low" | "medium" | "high"; reasons: string[] };

/**
 * Churn risk from the current score, inactivity and the score history (oldest first).
 * A drop is measured against the average of the earlier history.
 */
export function churnRisk(input: {
  score: number;
  daysInactive: number | null;
  dormantDays: number;
  history: number[];
}): ChurnRisk {
  const reasons: string[] = [];
  let level: ChurnRisk["level"] = "low";
  const raise = (to: ChurnRisk["level"]) => {
    if (to === "high" || (to === "medium" && level === "low")) level = to;
  };

  const d = input.daysInactive;
  if (d === null) {
    raise("high");
    reasons.push("No activity recorded yet");
  } else if (d >= input.dormantDays * 2) {
    raise("high");
    reasons.push(`No activity for ${d} days`);
  } else if (d >= input.dormantDays) {
    raise("medium");
    reasons.push(`No activity for ${d} days`);
  }

  if (input.score < 25) {
    raise("high");
    reasons.push(`Engagement score is very low (${input.score})`);
  } else if (input.score < 40) {
    raise("medium");
    reasons.push(`Engagement score is low (${input.score})`);
  }

  if (input.history.length >= 3) {
    const baseline = input.history.reduce((a, b) => a + b, 0) / input.history.length;
    const drop = Math.round(baseline - input.score);
    if (drop >= 25) {
      raise("high");
      reasons.push(`Score fell ${drop} points from its recent average`);
    } else if (drop >= 12) {
      raise("medium");
      reasons.push(`Score fell ${drop} points from its recent average`);
    }
  }
  return { level, reasons };
}
