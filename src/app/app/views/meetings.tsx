"use client";

import { useState } from "react";
import { ModuleTabs, Page } from "../ds";
import { crmNoteFootnote } from "@/lib/meeting-wording";
import { useApiClient, useData } from "../session";
import { Badge, Btn, Card, Empty, ErrorBox, ExtLink, inputClass, Loading, timeAgo } from "../ui";
import { MeetingInbox } from "./meeting-inbox";
import { AccountSetup, MyMeetingSetup, type SetupData } from "./meeting-setup";

type Hook = { id: string; locationId: string; locationName: string | null; label: string | null; createdAt: string | null; lastUsedAt: string | null };
type Meeting = {
  id: string; locationId: string; locationName: string | null; source: string; title: string | null; startedAt: string | null; receivedAt: string | null;
  attendees: Array<{ name: string | null; email: string | null }>; summary: string | null; actionItems: string[]; hasTranscript: boolean; recordingUrl: string | null;
  contactId: string | null; contactName: string | null; status: string; note: string; contactUrl: string | null;
};
// `moreTools` is true only while Zoom and Google Meet are switched on; otherwise nothing on this page names them.
type Data = { meetings: Meeting[]; hooks: Hook[]; accounts: Array<{ locationId: string; name: string }>; maxHooks: number; keepTranscripts: boolean; canManage: boolean; moreTools: boolean; noteWriteGranted?: boolean | null; pushNotesToCrm?: boolean };

const sourceName = (source: string, zoom: boolean) => (source === "fathom" ? "Fathom" : source === "zoom" && zoom ? "Zoom" : "Meeting tool");

// Meeting notes (stage E2a): the person's own Meeting inbox first, then the older list of meetings that arrived through a private address.
export function MeetingsView() {
  // Stage E2b: what a person saves and where, and (for admins) the account's rules and contact fields. Read once, shared by both tabs.
  const setup = useData<SetupData>("meeting-setup");
  return (
    <Page title="Meeting notes" subtitle="After a recorded call, SubSync adds the summary and action items to the contact, written as you. A call it cannot place waits in your private inbox.">
      <ModuleTabs label="Meeting notes sections" tabs={[
        { label: "My Meeting inbox", node: <MeetingInbox /> },
        { label: "What to save and where", node: <MyMeetingSetup data={setup.data} loading={setup.loading} error={setup.error} reload={setup.reload} /> },
        ...(setup.data?.admin.can ? [{ label: "Account setup", node: <AccountSetup setup={setup.data} /> }] : []),
        { label: "Older meeting notes", node: <OlderMeetings /> },
      ]} />
    </Page>
  );
}

