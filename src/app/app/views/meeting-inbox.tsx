"use client";

import { useCallback, useState } from "react";
import { EmptyState, ErrorState, InlineAlert, Section, SkeletonRows } from "../ds";
import { useApiClient, useData } from "../session";
import { Badge, Btn, ExtLink, inputClass } from "../ui";

// The Meeting inbox (stage E2a, INTEGRATIONS_SPEC sections 5.2 and 12). PRIVATE to the person: it lists only their own calls. A call nobody could be matched
// to with certainty waits here for 14 days (or the shortest time the account rules allow). The person picks the account and the contact themselves: SubSync
// never picks one. Every screen says the same thing: SubSync adds a note to a contact only when exactly one contact matches the attendee's email, or when you
// pick one here, and the note is written as you.

type Waiting = {
  id: string; title: string | null; startedAt: string | null; attendees: string[]; reason: string | null; kind: "unmatched" | "held" | "permission"; message: string; daysLeft: number | null;
  summary: string | null; actionItems: string[]; recordingUrl: string | null; noteText: string | null;
};
type Recent = { id: string; title: string | null; startedAt: string | null; receivedAt: string; status: string; outcome: string };
type Data = {
  demo: boolean; connected: boolean; canWrite: boolean; writeLive: boolean;
  settings: { masterSwitch: boolean; unmatchedMode: "inbox" | "discard"; unmatchedLocked?: boolean; previewConfirmed: boolean };
  preview: { sample: boolean; text: string; shortened: boolean; held: number } | null;
  waiting: Waiting[]; recent: Recent[]; accounts: Array<{ locationId: string; name: string }>;
};
type Hit = { locationId: string; contactId: string; name: string | null; email: string | null; phone: string | null; accountName: string; url: string };

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "date unknown");

export function MeetingInbox() {
  const { data, error, loading, reload } = useData<Data>("meeting-inbox");
  if (loading && !data) return <SkeletonRows rows={4} label="Loading your Meeting inbox" />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return null;
  return <Inbox data={data} reload={reload} />;
}

