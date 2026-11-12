"use client";

import { useState } from "react";
import { IMPORTANCE, IMPORTANCE_LABEL, SUGGEST_DETAILS_MAX, SUGGEST_TITLE_MAX, type Importance } from "@/lib/feedback";
import type { RoadmapStatus } from "@/lib/roadmap";
import { useApiClient, useData } from "../session";
import { Badge, Btn, Card, ErrorBox, inputClass, Loading, PageHeader } from "../ui";

type Item = { key: string; title: string; body: string; status: RoadmapStatus; label: string; stage: string; votes: number; voted: boolean };
type Data = {
  items: Item[]; statusMeaning: Record<RoadmapStatus, string>;
  changelog: Array<{ date: string; title: string; items: string[] }>;
  mine: Array<{ id: string; reference: string; title: string; importance: string; status: string; createdAt: string }>;
};

// The order the groups are shown in, and the badge tone of each (shipped is the only good news; "considering" is deliberately not a promise).
const GROUPS: Array<{ status: RoadmapStatus; tone: "good" | "info" | "neutral" | "warn" }> = [
  { status: "building", tone: "info" }, { status: "planned", tone: "neutral" }, { status: "considering", tone: "warn" }, { status: "shipped", tone: "good" },
];
const SUGGESTION_LABEL: Record<string, string> = { new: "Received", planned: "Planned", building: "In progress", shipped: "Shipped", declined: "Not planned" };

// What is coming next (with a vote), what you can suggest, and what changed lately. Votes help us decide what to build next; they do not set the order, because
// we also sequence by risk and by what has to come first (N86).
export function RoadmapView({ embedded = false }: { embedded?: boolean } = {}) {
  const api = useApiClient();
  const { data, error, loading, reload } = useData<Data>("roadmap");
  const [busy, setBusy] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [importance, setImportance] = useState<Importance>("nice");
  const [sent, setSent] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;

  const vote = async (key: string) => {
    setBusy(key);
    try { await api.post("roadmap", { key }); await reload(); } finally { setBusy(null); }
  };
  const suggest = async () => {
    setBusy("suggest"); setProblem(null); setSent(null);
    try {
      const r = await api.post<{ reference: string }>("roadmap/suggest", { title, details, importance, page: "roadmap" });
      setSent(r.reference); setTitle(""); setDetails(""); await reload();
    } catch (e) {
      setProblem((e as Error).message);
    } finally { setBusy(null); }
  };

  return (
    <div className="max-w-3xl">
      {/* Inside What's new the page already has its one h1, so this part is a section with an h2 (one h1 per page). */}
      {embedded
        ? <div className="mb-4"><h2 className="text-lg font-semibold tracking-tight">What&apos;s new and next</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">Votes help us decide what to build next. Vote once for anything you want, and suggest what is missing.</p></div>
        : <PageHeader title="What's new and next" subtitle="Votes help us decide what to build next. Vote once for anything you want, and suggest what is missing." />}

      {GROUPS.map(({ status, tone }) => {
        const items = data.items.filter((i) => i.status === status);
        if (items.length === 0) return null;
        return (
          <Card key={status} title={items[0].label} className="mb-6">
            <p className="mb-2 text-sm text-muted-foreground" data-testid={`meaning-${status}`}>{data.statusMeaning[status]}</p>
            <ul className="divide-y" data-testid={`items-${status}`}>
              {items.map((i) => (
                <li key={i.key} className="flex items-start justify-between gap-4 py-3">
                  <div>
                    <p className="flex flex-wrap items-center gap-2 font-medium">{i.title} <Badge tone={tone}>{i.label}</Badge></p>
                    <p className="text-sm text-muted-foreground">{i.body}</p>
                  </div>
                  {status !== "shipped" && <span className="shrink-0 whitespace-nowrap"><Btn variant={i.voted ? "ghost" : undefined} disabled={busy === i.key} onClick={() => vote(i.key)}>{i.voted ? "Voted" : "Vote"} · {i.votes}</Btn></span>}
                </li>
              ))}
            </ul>
          </Card>
        );
      })}

      <Card title="Suggest something" className="mb-6">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void suggest(); }}>
          <div>
            <label htmlFor="sg-title" className="mb-1 block text-sm font-medium">What would help?</label>
            <input id="sg-title" className={inputClass} maxLength={SUGGEST_TITLE_MAX} required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="For example: a weekly summary per team member" />
          </div>
          <div>
            <label htmlFor="sg-details" className="mb-1 block text-sm font-medium">Tell us more (optional)</label>
            <textarea id="sg-details" rows={3} className={inputClass} maxLength={SUGGEST_DETAILS_MAX} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="What are you trying to do, and what gets in the way today?" />
          </div>
          <div>
            <label htmlFor="sg-importance" className="mb-1 block text-sm font-medium">How much does it matter to you?</label>
            <select id="sg-importance" className={`${inputClass} max-w-sm`} value={importance} onChange={(e) => setImportance(e.target.value as Importance)}>
              {IMPORTANCE.map((v) => <option key={v} value={v}>{IMPORTANCE_LABEL[v]}</option>)}
            </select>
          </div>
          {problem && <p className="border-l-2 border-destructive py-1 pl-3 text-sm" role="alert">{problem}</p>}
          {sent && <p className="border-l-2 border-primary py-1 pl-3 text-sm" role="status" data-testid="suggest-done">Thank you. We read every suggestion. Your reference is <strong className="font-mono">{sent}</strong>.</p>}
          <Btn type="submit" variant="primary" disabled={busy === "suggest" || title.trim().length === 0}>{busy === "suggest" ? "Sending..." : "Send suggestion"}</Btn>
        </form>
        {data.mine.length > 0 && (
          <div className="mt-5">
            <p className="mb-1 text-sm font-medium">Your suggestions</p>
            <ul className="divide-y rounded-lg border text-sm" data-testid="my-suggestions">
              {data.mine.map((m) => <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"><span>{m.title} <span className="font-mono text-xs text-muted-foreground">{m.reference}</span></span><Badge tone={m.status === "shipped" ? "good" : "neutral"}>{SUGGESTION_LABEL[m.status] ?? m.status}</Badge></li>)}
            </ul>
          </div>
        )}
      </Card>

      <Card title="Change log">
        <ul className="space-y-4">
          {data.changelog.map((c) => (
            <li key={c.date + c.title}>
              <p className="text-xs text-muted-foreground">{c.date}</p>
              <p className="font-medium">{c.title}</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">{c.items.map((t) => <li key={t}>{t}</li>)}</ul>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
