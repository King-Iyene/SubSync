"use client";

import { useState } from "react";
import { useApiClient, useData } from "../session";
import { Badge, Btn, Card, fmtInt, fmtMoney, inputClass } from "../ui";
import type { GoFn, ViewId } from "../nav";

type Kpi = { key: string; label: string; current: number; previous: number | null; pct: number | null; money: boolean };
type Goal = { metric: string; label: string; target: number; actual: number; pct: number; projected: number; status: "achieved" | "on_track" | "at_risk" | "behind" };
type Data = {
  kpis: Kpi[]; goals: Goal[]; targets: Record<string, number>;
  anomalies: Array<{ key: string; message: string; direction: "above" | "below" }>;
};

const statusTone = { achieved: "good", on_track: "good", at_risk: "warn", behind: "bad" } as const;
const statusLabel = { achieved: "Achieved", on_track: "On track", at_risk: "At risk", behind: "Behind" } as const;
const GOALS = [
  { metric: "monthly_revenue", label: "Revenue won per month", money: true },
  { metric: "monthly_leads", label: "New contacts per month", money: false },
  { metric: "monthly_deals_won", label: "Deals won per month", money: false },
] as const;

function Arrow({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-xs text-muted-foreground">no earlier data</span>;
  if (pct === 0) return <span className="text-xs text-muted-foreground">no change</span>;
  const up = pct > 0;
  return <span className={`text-xs font-medium ${up ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{up ? "▲" : "▼"} {Math.abs(pct)}% vs before</span>;
}

// The one card to glance at: five numbers with their direction, goal progress, and anything unusual.
export function ExecSummary() {
  const api = useApiClient();
  const { data, reload } = useData<Data>("exec-summary");
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  if (!data) return null;

  const save = async () => {
    setMsg(null);
    try {
      for (const g of GOALS) {
        const raw = (values[g.metric] ?? "").trim();
        if (raw === "") continue;
        await api.put("goals", { metric: g.metric, target: raw === "0" ? null : Number(raw) });
      }
      setEditing(false);
      setValues({});
      await reload();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  return (
    <Card title="Executive summary" className="mb-4" action={<Btn variant="ghost" onClick={() => setEditing((v) => !v)}>{editing ? "Cancel" : "Set goals"}</Btn>}>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {data.kpis.map((k) => (
          <div key={k.key}>
            <dt className="text-xs text-muted-foreground">{k.label}</dt>
            <dd className="text-xl font-semibold tabular-nums">{k.money ? fmtMoney(k.current) : fmtInt(k.current)}</dd>
            <Arrow pct={k.pct} />
          </div>
        ))}
      </dl>

      {data.anomalies.length > 0 && (
        <ul className="mt-4 space-y-1 rounded-lg bg-amber-500/10 p-3 text-sm" role="status">
          {data.anomalies.map((a) => <li key={a.key}><Badge tone="warn">Unusual</Badge> {a.message}</li>)}
        </ul>
      )}

      {data.goals.length > 0 && (
        <ul className="mt-4 space-y-3">
          {data.goals.map((g) => {
            const money = g.metric === "monthly_revenue";
            const f = (n: number) => (money ? fmtMoney(n) : fmtInt(n));
            return (
              <li key={g.metric}>
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>{g.label}: <strong>{f(g.actual)}</strong> of {f(g.target)}</span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">on pace for {f(g.projected)} <Badge tone={statusTone[g.status]}>{statusLabel[g.status]}</Badge></span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-muted"><div className={`h-2 rounded-full ${g.status === "behind" ? "bg-red-500" : g.status === "at_risk" ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, g.pct)}%` }} /></div>
              </li>
            );
          })}
        </ul>
      )}

      {editing && (
        <div className="mt-4 rounded-lg border p-3">
          <p className="mb-2 text-sm font-medium">Monthly goals (leave blank to keep, enter 0 to remove)</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {GOALS.map((g) => (
              <div key={g.metric}>
                <label htmlFor={g.metric} className="mb-1 block text-xs text-muted-foreground">{g.label}</label>
                <input id={g.metric} className={inputClass} inputMode="numeric" placeholder={data.targets[g.metric] ? String(data.targets[g.metric]) : "Not set"}
                  value={values[g.metric] ?? ""} onChange={(e) => setValues({ ...values, [g.metric]: e.target.value.replace(/[^0-9.]/g, "") })} />
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-3"><Btn variant="primary" onClick={save}>Save goals</Btn>{msg && <span className="text-sm text-red-600" role="alert">{msg}</span>}</div>
        </div>
      )}
    </Card>
  );
}

type Priority = { key: string; title: string; detail: string; go: string };

// Plain rules over your own data (not an AI): the handful of things most worth doing today.
export function DailyBrief({ go }: { go: GoFn }) {
  const { data } = useData<{ priorities: Priority[] }>("daily-brief");
  if (!data || data.priorities.length === 0) return null;
  return (
    <Card title="Today's priorities" className="mb-4">
      <ol className="space-y-3">
        {data.priorities.map((p, i) => (
          <li key={p.key} className="flex gap-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{p.title}</p>
              <p className="text-xs text-muted-foreground">{p.detail}</p>
            </div>
            <Btn variant="ghost" onClick={() => go(p.go as ViewId)}>Open</Btn>
          </li>
        ))}
      </ol>
    </Card>
  );
}
