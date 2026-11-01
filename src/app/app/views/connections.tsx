"use client";

import { Hash, Mic, Video, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { DataList, ErrorState, HowTo, InlineAlert, Page, Section, SkeletonRows } from "../ds";
import { PENDING_MS, STATUS_WORDS, type Shown } from "@/lib/connections/messages";
import type { PolicyFlags } from "@/lib/connections/policy";
import { useApiClient, useData } from "../session";
import { Badge, Btn, timeAgo, type Tone } from "../ui";

// Connections (stage E0, INTEGRATIONS_SPEC sections 2, 3, 5.1 and 12). Two sections:
//   My connections          every person: the tools THEY connect. Nobody else can connect them, see their tokens, or read their meetings.
//   Team connections        administrators: who has connected (names, status, counts, never what was said), Slack, the rules, and a way to revoke.
// A connection that is waiting for the provider gives up after 2 minutes and offers Try again.

type PersonalProvider = "fathom" | "zoom";
type Mine = {
  id: string; provider: PersonalProvider; status: Shown; connectedAs: string | null; lastOkAt: string | null; lastEventAt: string | null;
  saved: number; skipped: number; lastErrorCode: string | null; delivery: boolean;
};
type MyData = { cards: Array<{ provider: PersonalProvider; name: string; available: boolean }>; connections: Mine[]; delivery: boolean; canAdmin: boolean; me: { name: string | null } };

type TeamRow = {
  id: string; person: string | null; provider: PersonalProvider; status: Shown; lastEventAt: string | null; saved: number; skipped: number; waiting: number;
  homeLocationId: string | null; accountName: string | null; lastErrorCode: string | null;
};
type Flags = PolicyFlags;
type TeamData = {
  scope: string; slackAvailable: boolean;
  slack: Array<{ id: string; label: string | null; status: string }>;
  legacy: Array<{ id: string; provider: string; label: string | null; saved: number; skipped: number; lastEventAt: string | null }>;
  team: TeamRow[];
  summary: { people: number; connected: number; needAttention: number; waiting: number };
  policy: { canSetCompany: boolean; company: Flags; effectiveOwn: Flags | null; accounts: Record<string, { set: Flags; effective: Flags }> };
  delivery: boolean;
};

const INFO: Record<PersonalProvider, { name: string; icon: LucideIcon; what: string }> = {
  fathom: { name: "Fathom", icon: Mic, what: "After each recorded call, the summary and action items reach you, and SubSync adds them to the matching contact. A contact is only ever matched by exact email. If nobody matches, it waits in your own Meeting inbox." },
  zoom: { name: "Zoom", icon: Video, what: "When Zoom writes a summary of a meeting you hosted, it reaches you. The host needs a paid Zoom plan with meeting summaries switched on." },
};

const TONE: Record<Shown, Tone> = { not_connected: "neutral", waiting: "info", expired: "warn", connected: "good", needs_reconnect: "warn", revoked: "bad", error: "bad" };

/** The sentence that says what to do next for each status. */
function nextStep(s: Shown, delivery: boolean): string {
  switch (s) {
    case "connected": return delivery ? "Working. New calls will arrive for you." : "Connected. Calls will start arriving once meeting delivery is switched on, which is still being set up.";
    case "needs_reconnect": return "The tool stopped accepting this connection. Connect again to keep receiving calls.";
    case "revoked": return "Your admin disconnected this. Connect again if you want it back.";
    case "expired": return "This did not finish. Try again.";
    case "waiting": return "Finish signing in in the other window. This stops waiting after 2 minutes.";
    case "error": return "Something went wrong. Try again. If it keeps happening, send us the code you see.";
    default: return "Not connected. Press Connect and sign in with your own account.";
  }
}

export function ConnectionsPage() {
  const my = useData<MyData>("my-connections");
  return (
    <Page title="Connections" subtitle="Connect your own tools once. Admins can see who is connected, never what was said.">
      <HowTo id="connections-e0" title="How connections work">
        You sign in with your own account, so a connection is yours: nobody can connect for you or read your calls. Your admin sees who has connected and can switch a connection off, but never sees the content.
      </HowTo>
      {my.loading && !my.data ? <SkeletonRows rows={3} label="Loading your connections" />
        : my.error ? <ErrorState error={my.error} onRetry={my.reload} />
        : my.data ? (
          <>
            <MySection data={my.data} reload={my.reload} />
            {my.data.canAdmin && <TeamSection />}
          </>
        ) : null}
    </Page>
  );
}

// ---------------- My connections ----------------

function MySection({ data, reload }: { data: MyData; reload: () => Promise<void> }) {
  const api = useApiClient();
  const [waiting, setWaiting] = useState<{ provider: PersonalProvider; at: number } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // While the sign-in window is open, look for the result every few seconds, and give up after two minutes.
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      void reload();
      if (Date.now() - waiting.at > PENDING_MS) { setWaiting(null); setMsg({ ok: false, text: STATUS_WORDS.expired }); }
    }, 3000);
    const onMessage = (e: MessageEvent) => {
      if (e.origin === window.location.origin && e.data?.subsync === "connection") {
        setWaiting(null); void reload();
        setMsg(e.data.ok ? { ok: true, text: `${INFO[e.data.provider as PersonalProvider]?.name ?? "The tool"} is connected.` } : { ok: false, text: "This did not finish. Try again." });
      }
    };
    window.addEventListener("message", onMessage);
    return () => { clearInterval(timer); window.removeEventListener("message", onMessage); };
  }, [waiting, reload]);

  const connect = useCallback(async (p: PersonalProvider) => {
    setMsg(null);
    try {
      const { url } = await api.post<{ url: string }>(`my-connections/${p}/start`);
      const win = window.open(url, "subsync-connect", "width=560,height=720");
      if (!win) { setMsg({ ok: false, text: "Your browser blocked the pop-up. Allow pop-ups for this page and try again." }); return; }
      setWaiting({ provider: p, at: Date.now() });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  }, [api]);

  const test = async (id: string) => {
    setBusy(id); setMsg(null);
    try { const r = await api.post<{ message: string }>(`my-connections/${id}/test`); setMsg({ ok: true, text: r.message }); await reload(); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); await reload(); }
    finally { setBusy(null); }
  };
  const remove = async (id: string) => {
    setConfirm(null); setBusy(id);
    try { await api.del(`my-connections/${id}`); await reload(); setMsg({ ok: true, text: "Disconnected. SubSync no longer has access." }); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    finally { setBusy(null); }
  };

  return (
    <Section title="My connections" hint={data.me.name ? `For ${data.me.name}. These belong to you and nobody else.` : "These belong to you and nobody else."} id="my-connections">
      <ul className="divide-y border-y" data-testid="my-connections">
        {data.cards.map((card) => {
          const info = INFO[card.provider];
          const Icon = info.icon;
          const mine = data.connections.find((c) => c.provider === card.provider) ?? null;
          const isWaiting = waiting?.provider === card.provider;
          const status: Shown = isWaiting ? "waiting" : mine?.status ?? "not_connected";
          const working = status === "connected";
          const label = status === "not_connected" ? "Connect" : status === "expired" ? "Try again" : "Connect again";
          return (
            <li key={card.provider} className="py-4" data-testid={`my-${card.provider}`}>
              <div className="flex flex-wrap items-start gap-3">
                <span aria-hidden className="mt-0.5 text-muted-foreground"><Icon className="size-5" /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold">{info.name}</h3>
                    <Badge tone={TONE[status]}>{STATUS_WORDS[status]}</Badge>
                  </div>
                  {working && <p className="mt-0.5 text-sm">Connected as <span className="font-medium">{mine?.connectedAs ?? data.me.name ?? "you"}</span>{mine?.lastEventAt ? `, last meeting ${timeAgo(mine.lastEventAt)}` : ", no meetings yet"}{mine ? ` · ${mine.saved} added to contacts, ${mine.skipped} waiting or not matched` : ""}</p>}
                  <p className="mt-0.5 text-sm text-muted-foreground">{nextStep(status, data.delivery)}</p>
                  {!working && <p className="mt-1 text-xs text-muted-foreground">{info.what}</p>}
                  {!card.available && !mine && <p className="mt-1 text-xs text-muted-foreground">This needs the {info.name} app to be set up for SubSync first.</p>}
                  {mine?.lastErrorCode && status !== "connected" && <p className="mt-1 text-xs text-muted-foreground">If you contact us, send this code: {mine.lastErrorCode}</p>}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {!working && status !== "waiting" && <Btn variant="primary" disabled={!card.available} onClick={() => void connect(card.provider)}>{label}</Btn>}
                  {status === "waiting" && <Btn disabled>Waiting for you...</Btn>}
                  {working && mine && <Btn disabled={busy === mine.id} onClick={() => void test(mine.id)}>Test connection</Btn>}
                  {mine && (mine.status === "connected" || mine.status === "needs_reconnect") && (confirm === mine.id ? (
                    <span className="flex items-center gap-2"><span className="text-xs text-muted-foreground">Remove access?</span>
                      <Btn variant="primary" onClick={() => void remove(mine.id)}>Yes, disconnect</Btn><Btn variant="ghost" onClick={() => setConfirm(null)}>Keep</Btn></span>
                  ) : <Btn variant="ghost" onClick={() => setConfirm(mine.id)}>Disconnect</Btn>)}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {msg && <div className="mt-3"><InlineAlert tone={msg.ok ? "success" : "danger"}>{msg.text}</InlineAlert></div>}
      <p className="mt-3 text-xs text-muted-foreground">SubSync only receives the summary and action items you chose to save, never more. You are responsible for telling people on a call that it is recorded. Fathom has not yet been reviewed by Fathom for SubSync.</p>
    </Section>
  );
}

// ---------------- Team connections (administrators) ----------------

function TeamSection() {
  const api = useApiClient();
  const { data, error, loading, reload } = useData<TeamData>("team-connections");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [waitingSlack, setWaitingSlack] = useState<number | null>(null);
  const [flags, setFlags] = useState<Flags | null>(null);
  const [saving, setSaving] = useState(false);
  const before = useRef("");

  useEffect(() => {
    if (waitingSlack === null) return;
    const timer = setInterval(() => {
      void reload();
      if (Date.now() - waitingSlack > PENDING_MS) { setWaitingSlack(null); setMsg({ ok: false, text: STATUS_WORDS.expired }); }
    }, 3000);
    return () => clearInterval(timer);
  }, [waitingSlack, reload]);
  useEffect(() => {
    if (waitingSlack !== null && data && data.slack.map((s) => s.id).join() !== before.current) {
      setWaitingSlack(null);
      setMsg({ ok: true, text: "Slack is connected." });
    }
  }, [data, waitingSlack]);

  if (loading && !data) return <SkeletonRows rows={3} label="Loading team connections" />;
  if (error) return error.status === 403 ? null : <ErrorState error={error} onRetry={reload} />;
  if (!data) return null;

  const connectSlack = async () => {
    setMsg(null);
    try {
      const { url } = await api.post<{ url: string }>("connections/slack/start");
      before.current = data.slack.map((s) => s.id).join();
      const win = window.open(url, "subsync-connect", "width=560,height=720");
      if (!win) { setMsg({ ok: false, text: "Your browser blocked the pop-up. Allow pop-ups for this page and try again." }); return; }
      setWaitingSlack(Date.now());
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };
  const revoke = async (id: string) => {
    setConfirm(null);
    try { await api.post(`team-connections/${id}/revoke`); await reload(); setMsg({ ok: true, text: "Disconnected. That person has to connect again." }); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };
  const removeOld = async (id: string) => {
    try { await api.del(`connections/${id}`); await reload(); setMsg({ ok: true, text: "Removed." }); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };
  const editing = flags ?? (data.policy.canSetCompany ? data.policy.company : data.policy.effectiveOwn);
  const saveRules = async () => {
    if (!flags) return;
    setSaving(true);
    try {
      await api.put("meeting-policy", { scope: data.policy.canSetCompany ? "agency" : "account", flags });
      await reload(); setFlags(null); setMsg({ ok: true, text: "Saved." });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setSaving(false); }
  };

  const { summary } = data;
  return (
    <Section title="Team connections (admins)" hint="Who has connected, and the rules. You see names and status, never what was said." id="team-connections">
      <p className="mb-3 text-sm" data-testid="team-summary">
        {summary.people === 0 ? "Nobody has connected a tool yet." : `${summary.people} ${summary.people === 1 ? "person has" : "people have"} connected a tool: ${summary.connected} working${summary.needAttention ? `, ${summary.needAttention} need${summary.needAttention === 1 ? "s" : ""} attention` : ""}${summary.waiting ? `, ${summary.waiting} ${summary.waiting === 1 ? "call is" : "calls are"} waiting for someone to pick a contact` : ""}.`}
      </p>

      <DataList<TeamRow>
        rows={data.team} rowKey={(r) => r.id} caption="Who has connected"
        empty="Nobody has connected yet. Ask each person to open Connections and press Connect: a connection is personal, so you cannot do it for them."
        columns={[
          { key: "who", header: "Person", primary: true, width: "minmax(0,1.4fr)", cell: (r) => <span><span className="font-medium">{r.person ?? "Unnamed"}</span>{r.accountName ? <span className="text-muted-foreground"> · {r.accountName}</span> : <span className="text-muted-foreground"> · company team</span>}</span> },
          { key: "tool", header: "Tool", width: "6rem", cell: (r) => INFO[r.provider]?.name ?? r.provider },
          { key: "status", header: "Status", width: "minmax(0,1.2fr)", cell: (r) => <Badge tone={TONE[r.status]}>{r.status === "revoked" ? "Disconnected" : STATUS_WORDS[r.status]}</Badge> },
          { key: "last", header: "Last call", width: "7rem", cell: (r) => (r.lastEventAt ? timeAgo(r.lastEventAt) : "none yet") },
          { key: "counts", header: "Added / waiting", width: "8rem", cell: (r) => `${r.saved} / ${r.waiting}` },
          { key: "act", header: "", width: "9rem", align: "right", cell: (r) => (r.status === "connected" || r.status === "needs_reconnect") ? (confirm === r.id
            ? <span className="flex items-center justify-end gap-1"><Btn variant="primary" onClick={() => void revoke(r.id)}>Yes, disconnect</Btn><Btn variant="ghost" onClick={() => setConfirm(null)}>Keep</Btn></span>
            : <Btn variant="ghost" onClick={() => setConfirm(r.id)}>Disconnect</Btn>) : null },
        ]}
      />
      {!data.delivery && <p className="mt-2 text-xs text-muted-foreground">Meeting delivery from the tools is not switched on yet, so calls will not arrive until it is.</p>}

      {data.scope === "all" && (
        <div className="mt-6" data-testid="slack-card">
          <h3 className="flex items-center gap-2 text-sm font-semibold"><Hash aria-hidden className="size-4 text-muted-foreground" /> Slack <span className="font-normal text-muted-foreground">(one for the whole team)</span></h3>
          <p className="mt-0.5 text-sm text-muted-foreground">Alerts and the daily brief arrive in the channel you pick on Slack&apos;s own page. Only an admin connects it.</p>
          {data.slack.length === 0 ? (
            <div className="mt-2"><Btn variant="primary" disabled={!data.slackAvailable || waitingSlack !== null} onClick={() => void connectSlack()}>{waitingSlack !== null ? "Waiting for you..." : "Connect Slack"}</Btn>
              {!data.slackAvailable && <span className="ml-2 text-xs text-muted-foreground">This needs the Slack app to be set up for SubSync first.</span>}</div>
          ) : data.slack.map((s) => (
            <p key={s.id} className="mt-2 flex flex-wrap items-center gap-2 text-sm"><Badge tone="good">Connected</Badge> <span className="font-medium">{s.label ?? "Slack"}</span> <Btn variant="ghost" onClick={() => void removeOld(s.id)}>Disconnect</Btn></p>
          ))}
        </div>
      )}

      {data.legacy.length > 0 && (
        <div className="mt-6" data-testid="legacy-connections">
          <InlineAlert tone="warning" title="Set up before connections became personal">
            {data.legacy.length === 1 ? "One connection was made for the whole team." : `${data.legacy.length} connections were made for the whole team.`} It keeps working, but nobody owns it. Ask each person to connect their own above, then remove this one.
          </InlineAlert>
          <ul className="mt-2 divide-y border-y text-sm">
            {data.legacy.map((l) => <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span><span className="font-medium">{l.provider === "fathom" ? "Fathom" : "Zoom"}</span> · {l.label ?? "shared"} · {l.saved} saved, {l.skipped} not matched · legacy, reconnect to make it personal</span><Btn variant="ghost" onClick={() => void removeOld(l.id)}>Remove</Btn></li>)}
          </ul>
        </div>
      )}

      {editing && (
        <div className="mt-6" data-testid="meeting-rules">
          <h3 className="text-sm font-semibold">{data.policy.canSetCompany ? "Rules for everyone" : "Rules for this account"}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{data.policy.canSetCompany ? "These are the limits for every client account. An account can only make them stricter." : "You can only make the limits stricter than your company's."}</p>
          <div className="mt-2 space-y-2 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={editing.allowCrmWrites} onChange={(e) => setFlags({ ...editing, allowCrmWrites: e.target.checked })} /> Allow notes to be added to contacts in your CRM</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={editing.allowTranscripts} onChange={(e) => setFlags({ ...editing, allowTranscripts: e.target.checked })} /> Allow full transcripts in your CRM (off is safest: transcripts hold other people&apos;s words)</label>
            <label className="flex items-center gap-2">Calls nobody matches wait in a person&apos;s own inbox for
              <select className="rounded border bg-card px-2 py-1" value={editing.inboxRetentionDays} onChange={(e) => setFlags({ ...editing, inboxRetentionDays: Number(e.target.value) })}>{[7, 14, 30].map((d) => <option key={d} value={d}>{d} days</option>)}</select></label>
          </div>
          <div className="mt-2"><Btn variant="primary" disabled={!flags || saving} onClick={() => void saveRules()}>{saving ? "Saving..." : "Save rules"}</Btn></div>
        </div>
      )}
      {msg && <div className="mt-3"><InlineAlert tone={msg.ok ? "success" : "danger"}>{msg.text}</InlineAlert></div>}
    </Section>
  );
}
