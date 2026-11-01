import type { DerivedAccount } from "../analytics/derive";
import { inbox, listAlerts, searchContacts, staleDeals } from "../analytics/queries";
import { loadAccounts } from "../analytics/service";
import type { ToolDef } from "./protocol";

// Read-only tools exposed to AI assistants. Everything is scoped to one agency (the key's
// installation), ignored accounts are left out, and result sizes are capped.

const clamp = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : fallback;
  return Math.max(lo, Math.min(hi, n));
};
const text = (v: unknown, max = 100) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function summary(a: DerivedAccount) {
  return {
    name: a.name, owner: a.owner, engagementScore: a.score, health: a.band, churnRisk: a.churn.level, churnReasons: a.churn.reasons,
    daysSinceActivity: a.daysInactive, dormant: a.dormant, contacts: a.contacts, newContactsLast30Days: a.new30d,
    dataCompletenessPercent: a.completenessPct, openDeals: a.openOpps, openDealValue: Math.round(a.openValue),
    staleDeals: a.staleOpps, staleDealValue: a.revenueAtRisk, conversationsWaitingPastSla: a.unanswered,
    winRatePercent: a.winRate === null ? null : Math.round(a.winRate * 100),
  };
}

export function buildTools(installationId: string): ToolDef[] {
  const live = async () => {
    const { settings, accounts } = await loadAccounts(installationId);
    return { settings, accounts: accounts.filter((a) => !a.ignored) };
  };

  return [
    {
      name: "portfolio_summary",
      description: "Overall picture of every client account: counts, average engagement score, dormant accounts, money stuck in stale deals, and conversations waiting past the reply target.",
      inputSchema: { type: "object", properties: {} },
      run: async () => {
        const { accounts } = await live();
        const sum = (f: (a: DerivedAccount) => number) => accounts.reduce((s, a) => s + f(a), 0);
        return {
          clientAccounts: accounts.length,
          averageEngagementScore: accounts.length ? Math.round(sum((a) => a.score) / accounts.length) : 0,
          atRiskAccounts: accounts.filter((a) => a.band === "at_risk" || a.churn.level === "high").map((a) => a.name),
          dormantAccounts: accounts.filter((a) => a.dormant).map((a) => a.name),
          staleDealValue: sum((a) => a.revenueAtRisk),
          conversationsWaitingPastSla: sum((a) => a.unanswered),
          openPipelineValue: Math.round(sum((a) => a.openValue)),
        };
      },
    },
    {
      name: "list_accounts",
      description: "List client accounts with health, churn risk, activity and deal figures. Filter to the ones that need attention.",
      inputSchema: {
        type: "object",
        properties: {
          filter: { type: "string", enum: ["all", "at_risk", "watch", "dormant", "incomplete_data", "replies_waiting"], description: "Which accounts to return (default all)" },
          limit: { type: "number", description: "Maximum accounts to return (1-100, default 30)" },
        },
      },
      run: async (args) => {
        const { accounts } = await live();
        const f = text(args.filter) || "all";
        const picked = accounts.filter((a) =>
          f === "at_risk" ? a.band === "at_risk" || a.churn.level === "high"
            : f === "watch" ? a.band === "watch" || a.churn.level === "medium"
              : f === "dormant" ? a.dormant
                : f === "incomplete_data" ? a.contacts > 0 && a.completenessPct < 60
                  : f === "replies_waiting" ? a.unanswered > 0 : true);
        return picked.sort((x, y) => x.score - y.score).slice(0, clamp(args.limit, 1, 100, 30)).map(summary);
      },
    },
    {
      name: "get_account",
      description: "Detailed picture of one client account, including exactly how its engagement score is made up. Match by name (partial names work).",
      inputSchema: { type: "object", properties: { name: { type: "string", description: "Account name or part of it" } }, required: ["name"] },
      run: async (args) => {
        const q = text(args.name).toLowerCase();
        if (q.length < 2) throw new Error("Give at least two characters of the account name.");
        const { accounts } = await live();
        const matches = accounts.filter((a) => (a.name ?? "").toLowerCase().includes(q));
        if (matches.length === 0) throw new Error(`No account matches "${q}".`);
        if (matches.length > 1) return { message: "Several accounts match; be more specific.", matches: matches.slice(0, 10).map((a) => a.name) };
        const a = matches[0];
        return { ...summary(a), scoreBreakdown: a.breakdown.components.map((c) => ({ part: c.label, points: `${c.points}/${c.max}`, why: c.why })) };
      },
    },
    {
      name: "search_contacts",
      description: "Find contacts across all client accounts by name, email or phone (at least 2 characters). Returns at most 20 matches.",
      inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      run: async (args) => {
        const q = text(args.query);
        if (q.length < 2) throw new Error("Give at least two characters to search for.");
        const hits = await searchContacts(installationId, q, 20);
        return hits.map((h) => ({ name: h.name, email: h.email, phone: h.phone, account: h.locationName, tags: h.tags }));
      },
    },
    {
      name: "list_stale_deals",
      description: "Open deals with no movement for a number of days, largest first, across all client accounts.",
      inputSchema: {
        type: "object",
        properties: { min_days: { type: "number", description: "Minimum days without movement (default 30)" }, limit: { type: "number", description: "Maximum deals (1-50, default 20)" } },
      },
      run: async (args) => {
        const deals = await staleDeals(installationId, clamp(args.min_days, 7, 365, 30), clamp(args.limit, 1, 50, 20));
        return deals.map((d) => ({ account: d.locationName, deal: d.name, contact: d.contactName, value: d.value, stage: d.stageName, daysStale: d.daysStale }));
      },
    },
    {
      name: "list_waiting_conversations",
      description: "Customer messages that have gone unanswered longer than your reply target, across all client accounts.",
      inputSchema: { type: "object", properties: { limit: { type: "number", description: "Maximum conversations (1-50, default 20)" } } },
      run: async (args) => {
        const { settings } = await live();
        const rows = (await inbox(installationId, settings.slaHours, 200)).filter((r) => r.overSla);
        return rows.slice(0, clamp(args.limit, 1, 50, 20)).map((r) => ({ account: r.locationName, contact: r.contactName, channel: r.lastMessageType, waitingHours: r.waitingHours }));
      },
    },
    {
      name: "list_alerts",
      description: "Open alerts raised automatically (dormant accounts, slow replies, stale deals, broken email authentication, data quality).",
      inputSchema: { type: "object", properties: { severity: { type: "string", enum: ["critical", "warning", "info"] } } },
      run: async (args) => {
        const sev = text(args.severity);
        const rows = await listAlerts(installationId, false, 100);
        return rows.filter((a) => !sev || a.severity === sev).map((a) => ({ severity: a.severity, title: a.title, raised: a.createdAt }));
      },
    },
  ];
}
