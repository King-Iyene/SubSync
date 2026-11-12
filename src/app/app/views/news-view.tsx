"use client";

import { useEffect } from "react";
import { NEWS, isFresh } from "@/lib/whats-new";
import type { GoFn, ViewId } from "../nav";
import { Badge, Btn, Card, PageHeader } from "../ui";
import { RoadmapView } from "./roadmap";
import { useStState } from "./st-state";

// What's new: every recent page and feature with its date, one line each, then the roadmap (vote and suggest) and the older change log. Opening it clears the "New" badges.
export function NewsView({ go, features }: { go: GoFn; features: Record<string, boolean> }) {
  const { set, marks } = useStState();
  useEffect(() => {
    for (const e of NEWS) if (!marks.news_seen.includes(e.id)) void set("news_seen", e.id, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const live = NEWS.filter((e) => e.feature === null || features[e.feature] === true);
  const now = Date.now();
  return (
    <div className="max-w-3xl">
      <PageHeader title="What's new" subtitle="Every page and feature that went live recently, newest first. Only things you can use today are listed." />
      <Card title="Recently added" className="mb-6">
        <ul className="divide-y" data-testid="news-list">
          {live.length === 0 && <li className="py-3 text-sm text-muted-foreground">Nothing new to list yet.</li>}
          {live.map((e) => (
            <li key={e.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0"><p className="text-xs text-muted-foreground">{e.date}</p><p className="flex flex-wrap items-center gap-2 text-sm font-medium">{e.title}{isFresh(e, now) && <Badge tone="info">New</Badge>}</p><p className="text-sm text-muted-foreground">{e.line}</p></div>
              {e.view && <div className="max-sm:[&_button]:min-h-11"><Btn onClick={() => go(e.view as ViewId)}>Open</Btn></div>}
            </li>
          ))}
        </ul>
      </Card>
      <RoadmapView />
    </div>
  );
}
