"use client";

import { useState } from "react";
import { InlineAlert, Section, SkeletonRows } from "../ds";
import { BrandIcon } from "../ds/brand-icon";
import { useApiClient, useData } from "../session";
import { Btn } from "../ui";

// Automatic meeting notes and Slack (Automation pass). Plain rules, no AI. One switch, a short "Added today" list with Undo, and Slack that sets itself up:
// pause everything, send a test. Words are the product's own.

type Notes = {
  connected: boolean; on: boolean; accepted: boolean; explain: string; needsPermission: boolean; permissionText: string | null;
  added: Array<{ id: string; name: string; practice: boolean; at: string }>; notices: Array<{ id: string; kind: string; text: string; unread: boolean }>;
};
type Slack = { pauseAll: boolean; muted: string[]; quiet: { on: boolean; start: number; end: number }; live: boolean };

export function AutoNotesCard() {
  const api = useApiClient();
  const { data, error, loading, reload } = useData<Notes>("am/notes");
  const [msg, setMsg] = useState<string | null>(null);
  const [agree, setAgree] = useState(false);
  if (loading) return <SkeletonRows />;
  if (error || !data) return <InlineAlert tone="info">Automatic notes are not switched on for your account yet.</InlineAlert>;
  const set = (on: boolean) => api.post("am/notes", { on, accept: on }).then(() => { setMsg(null); void reload(); }).catch((e: Error) => setMsg(e.message));
  return (
    <Section title="Add meeting notes to contacts automatically">
      {!data.connected && <p className="text-sm text-muted-foreground">Connect Fathom first. Then this works by itself.</p>}
      <p className="text-sm">{data.explain}</p>
      {data.needsPermission && <InlineAlert tone="warning">{data.permissionText}</InlineAlert>}
      {data.on ? (
        <div className="mt-2 flex items-center gap-3"><span className="text-sm font-medium">On</span><Btn onClick={() => void set(false)}>Turn off</Btn></div>
      ) : (
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> I understand. Add notes when the match is certain.
          <Btn variant="primary" disabled={!agree} onClick={() => void set(true)}>Turn on</Btn>
        </label>
      )}
      {msg && <InlineAlert tone="warning">{msg}</InlineAlert>}
      <h4 className="mt-4 text-sm font-semibold">Added today</h4>
      {data.added.length === 0 ? <p className="text-sm text-muted-foreground">Nothing yet today.</p> : (
        <ul className="divide-y text-sm">
          {data.added.map((a) => (
            <li key={a.id} className="flex items-center justify-between py-1.5">
              <span>{a.name}{a.practice ? " (practice, nothing was written)" : ""}</span>
              <Btn variant="ghost" onClick={() => void api.post("am/undo", { id: a.id }).then(() => reload()).catch((e: Error) => setMsg(e.message))}>Undo</Btn>
            </li>
          ))}
        </ul>
      )}
      {data.notices.length > 0 && (
        <>
          <h4 className="mt-4 text-sm font-semibold">Updates</h4>
          <ul className="text-sm">{data.notices.slice(0, 5).map((n) => <li key={n.id} className={n.unread ? "font-medium" : "text-muted-foreground"}>{n.text}</li>)}</ul>
          <Btn variant="ghost" onClick={() => void api.post("am/read", {}).then(() => reload())}>Mark all read</Btn>
        </>
      )}
    </Section>
  );
}

export function SlackAutoCard() {
  const api = useApiClient();
  const { data, error, loading, reload } = useData<Slack>("am/slack");
  const [msg, setMsg] = useState<string | null>(null);
  if (loading) return <SkeletonRows />;
  if (error || !data) return null;
  return (
    <Section title="Slack">
      <p className="flex items-center gap-2 text-sm"><BrandIcon id="slack" size={18} decorative /> Connect Slack once. Briefs and alerts go to the right channel by themselves. A client only ever gets its own alerts.</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Btn onClick={() => void api.post("am/slack", { pauseAll: !data.pauseAll }).then(() => reload())}>{data.pauseAll ? "Resume all Slack messages" : "Pause all Slack messages"}</Btn>
        <Btn onClick={() => void api.post<{ message: string }>("am/slack-test", {}).then((r) => setMsg(r.message)).catch((e: Error) => setMsg(e.message))}>Send a test</Btn>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Quiet hours {data.quiet.start}:00 to {data.quiet.end}:00. {data.muted.length} client account{data.muted.length === 1 ? "" : "s"} muted.{data.live ? "" : " Test mode: nothing is sent yet."}</p>
      {msg && <InlineAlert tone="info">{msg}</InlineAlert>}
    </Section>
  );
}
