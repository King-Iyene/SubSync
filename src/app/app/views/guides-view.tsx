"use client";

import { useEffect, useRef, useState } from "react";
import { GUIDES, extraSteps, type ProgressFacts } from "@/lib/guides";
import type { Step } from "@/lib/getting-started";
import { SETTINGS_SECTION_KEY } from "@/lib/settings-sections";
import { remember, remembered } from "../ds/remember";
import type { GoFn, ViewId } from "../nav";
import { useData } from "../session";
import { Badge, Btn, Card, ErrorBox, inputClass, Loading, PageHeader } from "../ui";
import { GUIDE_REQUEST_KEY, useStState } from "./st-state";

type Start = { role: string; steps: Step[]; doneCount: number; total: number };
type Progress = { canManage: boolean; facts: ProgressFacts };
const HUB_KEY = "settings-hub-section";

// Getting started, rebuilt: a checklist that ticks from real facts (the older steps plus permissions, roles, Slack, Fathom, first audit, first daily brief),
// and a 60-second guide for every page. The ? button and every empty state open the right guide.
export function GuidesView({ go }: { go: GoFn }) {
  const start = useData<Start>("start");
  const prog = useData<Progress>("st/progress");
  const { marks, set } = useStState();
  const [q, setQ] = useState("");
  const [openId] = useState<string | null>(() => remembered(GUIDE_REQUEST_KEY));
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!openId) return;
    remember(GUIDE_REQUEST_KEY, null);
    ref.current?.scrollIntoView({ block: "start" });
    void set("guide_read", openId, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);
  if ((start.loading && !start.data) || (prog.loading && !prog.data)) return <Loading />;
  if (start.error) return <ErrorBox error={start.error} onRetry={start.reload} />;
  if (!start.data) return null;

  const extras = prog.data ? extraSteps(prog.data.facts, prog.data.canManage) : [];
  const rows = [
    ...start.data.steps.filter((s) => s.id !== "connected").map((s) => ({ id: s.id, title: s.title, body: s.body, done: s.done, view: s.view as string | null, section: s.section as string | undefined, cta: s.cta })),
    ...extras.map((e) => ({ id: e.id, title: e.title, body: e.body, done: e.done, view: e.view as string | null, section: e.section, cta: e.cta as string | null })),
  ];
  const done = rows.filter((r) => r.done).length;
  const pct = Math.round((done / Math.max(1, rows.length)) * 100);
  const nextId = rows.find((r) => !r.done && r.view)?.id;
  const open = (r: (typeof rows)[number]) => {
    if (r.view === "settings" && r.section) {
      remember(HUB_KEY, r.section === "notifications" ? "alerts" : r.section === "integrations" ? "connections" : r.section === "brand" ? "account" : r.section);
      remember(SETTINGS_SECTION_KEY, r.section === "alerts" ? "notifications" : r.section === "connections" ? "integrations" : r.section);
    }
    go(r.view as ViewId);
  };
  const term = q.trim().toLowerCase();
  const guides = GUIDES.filter((g) => !term || `${g.title} ${g.shows} ${g.read.join(" ")} ${g.next} ${g.more ? g.more.read.join(" ") : ""}`.toLowerCase().includes(term));

  return (
    <div className="max-w-3xl">
      <PageHeader title="Getting started" subtitle="A checklist that ticks itself off from what you really did, and a 60-second guide for every page." actions={<Badge tone={pct === 100 ? "good" : "info"}>{done} of {rows.length} done</Badge>} />
      <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Setup progress"><div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} /></div>
      <ol className="divide-y border-y" data-testid="guide-steps">
        {rows.map((r, i) => (
          <li key={r.id} className="flex gap-4 py-4" data-step={r.id} data-done={r.done ? "true" : "false"}>
            <span className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-medium ${r.done ? "bg-success text-background" : "border"}`} aria-label={r.done ? "Done" : `Step ${i + 1}`}>{r.done ? "✓" : i + 1}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{r.title}</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{r.body}</p>
              {r.view && r.cta && <div className="mt-2 max-sm:[&_button]:min-h-11"><Btn variant={r.id === nextId ? "primary" : "secondary"} onClick={() => open(r)}>{r.done ? r.cta : "Do it now"}</Btn></div>}
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-8" ref={ref}>
        <h2 className="text-lg font-semibold tracking-tight">Guides</h2>
        <p className="mb-3 text-sm text-muted-foreground">One minute each: what the page shows, how to read it, what to do next.</p>
        <label htmlFor="guide-q" className="sr-only">Search guides</label>
        <input id="guide-q" type="search" className={`${inputClass} mb-3 sm:max-w-sm`} placeholder="Search guides" value={q} onChange={(e) => setQ(e.target.value)} data-testid="guide-search" />
        <div className="space-y-2" data-testid="guide-list">
          {guides.length === 0 && <p className="text-sm text-muted-foreground">No guide matches. Try another word.</p>}
          {guides.map((g) => (
            <Card key={g.id}>
              <details open={openId === g.id} onToggle={(e) => { if ((e.target as HTMLDetailsElement).open) void set("guide_read", g.id, true); }} data-guide={g.id}>
                <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-2 font-medium">{g.title}{marks.guide_read.includes(g.id) && <Badge tone="good">Read</Badge>}</summary>
                <div className="space-y-2 pt-2 text-sm">
                  <p><strong className="font-medium">What it shows.</strong> {g.shows}</p>
                  {g.tabs && g.tabs.length > 0 && <p className="text-muted-foreground">Screens: {g.tabs.join(", ")}.</p>}
                  <div><strong className="font-medium">How to read it.</strong><ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">{g.read.map((t) => <li key={t}>{t}</li>)}</ul></div>
                  <p><strong className="font-medium">Do next.</strong> {g.next}</p>
                  {g.more && <div><strong className="font-medium">{g.more.title}.</strong><ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">{g.more.read.map((t) => <li key={t}>{t}</li>)}</ul></div>}
                  <div className="max-sm:[&_button]:min-h-11"><Btn onClick={() => go(g.view as ViewId)}>Open {g.title}</Btn></div>
                </div>
              </details>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