function OlderMeetings() {
  const api = useApiClient();
  const { data, error, loading, reload } = useData<Data>("meetings");
  const [account, setAccount] = useState("");
  const [created, setCreated] = useState<{ url: string; accountName: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const chosen = account || data.accounts[0]?.locationId || "";

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setMsg(null);
    try {
      await fn();
      if (done) setMsg(done);
      await reload();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setMsg(`${what} copied.`);
    } catch {
      setMsg("Your browser would not let us copy. Select the text and copy it by hand.");
    }
  };

  return (
    <div>
      <p className="mb-4 text-sm text-muted-foreground">Meetings that arrived through a private address (before each person connected their own tool). {data.keepTranscripts ? "Transcripts are being kept." : "Transcripts are not kept."}</p>
      {msg && <p className="mb-4 rounded-lg border bg-muted/40 px-3 py-2 text-sm" role="status">{msg}</p>}

      {data.canManage && (
        <Card title="Advanced: a private address for a tool that cannot sign in" className="mb-6">
          <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Create a private address for a client account below.</li>
            <li><strong>Fathom:</strong> Settings, API Access, add a webhook, paste the address, and tick the new meeting content option.</li>
            {data.moreTools && <li><strong>Zoom:</strong> in Zapier or Make, use the trigger for a new cloud recording with transcript, then a step that sends the data to a webhook with that address.</li>}
            <li>Each finished meeting appears here within seconds, matched to the contact by the attendee&apos;s email.</li>
          </ol>
          <div className="flex flex-wrap items-end gap-3">
            {data.accounts.length > 1 && (
              <div className="min-w-56">
                <label htmlFor="mt-account" className="mb-1 block text-xs text-muted-foreground">Client account</label>
                <select id="mt-account" className={inputClass} value={chosen} onChange={(e) => setAccount(e.target.value)}>{data.accounts.map((a) => <option key={a.locationId} value={a.locationId}>{a.name}</option>)}</select>
              </div>
            )}
            <Btn variant="primary" disabled={!chosen} onClick={() => act(async () => {
              const r = await api.post<{ url: string }>("meetings/hooks", { locationId: chosen });
              setCreated({ url: r.url, accountName: data.accounts.find((a) => a.locationId === chosen)?.name ?? "this account" });
            })}>Create a private address</Btn>
          </div>
          {created && (
            <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-medium">Address for {created.accountName}. Copy it now: it is shown only once.</p>
              <p className="mt-1 break-all rounded bg-white/70 p-2 font-mono text-xs">{created.url}</p>
              <div className="mt-2"><Btn onClick={() => copy(created.url, "Address")}>Copy address</Btn></div>
            </div>
          )}
          {data.hooks.length > 0 && (
            <ul className="mt-4 divide-y text-sm">
              {data.hooks.map((h) => (
                <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span><span className="font-medium">{h.locationName ?? "Account"}</span> <span className="text-muted-foreground">· created {timeAgo(h.createdAt)} · {h.lastUsedAt ? `last used ${timeAgo(h.lastUsedAt)}` : "not used yet"}</span></span>
                  <Btn variant="ghost" onClick={() => act(() => api.post(`meetings/hooks/${h.id}/revoke`), "That address no longer works.")}>Turn off</Btn>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            {crmNoteFootnote(data.noteWriteGranted ?? null, data.pushNotesToCrm !== false)} A one-click &quot;Copy note&quot; is on every meeting for anything you want to paste by hand.
            {data.keepTranscripts ? " Transcripts are being kept." : " Transcripts are not kept (change this in Settings)."}
          </p>
        </Card>
      )}

      {data.meetings.length === 0 ? (
        <Empty title="No older meeting notes" body="Meetings from people's own connected tools are in My Meeting inbox. This list is only for meetings that came through a private address." />
      ) : (
        <ul className="space-y-3">
          {data.meetings.map((m) => (
            <li key={m.id} className="rounded-xl border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{m.title ?? "Untitled meeting"}</p>
                  <p className="text-xs text-muted-foreground">{sourceName(m.source, data.moreTools)} · {m.startedAt ? new Date(m.startedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "date unknown"}{m.locationName ? ` · ${m.locationName}` : ""}</p>
                </div>
                <div className="flex items-center gap-2">
                  {m.contactName ? <Badge tone="good">With {m.contactName}</Badge> : <Badge tone="warn">No matching contact</Badge>}
                  {m.status === "filed" && <Badge>Filed</Badge>}
                </div>
              </div>
              {m.summary && <p className={`mt-2 text-sm leading-6 ${open === m.id ? "" : "line-clamp-3"}`}>{m.summary}</p>}
              {m.actionItems.length > 0 && (
                <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm">{m.actionItems.slice(0, open === m.id ? 20 : 3).map((a) => <li key={a}>{a}</li>)}</ul>
              )}
              {!m.contactName && <p className="mt-2 text-xs text-muted-foreground">No attendee email matched a contact in this account. Add their email to the contact in your CRM, or copy the note and paste it where it belongs.</p>}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Btn onClick={() => copy(m.note, "Note")}>Copy note</Btn>
                {m.contactUrl && <ExtLink href={m.contactUrl}>Open the contact</ExtLink>}
                {m.recordingUrl && <ExtLink href={m.recordingUrl}>Recording</ExtLink>}
                <button type="button" className="text-xs underline" onClick={() => setOpen(open === m.id ? null : m.id)}>{open === m.id ? "Show less" : "Show more"}</button>
                <span className="ml-auto flex gap-2">
                  {m.status !== "filed" && <Btn variant="ghost" onClick={() => act(() => api.put(`meetings/${m.id}`, { status: "filed" }), "Marked as filed.")}>Mark filed</Btn>}
                  <Btn variant="ghost" onClick={() => act(() => api.put(`meetings/${m.id}`, { status: "dismissed" }), "Removed from the list.")}>Dismiss</Btn>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
