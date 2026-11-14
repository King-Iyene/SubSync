"use client";

import { useState } from "react";
import { STATUS_WORDS, type Group, type Row, type SetupCheckResult, type Status } from "@/lib/setup-check/model";
import { useData } from "../session";
import { Badge, Btn, Card, Empty, ErrorBox, Loading, PageHeader, timeAgo } from "../ui";
import { EmailTemplatesCard, StageRenameCard } from "./more-tools-ui";

// Account setup: what is set up in one account, one row per thing, with a count and one line on what to do next (docs/features/ACCOUNT_SETUP.md).
// Read only. Counts only: no names, no text, phone numbers only as their last four digits. A row that needs a permission says so in the same words everywhere.
type Data = { accounts: Array<{ id: string; name: string }>; selected: { id: string; name: string } | null; result: SetupCheckResult | null };

const GROUPS: Group[] = ["Sales", "Content", "Tasks", "Email", "Phone", "Calendar", "Account"];
const tone: Record<Status, "good" | "warn" | "bad" | "neutral"> = { set_up: "good", attention: "warn", permission: "warn", unavailable: "neutral", empty: "neutral", error: "neutral" };

function RowLine({ r }: { r: Row }) {
  return (
    <li className="py-3 first:pt-0 last:pb-0" data-testid={`as-row-${r.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="text-sm font-semibold">{r.label}</p>
        <div className="flex items-center gap-3">
          {r.countText !== null && <span className="text-lg font-semibold tabular-nums" aria-label={`Count: ${r.countText}`}>{r.countText}</span>}
          <Badge tone={tone[r.status]}>{STATUS_WORDS[r.status]}</Badge>
        </div>
      </div>
      {r.detail && <p className="mt-1 text-sm text-muted-foreground">{r.detail}</p>}
      {r.samples && r.samples.length > 0 && <p className="mt-0.5 text-xs text-muted-foreground">{r.samples.join(", ")}</p>}
      <p className="mt-1 text-sm"><span className="font-medium">Next:</span> {r.next}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">Used for: {r.why}</p>
    </li>
  );
}

export function AccountSetupView() {
  const [id, setId] = useState<string | null>(null);
  const [force, setForce] = useState(false);
  const q = new URLSearchParams();
  if (id) q.set("locationId", id);
  if (force) q.set("fresh", "1");
  const { data, error, loading, reload } = useData<Data>(`setup-check${q.size ? `?${q}` : ""}`);

  if (loading && !data) return <Loading label="Checking this account..." />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  if (!data.selected || !data.result) return <Empty title="No client accounts yet" body="Accounts appear here once the first sync finishes." />;
  const { result, selected } = data;
  const recheck = () => { if (force) reload(); else setForce(true); };

  return (
    <div data-testid="account-setup">
      <PageHeader
        title="Account setup"
        subtitle="What is set up in this account, with a count and one thing to do next. SubSync keeps counts only: no names, no message or note text, and phone numbers only by their last four digits."
        actions={<Btn onClick={recheck} disabled={loading}>{loading ? "Checking..." : "Check again"}</Btn>}
      />
      {data.accounts.length > 1 && (
        <label className="mb-4 flex max-w-md flex-col gap-1 text-sm">
          <span className="font-medium">Account</span>
          <select className="rounded-lg border bg-card px-3 py-2 text-sm" value={selected.id} onChange={(e) => { setId(e.target.value); setForce(false); }} aria-label="Account to check">
            {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
      )}
      <p className="mb-1 text-sm font-medium" role="status">{result.headline}</p>
      <p className="mb-5 text-xs text-muted-foreground">
        {selected.name}: {result.summary.setUp} set up, {result.summary.attention} need attention, {result.summary.permission} need a permission, {result.summary.unavailable} not available from the platform yet. Checked {timeAgo(result.checkedAt)}{result.cached ? " (saved copy, under five minutes old)" : ""}.
      </p>
      {result.problem && <p className="mb-4 rounded-lg border border-red-500/40 bg-red-500/5 px-3 py-2 text-sm" role="alert">{result.problem}</p>}
      <div className="space-y-6">
        {GROUPS.map((g) => {
          const rows = result.rows.filter((r) => r.group === g);
          if (rows.length === 0) return null;
          return <Card key={g} title={g}><ul className="divide-y">{rows.map((r) => <RowLine key={r.id} r={r} />)}</ul></Card>;
        })}
        <EmailTemplatesCard locationId={selected.id} />
        <StageRenameCard locationId={selected.id} />
      </div>
    </div>
  );
}
