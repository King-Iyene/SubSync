"use client";

import { useState } from "react";
import { useApiClient, useData } from "../session";
import { Badge, Btn, Card, ErrorBox, Loading, PageHeader } from "../ui";

type Data = {
  items: Array<{ key: string; title: string; body: string; status: "building" | "planned"; votes: number; voted: boolean }>;
  changelog: Array<{ date: string; title: string; items: string[] }>;
};

// What is coming next (with a vote) and what changed lately.
export function RoadmapView() {
  const api = useApiClient();
  const { data, error, loading, reload } = useData<Data>("roadmap");
  const [busy, setBusy] = useState<string | null>(null);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const vote = async (key: string) => {
    setBusy(key);
    try { await api.post("roadmap", { key }); await reload(); } finally { setBusy(null); }
  };
  return (
    <div className="max-w-3xl">
      <PageHeader title="What's new and next" subtitle="Vote for what you want first. We build in the order people ask." />
      <Card title="Coming next" className="mb-6">
        <ul className="divide-y">
          {data.items.map((i) => (
            <li key={i.key} className="flex items-start justify-between gap-4 py-3">
              <div>
                <p className="flex items-center gap-2 font-medium">{i.title} <Badge tone={i.status === "building" ? "good" : "neutral"}>{i.status === "building" ? "Building" : "Planned"}</Badge></p>
                <p className="text-sm text-muted-foreground">{i.body}</p>
              </div>
              <Btn variant={i.voted ? "ghost" : undefined} disabled={busy === i.key} onClick={() => vote(i.key)}>{i.voted ? "Voted" : "Vote"} · {i.votes}</Btn>
            </li>
          ))}
        </ul>
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
