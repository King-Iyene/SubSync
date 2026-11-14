"use client";

import { guideDocHref } from "@/lib/site/doc-map";
import { useState, type ReactNode } from "react";
import type { BrandId } from "@/lib/brand-marks";
import { CALENDAR_FIX, CALENDAR_KEY, calendarLine, calendarStatus, type CalendarItem, SLACK_CHAT_NOTE, slackChatLine, slackChatState, type Chip, type SlackChatFacts } from "@/lib/connections/tools-status";
import { BrandIcon } from "../ds/brand-icon";
import { remember } from "../ds/remember";
import { GUIDE_REQUEST_KEY } from "./st-state";
import { Badge } from "../ui";

// Shared pieces of the "Your tools" list in Settings, Connections: one row style for every tool, the "What's connected" strip, the Calendars row body and the Slack chat line.

export function ToolIcon({ brand }: { brand: BrandId | "ai" | "mail" }) {
  if (brand === "mail") return (
    <span className="inline-flex size-[38px] shrink-0 items-center justify-center rounded-lg border border-black/10 bg-white" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="24" height="24" focusable="false" fill="none" stroke="#475569" strokeWidth="1.6" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3.5 7l8.5 6.5L20.5 7" /></svg>
    </span>
  );
  if (brand !== "ai") return <BrandIcon id={brand} size={26} />;
  return (
    <span className="inline-flex size-[38px] shrink-0 items-center justify-center rounded-lg border border-black/10 bg-white" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="24" height="24" focusable="false"><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4z" fill="#7c3aed" /><path d="M19 3l.9 2.1L22 6l-2.1.9L19 9l-.9-2.1L16 6l2.1-.9z" fill="#a78bfa" /></svg>
    </span>
  );
}

export function ToolRow({ id, icon, name, tone, status, line, what, owner, guide, children }: { id: string; icon: BrandId | "ai" | "mail"; name: string; tone: Parameters<typeof Badge>[0]["tone"]; status: string; line: ReactNode; what: string; owner?: string; guide?: string; children?: ReactNode }) {
  return (
    <li className="flex gap-3 py-4 scroll-mt-4" id={`tool-${id}`} data-testid={`tool-${id}`}>
      <ToolIcon brand={icon} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold">{name}</h3><Badge tone={tone}>{status}</Badge></div>
        <p className="mt-0.5 text-sm">{line}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{what}</p>
        {owner && <p className="mt-0.5 text-xs text-muted-foreground">Owned by: {owner}</p>}
        {guide && <p className="mt-0.5 text-xs"><a href="#help" className="inline-flex min-h-9 items-center font-medium underline underline-offset-4" data-testid={`how-${id}`} onClick={() => remember(GUIDE_REQUEST_KEY, guide)}>How this works</a>{guideDocHref(guide) && <a className="ml-4 inline-flex min-h-9 items-center underline underline-offset-4" href={guideDocHref(guide) as string} target="_blank" rel="noopener noreferrer">Read the full guide</a>}</p>}
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

export type Calendars = { count: number; mapped: number; permissionMissing: boolean; items: CalendarItem[]; accounts: Array<{ locationId: string; name: string; url: string }> };

export function calendarFacts(c: Calendars) { return { status: calendarStatus(c), line: calendarLine(c) }; }

const linkClass = "inline-flex min-h-9 items-center gap-1.5 rounded-lg border bg-card px-3 py-1 text-xs font-medium hover:border-primary/40 hover:bg-accent/50";

/** A plain link that opens a page in the person's CRM in a new tab. No change is made to anything. */
function CrmLink({ href, children, testId }: { href: string; children: ReactNode; testId?: string }) {
  return <a className={linkClass} href={href} target="_blank" rel="noopener noreferrer" data-testid={testId}>{children}</a>;
}

/** The Calendars card body: the list with one link per row, the key to the labels, and "Connect Google or Outlook calendar" (an account picker first when there are several accounts). Links only. */
export function CalendarList({ calendars }: { calendars: Calendars }) {
  const [picking, setPicking] = useState(false);
  if (calendars.permissionMissing) return null;
  const accounts = calendars.accounts ?? [];
  return (
    <div className="space-y-2" data-testid="calendar-list">
      {calendars.items.length > 0 && (
        <>
          <ul className="divide-y rounded-lg border text-sm">
            {calendars.items.map((c, i) => (
              <li key={`${c.name}-${i}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0 truncate">{c.name}{c.active ? "" : " (switched off)"}</span>
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone={c.mapped ? "good" : "neutral"}>{c.mapped ? "Person assigned" : "No person assigned"}</Badge>
                  {c.crmUrl && !c.mapped && c.active && <CrmLink href={c.crmUrl} testId="calendar-fix">Fix in your CRM</CrmLink>}
                  {c.crmUrl && !c.active && <CrmLink href={c.crmUrl} testId="calendar-open">Open in your CRM</CrmLink>}
                </span>
              </li>
            ))}
          </ul>
          {calendars.count > calendars.items.length && <p className="text-xs text-muted-foreground">Showing {calendars.items.length} of {calendars.count}.</p>}
          <p className="text-xs text-muted-foreground" data-testid="calendar-key">{CALENDAR_KEY}</p>
          {calendars.items.some((c) => !c.mapped && c.active) && <p className="text-xs text-muted-foreground">{CALENDAR_FIX}</p>}
        </>
      )}
      {accounts.length === 1 && <CrmLink href={accounts[0].url} testId="calendar-connect">Connect Google or Outlook calendar</CrmLink>}
      {accounts.length > 1 && (
        <div>
          <button type="button" className={linkClass} aria-expanded={picking} onClick={() => setPicking((v) => !v)} data-testid="calendar-connect">Connect Google or Outlook calendar</button>
          {picking && (
            <div className="mt-2 rounded-lg border p-2" data-testid="calendar-picker">
              <p className="mb-1 text-xs text-muted-foreground">Which account? This opens its calendar settings in your CRM.</p>
              <ul className="flex flex-wrap gap-2">
                {accounts.map((a) => <li key={a.locationId}><CrmLink href={a.url}>{a.name}</CrmLink></li>)}
              </ul>
            </div>
          )}
        </div>
      )}
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
