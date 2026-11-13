"use client";

import type { ReactNode } from "react";
import type { BrandId } from "@/lib/brand-marks";
import { calendarLine, calendarStatus, SLACK_CHAT_NOTE, slackChatLine, slackChatState, type Chip, type SlackChatFacts } from "@/lib/connections/tools-status";
import { BrandIcon } from "../ds/brand-icon";
import { Badge } from "../ui";

// Shared pieces of the "Your tools" list in Settings, Connections: one row style for every tool, the "What's connected" strip, the Calendars row body and the Slack chat line.

export function ToolIcon({ brand }: { brand: BrandId | "ai" }) {
  if (brand !== "ai") return <BrandIcon id={brand} size={26} />;
  return (
    <span className="inline-flex size-[38px] shrink-0 items-center justify-center rounded-lg border border-black/10 bg-white" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="24" height="24" focusable="false"><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4z" fill="#7c3aed" /><path d="M19 3l.9 2.1L22 6l-2.1.9L19 9l-.9-2.1L16 6l2.1-.9z" fill="#a78bfa" /></svg>
    </span>
  );
}

export function ToolRow({ id, icon, name, tone, status, line, what, owner, children }: { id: string; icon: BrandId | "ai"; name: string; tone: Parameters<typeof Badge>[0]["tone"]; status: string; line: ReactNode; what: string; owner: string; children?: ReactNode }) {
  return (
    <li className="flex gap-3 py-4 scroll-mt-4" id={`tool-${id}`} data-testid={`tool-${id}`}>
      <ToolIcon brand={icon} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold">{name}</h3><Badge tone={tone}>{status}</Badge></div>
        <p className="mt-0.5 text-sm">{line}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{what}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">Owned by: {owner}</p>
        {children && <div className="mt-2 max-sm:[&_button]:min-h-11">{children}</div>}
      </div>
    </li>
  );
}

/** Four chips at the top of the page: what is connected right now. */
export function WhatsConnected({ chips }: { chips: Chip[] }) {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-2 rounded-lg border bg-card px-3 py-3" aria-label="What's connected" data-testid="whats-connected">
      {chips.map((c) => (
        <li key={c.name} className="flex items-center gap-2 text-sm"><span className="font-medium">{c.name}</span><Badge tone={c.tone}>{c.text}</Badge></li>
      ))}
    </ul>
  );
}

export type Calendars = { count: number; mapped: number; permissionMissing: boolean; items: Array<{ name: string; active: boolean; mapped: boolean }> };

export function calendarFacts(c: Calendars) { return { status: calendarStatus(c), line: calendarLine(c) }; }

export function CalendarList({ calendars }: { calendars: Calendars }) {
  if (calendars.permissionMissing || calendars.items.length === 0) return null;
  return (
    <div data-testid="calendar-list">
      <ul className="divide-y rounded-lg border text-sm">
        {calendars.items.map((c, i) => (
          <li key={`${c.name}-${i}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <span className="min-w-0 truncate">{c.name}{c.active ? "" : " (switched off)"}</span>
            <Badge tone={c.mapped ? "good" : "neutral"}>{c.mapped ? "Team member attached" : "No team member"}</Badge>
          </li>
        ))}
      </ul>
      {calendars.count > calendars.items.length && <p className="mt-1 text-xs text-muted-foreground">Showing {calendars.items.length} of {calendars.count}.</p>}
    </div>
  );
}

/** The Slack chat status line, and the note that chat uses the customer's own AI (with a link to the AI row when none is connected). */
export function SlackChatLine({ chat, aiConnected }: { chat: SlackChatFacts; aiConnected: boolean }) {
  const state = slackChatState(chat);
  return (
    <div className="mt-1" data-testid="slack-chat-line" data-state={state}>
      <p className="text-sm">{slackChatLine(chat)}</p>
      {state !== "off" && <p className="text-xs text-muted-foreground">{SLACK_CHAT_NOTE}{!aiConnected && <> <a className="font-medium underline underline-offset-4" href="#tool-ai">AI is not connected yet. Connect your AI.</a></>}</p>}
    </div>
  );
}
