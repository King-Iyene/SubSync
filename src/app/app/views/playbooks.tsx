"use client";

import { useState } from "react";
import type { GoFn } from "../nav";
import { useApiClient, useData } from "../session";
import { Badge, Btn, Card, Empty, ErrorBox, Loading, PageHeader } from "../ui";

type Playbook = {
  id: string; label: string; replyHours: number; replyWhy: string; staleDays: number; watch: string[]; callLists: Array<{ id: string; why: string }>;
  checklist: string[]; privacy: string | null; accounts: Array<{ locationId: string; name: string | null }>;
};
type Data = { playbooks: Playbook[]; industryTargets: boolean; globalReplyHours: number; accountsWithoutIndustry: number };

const LIST_NAME: Record<string, string> = {
  noshow_recovery: "No-shows to rebook", customers_followup: "Customers due a check-in", new_unanswered: "New leads with no reply", lead_recency: "Newest leads",
  hot_uncontacted: "Hot leads not contacted", win_back: "Win-back", recent_customers: "Recent customers", proposal_stale: "Proposal stage, quiet",
};

export function PlaybooksView({ go, embedded = false }: { go: GoFn; embedded?: boolean }) {
  const api = useApiClient();
  const { data, error, loading, reload } = useData<Data>("playbooks");
  const [msg, setMsg] = useState<string | null>(null);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const present = data.playbooks.filter((p) => p.accounts.length > 0);
  const others = data.playbooks.filter((p) => p.accounts.length === 0);

  const toggle = async () => {
    setMsg(null);
    try {
      await api.put("settings", { industryTargets: !data.industryTargets });
      await reload();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const addChecklist = async (p: Playbook) => {
    setMsg(null);
    try {
      const cur = await api.get<{ settings: { customChecklist: string[] } }>("settings");
      const merged = [...new Set([...cur.settings.customChecklist, ...p.checklist])].slice(0, 10);
      await api.put("settings", { customChecklist: merged });
      setMsg(`Added ${p.label} steps to your onboarding checklist (up to 10 custom steps are kept).`);
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const card = (p: Playbook) => (
    <Card key={p.id} title={p.label} action={p.accounts.length > 0 ? <Badge tone="info">{p.accounts.length} of your clients</Badge> : undefined}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 text-sm">
        <div>
          <p className="font-medium">What matters most</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">{p.watch.map((w) => <li key={w}>{w}</li>)}</ul>
          <p className="mt-3 font-medium">Reply target that fits</p>
          <p className="mt-1 text-muted-foreground">{p.replyHours} hour{p.replyHours === 1 ? "" : "s"}. {p.replyWhy}</p>
        </div>
        <div>
          <p className="font-medium">Call lists to use</p>
          <ul className="mt-1 space-y-0.5 text-muted-foreground">{p.callLists.map((c) => <li key={c.id}><span className="text-foreground">{LIST_NAME[c.id] ?? c.id}</span>: {c.why}</li>)}</ul>
          <p className="mt-3 font-medium">Setup steps</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">{p.checklist.map((c) => <li key={c}>{c}</li>)}</ul>
        </div>
      </div>
      {p.privacy && <p className="mt-3 rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">{p.privacy}</p>}
      {p.accounts.length > 0 && <p className="mt-3 text-xs text-muted-foreground">Your clients here: {p.accounts.map((a) => a.name ?? "Unnamed").join(", ")}.</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Btn onClick={() => addChecklist(p)}>Add these steps to my checklist</Btn>
        <Btn variant="ghost" onClick={() => go("calls")}>Open call lists</Btn>
      </div>
    </Card>
  );

  return (
    <div>
      {embedded ? (
        <div className="mb-4 border-t pt-6" data-testid="playbooks-heading">
          <h2 className="text-base font-semibold">Industry playbooks and reply targets</h2>
          <p className="mt-0.5 max-w-2xl text-xs text-muted-foreground">A clinic, an estate agent and a boutique need different things. Choose each client&apos;s industry in the table above and SubSync groups them here, with the reply target, call lists and checklist that fit.</p>
        </div>
      ) : (
        <PageHeader title="Industry playbooks" subtitle="A clinic, an estate agent and a boutique need different things from the same app. Choose each client's industry on the Clients page and SubSync groups them here, with the numbers and lists that matter for that kind of business." />
      )}
      {msg && <p className="mb-4 rounded-lg border bg-muted/40 px-3 py-2 text-sm" role="status">{msg}</p>}

      <Card title="Reply targets by industry" className="mb-6">
        <p className="mb-3 text-sm text-muted-foreground">
          Today uses one reply target for everyone ({data.globalReplyHours} hours). Switch this on and each client is judged by its own industry&apos;s target instead: a plumber or an estate agent is overdue after an hour, a boutique after eight.
          Clients with no industry set keep your number.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Btn variant={data.industryTargets ? "secondary" : "primary"} onClick={toggle}>{data.industryTargets ? "Switch off industry targets" : "Use each industry's target"}</Btn>
          <Badge tone={data.industryTargets ? "good" : "neutral"}>{data.industryTargets ? "On" : "Off"}</Badge>
          {data.accountsWithoutIndustry > 0 && <button type="button" className="text-xs underline" onClick={() => go("clients")}>{data.accountsWithoutIndustry} client{data.accountsWithoutIndustry === 1 ? " has" : "s have"} no industry set</button>}
        </div>
      </Card>

      {present.length === 0 ? (
        <Empty title="No industries recognised yet" body="Choose an industry for each client in the table above (for example Medical and dental, Real estate, Home services) and the matching playbook appears here." />
      ) : (
        <div className="space-y-4">{present.map(card)}</div>
      )}
      {others.length > 0 && (
        <details className="mt-6">
          <summary className="cursor-pointer text-sm text-muted-foreground">Other playbooks ({others.length})</summary>
          <div className="mt-3 space-y-4">{others.map(card)}</div>
        </details>
      )}
    </div>
  );
}
