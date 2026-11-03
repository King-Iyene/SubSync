"use client";

import { useMemo, useState } from "react";
import { bandGroups, healthBars, needsAttention } from "@/lib/analytics/client-success";
import type { GoFn } from "../nav";
import { useApiClient, useData } from "../session";
import type { Account } from "../types";
import { BarChart, DataList, EmptyState, Section, useDrill } from "../ds";
import {
  Badge, BandBadge, Btn, ChurnBadge, daysLabel, ErrorBox, fmtInt, fmtMoney, inputClass, Loading, PageHeader, ScoreBar, Table, Td, Th,
} from "../ui";
import { ClientTrends } from "./clients/trends";

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

// The Health tab of the Clients module (and, on its own, the old Accounts page): how healthy each client account looks, who to call first, and each
// client's trend. `embedded` leaves out the page title, because the module draws it.
export function AccountsView({ go, embedded = false }: { go: GoFn; embedded?: boolean }) {
  const api = useApiClient();
  const { data, error, loading, reload } = useData<{ accounts: Account[]; settings: { dormantDays: number } }>("accounts");
  const [filter, setFilter] = useState<Filter>("all");
  const [text, setText] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "score", dir: 1 });
  const [trends, setTrends] = useState<string | null>(null);
  const drill = useDrill();

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

  const live = data.accounts.filter((a) => !a.ignored);
  // The clients to look at first, and the label shown INSIDE that list: never Healthy or Thriving there (N16, client-success.ts).
  const first = needsAttention(live.map((a) => ({ ...a, churn: a.churn.level, bandNote: a.bandNote ?? null })), 6);
  const groups = bandGroups(live);
  const picked = drill.selected !== null ? groups[drill.selected] : undefined;

  const head = (key: SortKey, label: string, className = "") => (
    <Th className={className} active={sort.key === key} onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === "name" || key === "score" ? 1 : -1 }))}>{label}</Th>
  );

  return (
    <div>
      {!embedded && (
        <PageHeader
          title="Accounts"
          subtitle="How healthy each client account looks, whether it may leave, and how complete its contact data is."
          actions={<Btn onClick={() => api.download("export/accounts", "subsync-accounts.csv")}>Export CSV</Btn>}
        />
      )}
      {embedded && live.length > 0 && (
        <>
          <Section title="Who to call first" hint="Clients with customers waiting, gone quiet, or likely to leave. Worst first.">
            {first.length === 0 ? (
              <EmptyState compact title="Nobody needs a call right now" body="No client has customers waiting, has gone quiet, or looks likely to leave." />
            ) : (
              <DataList rows={first} rowKey={(a) => a.locationId} caption="Clients to call first"
                columns={[
                  { key: "name", header: "Client", primary: true, width: "minmax(0,2fr)", cell: (a) => <button type="button" onClick={() => go("account", a.locationId)} className="min-h-9 text-left text-sm font-medium hover:underline">{a.name ?? "Unnamed account"}</button> },
                  { key: "label", header: "Health", width: "7rem", cell: (a) => <Badge tone={a.label === "At risk" ? "bad" : "warn"}>{a.label}</Badge> },
                  { key: "why", header: "Why", width: "minmax(0,3fr)", cell: (a) => <span className="text-muted-foreground">{a.reasons.join(" · ")}</span> },
                ]} />
            )}
          </Section>
          <Section title="Clients by health" hint="Click a bar to see the clients behind it.">
            <BarChart title="Clients by health" axisLabel="clients" noun="clients" unit="" min={1} need="client accounts"
              bars={healthBars(groups)}
              onSelect={(i) => drill.select(i)} selected={drill.selected} />
            {picked && drill.open && (
              <section className="mt-4" aria-label={`Clients: ${picked.label}`} data-testid="drill-panel">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">{picked.label}: <span data-testid="drill-count">{picked.rows.length}</span> {picked.rows.length === 1 ? "client" : "clients"}</h3>
                  <button type="button" onClick={drill.close} className="min-h-9 text-xs font-medium text-primary underline" data-testid="drill-back">Back to the chart</button>
                </div>
                <DataList rows={picked.rows} rowKey={(a) => a.locationId} caption={`Clients: ${picked.label}`} onOpen={(a) => go("account", a.locationId)}
                  columns={[
                    { key: "name", header: "Client", primary: true, width: "minmax(0,2fr)", cell: (a) => a.name ?? "Unnamed account" },
                    { key: "score", header: "Health score", width: "8rem", cell: (a) => `${a.score} of 100` },
                    { key: "risk", header: "Leave risk", width: "9rem", cell: (a) => <ChurnBadge level={a.churn.level} /> },
                    { key: "wait", header: "Waiting", width: "7rem", cell: (a) => (a.unanswered > 0 ? `${a.unanswered} waiting` : "none") },
                  ]} />
              </section>
            )}
            {picked && !drill.open && <p className="mt-3 text-xs text-muted-foreground" data-testid="drill-closed">{picked.label}: {picked.rows.length} clients. <button type="button" onClick={drill.reopen} className="font-medium text-primary underline">Show the list</button></p>}
          </Section>
        </>
      )}
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
        {embedded && <Btn onClick={() => api.download("export/accounts", "subsync-accounts.csv")}>Export CSV</Btn>}
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No accounts match" body="Try a different filter. New installs show accounts here once the first sync finishes." />
      ) : (
        <Table head={<tr>{head("name", "Account")}{head("score", "Health")}<Th>Leave risk</Th>{head("daysInactive", "Last activity")}{head("contacts", "Contacts", "text-right")}{head("completenessPct", "Data", "text-right")}{head("openValue", "Open deals", "text-right")}{head("staleOpps", "Stale", "text-right")}{head("unanswered", "Waiting", "text-right")}</tr>}>
          {rows.flatMap((a) => [
            <tr key={a.locationId} className="hover:bg-muted/40">
              <Td>
                <button type="button" onClick={() => go("account", a.locationId)} className="text-left font-medium hover:underline">{a.name ?? "Unnamed account"}</button>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  {a.owner && <span>{a.owner}</span>}
                  {a.dormant && <Badge tone="bad">Gone quiet</Badge>}
                  {a.ignored && <Badge>Ignored</Badge>}
                  {a.syncError && <Badge tone="warn">Sync issue</Badge>}
                </div>
                {embedded && <button type="button" onClick={() => setTrends(trends === a.locationId ? null : a.locationId)} aria-expanded={trends === a.locationId} className="mt-1 min-h-8 text-xs font-medium text-primary underline-offset-4 hover:underline">{trends === a.locationId ? "Hide trends" : "Show trends"}</button>}
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
              <Td className="text-right tabular-nums">{a.staleOpps > 0 ? <span className="text-warning">{a.staleOpps}</span> : "0"}</Td>
              <Td className="text-right tabular-nums">{a.unanswered > 0 ? <span className="text-warning">{a.unanswered}</span> : "0"}</Td>
            </tr>,
            ...(embedded && trends === a.locationId ? [<tr key={`${a.locationId}-trends`}><td colSpan={9} className="bg-muted/20 px-3 py-4"><ClientTrends locationId={a.locationId} name={a.name ?? "this client"} /></td></tr>] : []),
          ])}
        </Table>
      )}
    </div>
  );
}
