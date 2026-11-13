"use client";

import { useEffect, useState } from "react";
import { aiStatus, CALENDAR_WHAT, calendarLine, calendarStatus, emailLine, emailStatus, summaryChips, type SlackChatFacts } from "@/lib/connections/tools-status";
import { PENDING_MS, STATUS_WORDS } from "@/lib/connections/messages";
import { InlineAlert } from "../ds";
import { useApiClient, useData } from "../session";
import { Btn, Card, ErrorBox, Loading, timeAgo } from "../ui";
import type { Status as AiStatus } from "./ai-card";
import { aiFactsOf, AiToolRow } from "./ai-tool-row";
import { CalendarList, SlackChatLine, ToolRow, WhatsConnected, type Calendars } from "./connections-tools";
import { EmailTool, emailFactsOf, type EmailCheck, type EmailData } from "./email-tool";
import { ConnectionsSlot } from "./settings-slot-connections";

// Settings, Connections: "What's connected" at the top, then "Your tools" (AI, Slack, Fathom, Email, Calendars) as one list with a visible action on each row,
// then who connected what. The Connect buttons start the sign-in directly; the detail section below is open by default.

type Conn = {
  slack: { connected: boolean; label: string | null; canChange: boolean };
  slackChat: SlackChatFacts;
  fathom: { status: string; lastEventAt: string | null; saved: number; waiting: number; team: { people: number; working: number } | null };
  email: EmailData; calendars: Calendars;
};

export function ConnectionsSection() {
  const api = useApiClient();
  const { data, error, loading, reload } = useData<Conn>("st/connections");
  const ai = useData<AiStatus>("ai?part=status");
  const [check, setCheck] = useState<EmailCheck | null | undefined>(undefined);
  const [waiting, setWaiting] = useState<"slack" | "fathom" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const slackOk = data?.slack.connected === true, fathomOk = data?.fathom.status === "connected";
  const waitingNow = waiting === "slack" && !slackOk ? "slack" : waiting === "fathom" && !fathomOk ? "fathom" : null;
  // While a sign-in window is open, look for the result every few seconds and give up after two minutes.
  useEffect(() => {
    if (!waitingNow) return;
    const started = Date.now();
    const timer = setInterval(() => {
      void reload();
      if (Date.now() - started > PENDING_MS) { setWaiting(null); setMsg({ ok: false, text: STATUS_WORDS.expired }); }
    }, 3000);
    return () => clearInterval(timer);
  }, [waitingNow, reload]);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const f = data.fathom;
  const fOk = f.status === "connected";
  const manage = () => { setTimeout(() => document.getElementById("connection-details")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); };
  // The Connect buttons start the sign-in straight away (no second click inside a folded section).
  const connect = async (which: "slack" | "fathom") => {
    setMsg(null);
    try {
      const { url } = await api.post<{ url: string }>(which === "slack" ? "connections/slack/start" : "my-connections/fathom/start");
      const win = window.open(url, "subsync-connect", "width=560,height=720");
      if (!win) { setMsg({ ok: false, text: "Your browser blocked the pop-up. Allow pop-ups for this page and try again." }); return; }
      setWaiting(which);
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };

  const aiFacts = aiFactsOf(ai.data ?? undefined, ai.error);
  const aiConnected = aiFacts.connection !== null && aiFacts.connection.status === "connected";
  const liveCheck = check === undefined ? data.email.check : check;
  const emailFacts = emailFactsOf(data.email, liveCheck);
  const es = emailStatus(emailFacts);
  const cs = calendarStatus(data.calendars);
  const chips = summaryChips({ ai: aiStatus(aiFacts), slack: { connected: data.slack.connected }, email: es, fathom: { connected: fOk, needsReconnect: f.status === "needs_reconnect" } });
  return (
    <div className="space-y-4">
      <WhatsConnected chips={chips} />
      {msg && <InlineAlert tone={msg.ok ? "success" : "danger"}>{msg.text}</InlineAlert>}
      <Card title="Your tools">
        <ul className="divide-y" aria-label="Connected tools">
          <AiToolRow data={ai.data ?? undefined} error={ai.error} reload={ai.reload} />
          <ToolRow id="slack" icon="slack" name="Slack" tone={data.slack.connected ? "good" : "neutral"} status={waitingNow === "slack" ? "Waiting for you" : data.slack.connected ? "Connected" : "Not connected"}
            line={data.slack.connected ? `Alerts and the daily brief go to ${data.slack.label ?? "your Slack channel"}.` : "No Slack channel yet."}
            what="Posts alerts and the daily brief to one channel. SubSync only posts there; it does not read your other Slack messages." owner="Your workspace. One channel for the whole team, set up by an administrator." guide="conn-slack">
            <div className="flex flex-wrap items-center gap-2">
              {data.slack.canChange ? (data.slack.connected ? <Btn onClick={manage}>Change or disconnect</Btn> : <Btn variant="primary" disabled={waitingNow === "slack"} onClick={() => void connect("slack")}>{waitingNow === "slack" ? "Waiting for you..." : "Connect Slack"}</Btn>) : !data.slack.connected && <span className="text-xs text-muted-foreground">Ask your administrator to connect it.</span>}
            </div>
            <SlackChatLine chat={data.slackChat} aiConnected={aiConnected} />
          </ToolRow>
          <ToolRow id="fathom" icon="fathom" name="Fathom" tone={fOk ? "good" : f.status === "needs_reconnect" ? "warn" : "neutral"} status={waitingNow === "fathom" ? "Waiting for you" : fOk ? "Connected" : f.status === "needs_reconnect" ? "Reconnect" : "Not connected"}
            line={fOk ? (f.lastEventAt ? `Last call received ${timeAgo(f.lastEventAt)}. ${f.saved} added to contacts, ${f.waiting} waiting or not matched.` : "Connected. No calls received yet.") : "You have not connected your Fathom."}
            what="Receives the summary and action items of YOUR recorded calls and adds them to the right contact only when the match is certain. Otherwise they wait in your private inbox."
            guide="conn-fathom" owner={`You. Each person connects their own; nobody else can see your tokens or your calls.${f.team ? ` ${f.team.working} of ${f.team.people} on your team ${f.team.people === 1 ? "has" : "have"} connected.` : ""}`}>
            {fOk ? <Btn onClick={manage}>Test or disconnect</Btn> : <Btn variant="primary" disabled={waitingNow === "fathom"} onClick={() => void connect("fathom")}>{waitingNow === "fathom" ? "Waiting for you..." : f.status === "needs_reconnect" ? "Reconnect Fathom" : "Connect Fathom"}</Btn>}
          </ToolRow>
          <ToolRow id="gmail" icon="mail" name="Email" tone={es.tone} status={es.text} line={emailLine(emailFacts)}
            what="Where SubSync sends its own emails. Add your address to get alert emails and the weekly summary. Until you save one, no emails are sent." guide="conn-email">
            <EmailTool key={data.email.address ?? ""} email={data.email} check={liveCheck} onCheck={setCheck} reload={reload} />
          </ToolRow>
          <ToolRow id="calendars" icon="google_calendar" name="Calendars" tone={cs.tone} status={cs.text} line={calendarLine(data.calendars)}
            what={CALENDAR_WHAT} guide="conn-calendars">
            <CalendarList calendars={data.calendars} />
          </ToolRow>
        </ul>
      </Card>
      <section id="connection-details" className="scroll-mt-4" aria-labelledby="connection-details-h">
        <h2 id="connection-details-h" className="mb-2 text-sm font-semibold">Who connected what, rules, test and disconnect</h2>
        <ConnectionsSlot />
      </section>
    </div>
  );
}
