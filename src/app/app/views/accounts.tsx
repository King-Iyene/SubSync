"use client";

import { useMemo, useState } from "react";
import type { GoFn } from "../nav";
import { useApiClient, useData } from "../session";
import type { Account } from "../types";
import {
  Badge, BandBadge, Btn, ChurnBadge, daysLabel, Empty, ErrorBox, fmtInt, fmtMoney, inputClass, Loading, PageHeader, ScoreBar, Table, Td, Th,
} from "../ui";

type SortKey = "name" | "score" | "daysInactive" | "contacts" | "completenessPct" | "openValue" | "staleOpps" | "unanswered";
type Filter = "all" | "at_risk" | "watch" | "dormant" | "incomplete" | "waiting" | "ignored";

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "at_risk", label: "At risk" },
  { id: "watch", label: "Watch" },
  { id: "dormant", label: "Gone quiet" },
  { id: "incomplete", label: "Incomplete data" },
  { id: "waiting", label: "Replies waiting" },
  { id: "ignored", label: "Ignored" },
];

const matches = (a: Account, f: Filter) =>
  f === "ignored" ? a.ignored
    : a.ignored ? false
      : f === "all" ? true
        : f === "at_risk" ? a.band === "at_risk" || a.churn.level === "high"
          : f === "watch" ? a.band === "watch" || a.churn.level === "medium"
            : f === "dormant" ? a.dormant
              : f === "incomplete" ? a.contacts > 0 && a.completenessPct < 60
                : a.unanswered > 0;

export function AccountsView({ go }: { go: GoFn }) {
  const api = useApiClient();
  const { data, error, loading, reload } = useData<{ accounts: Account[]; settings: { dormantDays: number } }>("accounts");
  const [filter, setFilter] = useState<Filter>("all");
  const [text, setText] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "score", dir: 1 });

  const rows = useMemo(() => {
    const list = (data?.accounts ?? []).filter((a) => matches(a, filter) && (a.name ?? "").toLowerCase().includes(text.toLowerCase()));
    const val = (a: Account): number | string => {
      if (sort.key === "name") return (a.name ?? "").toLowerCase();
      if (sort.key === "daysInactive") return a.daysInactive ?? 10_000;
      return a[sort.key] ?? 0;
    };
    return [...list].sort((x, y) => (val(x) < val(y) ? -1 : val(x) > val(y) ? 1 : 0) * sort.dir);
  }, [data, filter, text, sort]);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;

  const head = (key: SortKey, label: string, className = "") => (
    <Th className={className} active={sort.key === key} onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === "name" || key === "score" ? 1 : -1 }))}>{label}</Th>
  );

  return (
    <div>
      <PageHeader
        title="Accounts"
        subtitle="How healthy each client account looks, whether it may leave, and how complete its contact data is."
        actions={<Btn onClick={() => api.download("export/accounts", "subsync-accounts.csv")}>Export CSV</Btn>}
      />
      <details className="mb-4 rounded-xl border bg-card px-4 py-3 text-sm" data-testid="what-this-means">
        <summary className="cursor-pointer font-medium">What do these words mean?</summary>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <div><dt className="font-medium">Health (0 to 100)</dt><dd className="text-muted-foreground">How alive the account is, from five parts: recent activity (up to 40), new contacts (20), deals that are moving (20), replies kept up with (10) and complete contact data (10). Open an account to see where every point came from.</dd></div>
          <div><dt className="font-medium">Thriving, Healthy, Watch, At risk</dt><dd className="text-muted-foreground">75 and above is Thriving, 55 to 74 Healthy, 35 to 54 Watch, under 35 At risk. Waiting customers hold the label down: with 5 or more customers waiting for a reply an account is never better than Watch, and with 15 or more it is At risk, whatever the score says.</dd></div>
          <div><dt className="font-medium">Steady, Could leave, Likely to leave</dt><dd className="text-muted-foreground">Whether the client may stop using you, from how long the account has been quiet, how low its health is and how fast its health has dropped. It is a warning sign, not a prediction.</dd></div>
          <div><dt className="font-medium">Gone quiet</dt><dd className="text-muted-foreground">No contact, deal or message activity for {data.settings.dormantDays} days or more (you can change this in Settings).</dd></div>
        </dl>
      </details>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" onClick={() => setFilter(f.id)} aria-pressed={filter === f.id}
            className={`rounded-full border px-3 py-1 text-sm ${filter === f.id ? "bg-foreground text-background" : "hover:bg-muted"}`}>
            {f.label} <span className="opacity-60">{data.accounts.filter((a) => matches(a, f.id)).length}</span>
          </button>
        ))}
        <input className={`${inputClass} ml-auto max-w-56`} placeholder="Filter by name" value={text} onChange={(e) => setText(e.target.value)} aria-label="Filter accounts by name" />
      </div>
      {rows.length === 0 ? (
        <Empty title="No accounts match" body="Try a different filter. New installs show accounts here once the first sync finishes." />
      ) : (
        <Table head={<tr>{head("name", "Account")}{head("score", "Health")}<Th>Leave risk</Th>{head("daysInactive", "Last activity")}{head("contacts", "Contacts", "text-right")}{head("completenessPct", "Data", "text-right")}{head("openValue", "Open deals", "text-right")}{head("staleOpps", "Stale", "text-right")}{head("unanswered", "Waiting", "text-right")}</tr>}>
          {rows.map((a) => (
            <tr key={a.locationId} className="hover:bg-muted/40">
              <Td>
                <button type="button" onClick={() => go("account", a.locationId)} className="text-left font-medium hover:underline">{a.name ?? "Unnamed account"}</button>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  {a.owner && <span>{a.owner}</span>}
                  {a.dormant && <Badge tone="bad">Gone quiet</Badge>}
                  {a.ignored && <Badge>Ignored</Badge>}
                  {a.syncError && <Badge tone="warn">Sync issue</Badge>}
                </div>
              </Td>
              <Td>
                <div className="flex items-center gap-2"><ScoreBar score={a.score} /><BandBadge band={a.band} /></div>
                {a.bandNote && <p className="mt-1 max-w-56 text-xs text-muted-foreground">{a.bandNote}</p>}
              </Td>
              <Td><ChurnBadge level={a.churn.level} /></Td>
              <Td>{daysLabel(a.daysInactive)}</Td>
              <Td className="whitespace-nowrap text-right tabular-nums">{fmtInt(a.contacts)}<div className="text-xs text-muted-foreground">+{a.new30d} in 30 days</div></Td>
              <Td className="text-right tabular-nums">{a.completenessPct}%</Td>
              <Td className="text-right tabular-nums">{fmtMoney(a.openValue)}</Td>
              <Td className="text-right tabular-nums">{a.staleOpps > 0 ? <span className="text-amber-600 dark:text-amber-400">{a.staleOpps}</span> : "0"}</Td>
              <Td className="text-right tabular-nums">{a.unanswered > 0 ? <span className="text-amber-600 dark:text-amber-400">{a.unanswered}</span> : "0"}</Td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