function Inbox({ data, reload }: { data: Data; reload: () => Promise<void> }) {
  const api = useApiClient();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const act = useCallback(async (fn: () => Promise<string | void>) => {
    setBusy(true); setMsg(null);
    try { const text = await fn(); await reload(); if (text) setMsg({ ok: true, text }); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    finally { setBusy(false); }
  }, [reload]);

  const held = data.waiting.filter((w) => w.kind === "held");
  const others = data.waiting.filter((w) => w.kind !== "held");

  return (
    <div data-testid="meeting-inbox">
      {data.demo && <InlineAlert tone="info">The demo has no connected meeting tool, so there is nothing here. Connecting needs a real install.</InlineAlert>}
      {!data.demo && !data.connected && (
        <InlineAlert tone="info" title="Fathom is not connected" action={<a className="font-medium underline" href="#connections">Open Integrations</a>}>
          Connect your own Fathom under Integrations. After each recorded call SubSync finds the contact by email and adds the summary and action items to it, written as you.
        </InlineAlert>
      )}
      {!data.demo && !data.canWrite && (
        <InlineAlert tone="warning" title="Needs permission: reconnect">
          SubSync cannot add notes to contacts yet, because this install has not approved editing contacts. Your calls wait here instead, and nothing is written to your CRM.
        </InlineAlert>
      )}
      {!data.demo && data.canWrite && !data.writeLive && (
        <InlineAlert tone="info" title="Test mode">
          SubSync works out where each note would go but writes nothing to your CRM yet. Saving is switched on separately, by whoever runs SubSync.
        </InlineAlert>
      )}
      {msg && <div className="my-3"><InlineAlert tone={msg.ok ? "success" : "danger"} onDismiss={() => setMsg(null)}>{msg.text}</InlineAlert></div>}

      {data.preview && (
        <Section title="Check how your first note will look" hint="Notes are added to contacts by themselves only after you confirm this once." id="first-note">
          <p className="mb-2 text-sm text-muted-foreground">
            {data.preview.sample ? "This is a made-up sample, because you have not had a call yet. Your real calls look the same." : "This is your most recent call, exactly as it would be added to the contact."}
          </p>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap border-l-2 border-border py-1 pl-3 text-sm leading-6" data-testid="note-preview">{data.preview.text}</pre>
          {data.preview.shortened && <p className="mt-1 text-xs text-muted-foreground">A very long summary is shortened in the note and says so. The full text stays here.</p>}
          <p className="mt-2 text-xs text-muted-foreground">Only a contact whose email matches exactly gets a note. If two contacts share an email, or nobody matches, the call waits here and you choose. The note is written as you.</p>
          <div className="mt-3">
            <Btn variant="primary" disabled={busy || !data.connected} onClick={() => void act(async () => {
              const r = await api.post<{ released: number; stillWaiting: number; writeLive: boolean }>("meeting-inbox/confirm", {});
              return `Confirmed. From now on notes are added by themselves.${data.preview && data.preview.held > 0 ? ` ${r.released} waiting ${r.released === 1 ? "call was" : "calls were"} ${r.writeLive ? "added" : "checked in test mode (nothing was written)"}${r.stillWaiting ? `, ${r.stillWaiting} still wait for you below` : ""}.` : ""}`;
            })}>Looks good, add notes automatically</Btn>
            {!data.connected && <span className="ml-2 text-xs text-muted-foreground">Connect Fathom first.</span>}
          </div>
          {held.length > 0 && <p className="mt-2 text-sm">{held.length} {held.length === 1 ? "call is" : "calls are"} waiting for this OK: {held.slice(0, 3).map((h) => h.title ?? "Untitled call").join(", ")}{held.length > 3 ? ", and more" : ""}.</p>}
        </Section>
      )}

      <Section title="Calls waiting for you" hint="Private to you. Nobody else can see these, not even your admin." id="waiting">
        {others.length === 0 ? (
          <EmptyState title="Nothing is waiting" body={data.connected ? "When a call has no contact with a matching email, or two contacts share it, it appears here for 14 days. Pick the right contact and the note is added." : "Connect Fathom under Integrations. Calls it cannot place come here."} action={!data.connected ? <a className="font-medium underline" href="#connections">Open Integrations</a> : undefined} compact />
        ) : (
          <ul className="divide-y border-y" data-testid="waiting-list">
            {others.map((w) => <WaitingRow key={w.id} w={w} data={data} act={act} busy={busy} />)}
          </ul>
        )}
      </Section>

      <Section title="What happened to your recent calls" hint="When nothing was saved, the reason is here." id="recent">
        {data.recent.length === 0 ? <p className="text-sm text-muted-foreground">No calls yet.</p> : (
          <ul className="divide-y border-y text-sm" data-testid="recent-list">
            {data.recent.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
                <span className="font-medium">{r.title ?? "Untitled call"} <span className="font-normal text-muted-foreground">· {when(r.startedAt ?? r.receivedAt)}</span></span>
                <span className="text-muted-foreground">{r.outcome}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Your choices" hint="Only you can change these." id="my-choices">
        <div className="space-y-3 text-sm">
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5" checked={data.settings.masterSwitch} disabled={busy || !data.canWrite} onChange={(e) => void act(async () => { await api.put("meeting-inbox/settings", { masterSwitch: e.target.checked }); return e.target.checked ? "Notes will be added to contacts." : "Notes will not be added to contacts. Calls will wait here."; })} />
            <span>Add notes to contacts automatically{!data.canWrite && <span className="text-muted-foreground"> (Needs permission: reconnect)</span>}</span>
          </label>
          <label className="block">
            <span className="mb-1 block text-muted-foreground">If nobody on a call is one of your contacts</span>
            <select className={inputClass + " max-w-md"} value={data.settings.unmatchedMode} disabled={busy || data.settings.unmatchedLocked} onChange={(e) => void act(async () => { await api.put("meeting-inbox/settings", { unmatchedMode: e.target.value }); return "Saved."; })}>
              <option value="inbox">Keep it in my Meeting inbox so I can link it (recommended)</option>
              <option value="discard">Do not keep it (it is only counted)</option>
            </select>
            {data.settings.unmatchedLocked && <span className="mt-1 block text-xs text-muted-foreground">Set by your admin.</span>}
          </label>
        </div>
      </Section>
    </div>
  );
}

function WaitingRow({ w, data, act, busy }: { w: Waiting; data: Data; act: (fn: () => Promise<string | void>) => Promise<void>; busy: boolean }) {
  const api = useApiClient();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [account, setAccount] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<Hit | null>(null);
  const [ignoreEmail, setIgnoreEmail] = useState(w.attendees[0] ?? "");
  const [problem, setProblem] = useState<string | null>(null);

  const search = async () => {
    setSearching(true); setProblem(null); setPicked(null);
    try {
      const r = await api.get<{ results: Hit[] }>(`meeting-inbox/${w.id}/contacts?q=${encodeURIComponent(q)}${account ? `&account=${encodeURIComponent(account)}` : ""}`);
      setHits(r.results);
    } catch (e) { setProblem((e as Error).message); } finally { setSearching(false); }
  };

  return (
    <li className="py-3" data-testid="waiting-item">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{w.title ?? "Untitled call"} <span className="font-normal text-muted-foreground">· {when(w.startedAt)}</span></p>
          <p className="mt-0.5 break-words text-xs text-muted-foreground">With {w.attendees.length ? w.attendees.join(", ") : "nobody listed"}</p>
          <p className="mt-1 text-sm">{w.message}</p>
          {w.daysLeft !== null && <p className="mt-0.5 text-xs text-muted-foreground">Removed from here in {w.daysLeft} {w.daysLeft === 1 ? "day" : "days"} if you do nothing.</p>}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {w.kind === "permission" ? <Badge tone="warn">Needs permission: reconnect</Badge> : <Badge tone="info">Needs a contact</Badge>}
          {w.kind === "unmatched" && <Btn variant="primary" disabled={busy} onClick={() => setOpen(!open)}>{open ? "Close" : "Link to a contact"}</Btn>}
          <Btn variant="ghost" disabled={busy} onClick={() => void act(async () => { await api.post(`meeting-inbox/${w.id}/dismiss`, {}); return "Dismissed. Nothing was saved and the call's text was removed."; })}>Dismiss</Btn>
        </div>
      </div>

      {open && w.kind === "unmatched" && (
        <div className="mt-3 border-l-2 border-primary pl-3" data-testid="link-panel">
          <p className="text-sm text-muted-foreground">Choose the contact this call was with. You pick the account and the contact: SubSync never picks for you.</p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            {data.accounts.length > 1 && (
              <label className="text-xs text-muted-foreground">Account
                <select className={inputClass + " mt-1 min-w-48"} value={account} onChange={(e) => setAccount(e.target.value)}>
                  <option value="">All my accounts</option>
                  {data.accounts.map((a) => <option key={a.locationId} value={a.locationId}>{a.name}</option>)}
                </select>
              </label>
            )}
            <label className="min-w-56 flex-1 text-xs text-muted-foreground">Name, email or phone
              <input className={inputClass + " mt-1"} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && q.trim().length >= 2) void search(); }} placeholder="At least 2 letters" />
            </label>
            <Btn disabled={searching || q.trim().length < 2} onClick={() => void search()}>{searching ? "Searching..." : "Search"}</Btn>
          </div>
          {problem && <div className="mt-2"><InlineAlert tone="danger">{problem}</InlineAlert></div>}
          {hits && hits.length === 0 && <p className="mt-2 text-sm text-muted-foreground">No contact found{account ? " in that account" : ""}. Try part of the name or the email.</p>}
          {hits && hits.length > 0 && !picked && (
            <ul className="mt-2 divide-y border-y text-sm" data-testid="contact-results">
              {hits.map((h) => (
                <li key={`${h.locationId}:${h.contactId}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span><span className="font-medium">{h.name ?? "No name"}</span> <span className="text-muted-foreground">· {h.email ?? h.phone ?? "no email"} · {h.accountName}</span></span>
                  <Btn onClick={() => setPicked(h)}>Choose</Btn>
                </li>
              ))}
            </ul>
          )}
          {picked && (
            <div className="mt-3" data-testid="link-confirm">
              <p className="text-sm font-medium">Add this note to {picked.name ?? "this contact"} in {picked.accountName}?</p>
              <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap border-l-2 border-border py-1 pl-3 text-sm leading-6">{w.noteText}</pre>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Btn variant="primary" disabled={busy} onClick={() => void act(async () => {
                  try {
                    const r = await api.post<{ dryRun: boolean }>(`meeting-inbox/${w.id}/link`, { locationId: picked.locationId, contactId: picked.contactId });
                    return r.dryRun ? `Test mode: the note for ${picked.name ?? "the contact"} was worked out and nothing was written to your CRM yet.` : `Added to ${picked.name ?? "the contact"} in ${picked.accountName}.`;
                  } catch (e) { setProblem((e as Error).message); }
                })}>Add the note</Btn>
                <Btn variant="ghost" onClick={() => setPicked(null)}>Pick someone else</Btn>
                <ExtLink href={picked.url}>Open the contact in your CRM</ExtLink>
              </div>
            </div>
          )}
          {w.attendees.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-3 text-sm">
              <span className="text-muted-foreground">Not a client?</span>
              <select aria-label="Email to always ignore" className={inputClass + " max-w-xs"} value={ignoreEmail} onChange={(e) => setIgnoreEmail(e.target.value)}>
                {w.attendees.map((e) => <option key={e} value={e}>{e}</option>)}
              </select>
              <Btn variant="ghost" disabled={busy || !ignoreEmail} onClick={() => void act(async () => { await api.post(`meeting-inbox/${w.id}/ignore`, { email: ignoreEmail }); return `Done. Calls with ${ignoreEmail} will not wait here again.`; })}>Always ignore this email</Btn>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
