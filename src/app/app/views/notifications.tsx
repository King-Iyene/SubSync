"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorState, HowTo, InlineAlert, Page, Section, SkeletonRows } from "../ds";
import { PENDING_MS, STATUS_WORDS, type Shown } from "@/lib/connections/messages";
import { previewCopy } from "@/lib/notifications/copy";
import { quietText, WEEKDAYS, WEEKDAY_NAMES, type Timing } from "@/lib/notifications/timing";
import type { NotificationType } from "@/lib/notifications/catalog";
import { useApiClient, useData } from "../session";
import { Badge, Btn, inputClass, type Tone } from "../ui";

// Notifications (stage F9): what SubSync tells you, where, and when.
//   Where messages go    Slack channels ("Add to Slack", one channel per sign-in), each limited to the whole company or to one client account.
//   What you get         one row per kind of message: the bell, email (several addresses), Slack channels, when, quiet hours, the wording, a test.
// Everything works with no setup: alerts appear in the bell, and go to the email address and Slack channel you already set up.

type Pref = {
  type: NotificationType; enabled: boolean; inApp: boolean; email: boolean; recipients: string[]; slackDestinations: string[]; timing: Timing;
  copy: { title: string | null; body: string | null }; whenText: string; quietText: string; zone: string;
};
type TypeData = {
  id: NotificationType; label: string; hint: string; kind: "scheduled" | "event"; active: boolean; frequencies: Array<"immediate" | "daily" | "weekly">;
  variables: Array<{ name: string; label: string; sample: string }>; defaults: { title: string; body: string }; pref: Pref; customCopy: boolean; preview: { title: string; body: string };
};
type Dest = { id: string; label: string | null; locationId: string | null; accountName: string | null; status: Shown; legacy: boolean; lastErrorCode: string | null };
type Data = {
  mode: "agency" | "business"; types: TypeData[]; destinations: Dest[]; accounts: Array<{ locationId: string; name: string }>;
  flags: { emailLive: boolean; slackLive: boolean; emailReady: boolean; slackAvailable: boolean }; zone: string | null; catchup: string;
  problems: Array<{ id: string; type: string; channel: string; at: string | null; code: string | null; reason: string | null }>; maxDestinations: number;
};
type Note = { ok: boolean; text: string };

const TONE: Record<Shown, Tone> = { not_connected: "neutral", waiting: "info", expired: "warn", connected: "good", needs_reconnect: "warn", revoked: "bad", error: "bad" };

export function NotificationsPage() {
  const { data, error, loading, reload } = useData<Data>("notification-prefs");
  return (
    <Page title="Notifications" subtitle="Choose what you hear about, and where.">
      <HowTo id="notifications-f9" title="This works without any setup">
        Alerts show in the bell. Email and Slack work once you set them.
      </HowTo>
      {loading && !data ? <SkeletonRows rows={5} label="Loading notification choices" />
        : error ? (error.status === 403 ? <InlineAlert tone="info">Notification choices are for administrators. The bell at the top of the page shows what needs you.</InlineAlert> : <ErrorState error={error} onRetry={reload} />)
        : data ? <Body data={data} reload={reload} /> : null}
    </Page>
  );
}

function Body({ data, reload }: { data: Data; reload: () => Promise<void> }) {
  const [openId, setOpenId] = useState<string | null>(null);
  // The result line of each row lives here, not in the row: saving the wording changes the row's key, which rebuilds the row, and its message would vanish.
  const [notes, setNotes] = useState<Record<string, Note | null>>({});
  const test = !data.flags.emailLive || !data.flags.slackLive;
  return (
    <>
      {test && (
        <div className="mb-5" data-testid="test-mode">
          <InlineAlert tone="info" title="Test mode">
            {!data.flags.emailLive && !data.flags.slackLive ? "Email and Slack sending is switched off on this server, so messages are written to the log but not sent." : !data.flags.emailLive ? "Email sending is switched off on this server, so emails are written to the log but not sent." : "Slack sending is switched off on this server, so Slack messages are written to the log but not posted."} The bell works normally.
          </InlineAlert>
        </div>
      )}
      <SlackSection data={data} reload={reload} />
      <Section title="What you get" hint="One row for each kind of message. Press Change to set where it goes, when, and the words." id="what-you-get">
        <ul className="divide-y border-y" data-testid="notification-matrix">
          {data.types.map((t) => (
            <TypeRow key={t.id + JSON.stringify(t.pref) + String(t.customCopy)} t={t} note={notes[t.id] ?? null} setNote={(n) => setNotes((x) => ({ ...x, [t.id]: n }))} data={data} reload={reload} open={openId === t.id} onToggle={() => setOpenId(openId === t.id ? null : t.id)} />
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">{data.catchup}</p>
      </Section>
      {data.problems.length > 0 && (
        <Section title="Messages that could not be delivered" hint="After several tries SubSync stops. Fix the channel or address, then the next alert will go through.">
          <ul className="divide-y border-y text-sm" data-testid="problems">
            {data.problems.map((p) => <li key={p.id} className="py-2">{p.channel === "slack" ? "A Slack message" : p.channel === "email" ? "An email" : "A notification"} about {data.types.find((t) => t.id === p.type)?.label.toLowerCase() ?? "an alert"} was not delivered{p.code ? ` (code ${p.code})` : ""}.</li>)}
          </ul>
        </Section>
      )}
    </>
  );
}

// ---------------- Slack channels ----------------

function SlackSection({ data, reload }: { data: Data; reload: () => Promise<void> }) {
  const api = useApiClient();
  const [note, setNote] = useState<Note | null>(null);
  const [waiting, setWaiting] = useState<number | null>(null);
  const [scope, setScope] = useState("");
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const before = useRef(data.destinations.filter((d) => d.status === "connected").length);

  // While the Slack window is open, look for the result every few seconds, and give up after two minutes (N92).
  useEffect(() => {
    if (waiting === null) return;
    const timer = setInterval(() => {
      void reload();
      if (Date.now() - waiting > PENDING_MS) { setWaiting(null); setNote({ ok: false, text: STATUS_WORDS.expired }); }
    }, 3000);
    const onMessage = (e: MessageEvent) => {
      if (e.origin === window.location.origin && e.data?.subsync === "connection") {
        setWaiting(null); void reload();
        setNote(e.data.ok ? { ok: true, text: "Slack is connected. Choose what to send there below." } : { ok: false, text: STATUS_WORDS.expired });
      }
    };
    window.addEventListener("message", onMessage);
    return () => { clearInterval(timer); window.removeEventListener("message", onMessage); };
  }, [waiting, reload]);
  useEffect(() => {
    const now = data.destinations.filter((d) => d.status === "connected").length;
    if (waiting !== null && now > before.current) { setWaiting(null); before.current = now; setNote({ ok: true, text: "Slack is connected. Choose what to send there below." }); }
  }, [data.destinations, waiting]);

  const start = useCallback(async () => {
    setNote(null);
    try {
      before.current = data.destinations.filter((d) => d.status === "connected").length;
      const { url: link } = await api.post<{ url: string }>("notification-destinations/slack/start", scope ? { locationId: scope } : {});
      const win = window.open(link, "subsync-connect", "width=560,height=720");
      if (!win) { setNote({ ok: false, text: "Your browser blocked the pop-up. Allow pop-ups for this page and try again." }); return; }
      setWaiting(Date.now());
    } catch (e) { setNote({ ok: false, text: (e as Error).message }); }
  }, [api, scope, data.destinations]);

  const run = async (id: string, fn: () => Promise<string>) => {
    setBusy(id); setNote(null);
    try { setNote({ ok: true, text: await fn() }); await reload(); } catch (e) { setNote({ ok: false, text: (e as Error).message }); await reload(); } finally { setBusy(null); }
  };
  const addByAddress = () => run("advanced", async () => {
    await api.post("notification-destinations/advanced", { url: url.trim(), label: label.trim() || undefined, locationId: scope || undefined });
    setUrl(""); setLabel("");
    return "Added. Choose what to send there below.";
  });

  const where = (d: Dest) => (d.locationId ? `Only ${d.accountName ?? "one client account"}` : data.mode === "agency" ? "All client accounts" : "Your account");
  return (
    <Section title="Where messages go" hint="Slack channels. Each one is chosen on Slack's own page. Email addresses are set per message below." id="slack-channels">
      {data.destinations.length === 0 ? (
        <p className="mb-3 text-sm text-muted-foreground" data-testid="no-slack">No Slack channel is connected. Press Add to Slack, pick a channel on Slack&apos;s page, and come back here.</p>
      ) : (
        <ul className="mb-3 divide-y border-y" data-testid="destinations">
          {data.destinations.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm" data-testid="destination">
              <span className="min-w-0 flex-1">
                <span className="font-medium">{d.label ?? "Slack channel"}</span>
                <span className="text-muted-foreground"> {"·"} {where(d)}</span>
                <span className="ml-2 inline-block align-middle"><Badge tone={TONE[d.status]}>{d.status === "needs_reconnect" ? "Needs permission: reconnect" : d.status === "expired" ? STATUS_WORDS.expired : d.status === "waiting" ? STATUS_WORDS.waiting : d.status === "connected" ? "Connected" : STATUS_WORDS[d.status]}</Badge></span>
                {d.lastErrorCode && d.status !== "connected" && <span className="block text-xs text-muted-foreground">If you contact us, send this code: {d.lastErrorCode}</span>}
                {d.legacy && <span className="block text-xs text-muted-foreground">Set up earlier in Settings. It works like any other channel.</span>}
              </span>
              <span className="flex flex-wrap gap-1">
                {(d.status === "needs_reconnect" || d.status === "expired") && <Btn variant="primary" disabled={waiting !== null} onClick={() => void start()}>{d.status === "expired" ? "Try again" : "Connect again"}</Btn>}
                {d.status === "connected" && <Btn disabled={busy === d.id} onClick={() => void run(d.id, async () => (await api.post<{ text: string }>(`notification-destinations/${d.id}/test`)).text)}>Send a test message</Btn>}
                {confirm === d.id
                  ? <span className="flex items-center gap-1"><span className="text-xs text-muted-foreground">Stop sending here?</span><Btn variant="primary" onClick={() => { setConfirm(null); void run(d.id, async () => { await api.del(`notification-destinations/${d.id}`); return "Disconnected. Nothing more will be sent there."; }); }}>Yes, disconnect</Btn><Btn variant="ghost" onClick={() => setConfirm(null)}>Keep</Btn></span>
                  : <Btn variant="ghost" onClick={() => setConfirm(d.id)}>Disconnect</Btn>}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-2">
        {data.mode === "agency" && (
          <div>
            <label htmlFor="slack-scope" className="mb-1 block text-xs font-medium text-muted-foreground">This channel receives</label>
            <select id="slack-scope" className={`${inputClass} !w-auto`} value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="">Everything (all client accounts)</option>
              {data.accounts.map((a) => <option key={a.locationId} value={a.locationId}>Only {a.name}</option>)}
            </select>
          </div>
        )}
        <Btn variant="primary" disabled={!data.flags.slackAvailable || waiting !== null || data.destinations.length >= data.maxDestinations} onClick={() => void start()}>{waiting !== null ? "Waiting for you..." : "Add to Slack"}</Btn>
      </div>
      {data.mode === "agency" && <p className="mt-1 text-xs text-muted-foreground">A channel limited to one client account only ever receives that account&apos;s messages, never another client&apos;s.</p>}
      {!data.flags.slackAvailable && <p className="mt-1 text-xs text-muted-foreground" data-testid="slack-not-set-up">Add to Slack needs the Slack app to be set up for SubSync first. You can still add a channel with its address under Advanced.</p>}
      {note && <div className="mt-3"><InlineAlert tone={note.ok ? "success" : "danger"}>{note.text}</InlineAlert></div>}
      <details className="mt-4 text-sm" data-testid="slack-advanced">
        <summary className="cursor-pointer text-muted-foreground">Advanced: add a channel by pasting its address</summary>
        <div className="mt-2 grid max-w-xl gap-2">
          <label htmlFor="slack-url" className="text-xs font-medium text-muted-foreground">Channel address (starts with https://hooks.slack.com/services/)</label>
          <input id="slack-url" type="password" autoComplete="off" className={inputClass} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://hooks.slack.com/services/..." />
          <label htmlFor="slack-label" className="text-xs font-medium text-muted-foreground">A name for it</label>
          <input id="slack-label" className={inputClass} maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Sales team" />
          <div><Btn disabled={busy === "advanced" || !url.trim()} onClick={() => void addByAddress()}>Add channel</Btn></div>
          <p className="text-xs text-muted-foreground">The address works like a password: anyone who has it can post in that channel. It is stored encrypted and never shown again.</p>
        </div>
      </details>
    </Section>
  );
}

// ---------------- one kind of message ----------------

type Draft = {
  enabled: boolean; inApp: boolean; email: boolean; recipientsText: string; slack: string[];
  frequency: "immediate" | "daily" | "weekly"; hour: number; weekday: Timing["weekday"]; timezone: string;
  quietOn: boolean; quietStart: number; quietEnd: number; criticalBypass: boolean; title: string; body: string;
};

const toDraft = (t: TypeData): Draft => ({
  enabled: t.pref.enabled, inApp: t.pref.inApp, email: t.pref.email, recipientsText: t.pref.recipients.join("\n"), slack: t.pref.slackDestinations,
  frequency: t.pref.timing.frequency, hour: t.pref.timing.hour, weekday: t.pref.timing.weekday, timezone: t.pref.timing.timezone ?? "",
  quietOn: t.pref.timing.quietOn, quietStart: t.pref.timing.quietStart, quietEnd: t.pref.timing.quietEnd, criticalBypass: t.pref.timing.criticalBypass,
  title: t.pref.copy.title ?? t.defaults.title, body: t.pref.copy.body ?? t.defaults.body,
});

const recipientsOf = (text: string) => [...new Set(text.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean))];
const hours = Array.from({ length: 24 }, (_, h) => h);
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

function summary(t: TypeData, data: Data): string {
  if (!t.active) return "Not available yet";
  if (!t.pref.enabled) return "Off";
  const bits: string[] = [];
  if (t.pref.inApp) bits.push("bell");
  if (t.pref.email) bits.push(t.pref.recipients.length ? `email (${t.pref.recipients.length})` : "email (no address yet)");
  const names = t.pref.slackDestinations.map((id) => data.destinations.find((d) => d.id === id)?.label).filter(Boolean);
  if (names.length) bits.push(`Slack (${names.length === 1 ? names[0] : names.length + " channels"})`);
  return `${bits.length ? bits.join(", ") : "nowhere yet"} · ${t.pref.whenText}`;
}

function TypeRow({ t, data, reload, open, onToggle, note, setNote }: { note: Note | null; setNote: (n: Note | null) => void; t: TypeData; data: Data; reload: () => Promise<void>; open: boolean; onToggle: () => void }) {
  const api = useApiClient();
  const [d, setD] = useState<Draft>(() => toDraft(t));
  const [busy, setBusy] = useState(false);
  const [testTo, setTestTo] = useState(t.pref.recipients[0] ?? "");
  const [testDest, setTestDest] = useState(t.pref.slackDestinations[0] ?? "");
  const titleRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  const timing: Timing = { frequency: d.frequency, hour: d.hour, weekday: d.weekday, timezone: d.timezone.trim() || null, quietOn: d.quietOn, quietStart: d.quietStart, quietEnd: d.quietEnd, criticalBypass: d.criticalBypass };
  const preview = previewCopy(t.id, { title: d.title, body: d.body });
  const event = t.kind === "event";
  const slackChoices = data.destinations.filter((x) => x.status === "connected");

  const call = async (fn: () => Promise<string>) => {
    setBusy(true); setNote(null);
    try { const text = await fn(); setNote({ ok: true, text }); } catch (e) { setNote({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  };
  const save = () => call(async () => {
    await api.put(`notification-prefs/${t.id}`, { enabled: d.enabled, inApp: d.inApp, email: d.email, recipients: recipientsOf(d.recipientsText), slackDestinations: d.slack, timing });
    await reload();
    return "Saved.";
  });
  const saveWording = () => call(async () => { await api.put(`notification-prefs/${t.id}/copy`, { title: d.title, body: d.body }); await reload(); return "Wording saved."; });
  const resetWording = () => call(async () => { await api.del(`notification-prefs/${t.id}/copy`); await reload(); return "Back to the default wording."; });
  const sendTest = (channel: "email" | "slack" | "in_app") => call(async () => {
    const r = await api.post<{ text: string }>(`notification-prefs/${t.id}/test`, channel === "email" ? { channel, to: testTo } : channel === "slack" ? { channel, destinationId: testDest } : { channel });
    return r.text;
  });
  const insert = (name: string) => { set("title", `${d.title}{${name}}`); titleRef.current?.focus(); };

  return (
    <li className="py-3" data-testid={`type-${t.id}`}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{t.label} {!t.active && <span className="ml-1 text-xs font-normal text-muted-foreground">(not built yet)</span>}</h3>
          <p className="text-xs text-muted-foreground">{t.hint}</p>
          <p className="mt-0.5 text-sm" data-testid={`summary-${t.id}`}>{summary(t, data)}</p>
        </div>
        <button type="button" disabled={!t.active} aria-expanded={open} aria-controls={`panel-${t.id}`} onClick={onToggle}
          className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3.5 py-1.5 text-sm font-medium transition-all hover:border-primary/40 hover:bg-accent/50 disabled:pointer-events-none disabled:opacity-50">{open ? "Close" : "Change"}</button>
      </div>
      {open && t.active && (
        <div className="mt-3 grid gap-5 border-l-2 pl-4" id={`panel-${t.id}`} data-testid={`panel-${t.id}`}>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={d.enabled} onChange={(e) => set("enabled", e.target.checked)} /> Send this kind of message</label>

          <fieldset className="grid gap-2 text-sm" disabled={!d.enabled}>
            <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Where</legend>
            <label className="flex items-center gap-2"><input type="checkbox" className="size-4" checked={d.inApp} onChange={(e) => set("inApp", e.target.checked)} /> The bell in SubSync</label>
            <label className="flex items-center gap-2"><input type="checkbox" className="size-4" checked={d.email} onChange={(e) => set("email", e.target.checked)} /> Email</label>
            {d.email && (
              <div className="ml-6">
                <label htmlFor={`rcpt-${t.id}`} className="mb-1 block text-xs text-muted-foreground">Email addresses, one per line (up to 10). Each gets its own message with a link to stop it.</label>
                <textarea id={`rcpt-${t.id}`} rows={3} className={inputClass} value={d.recipientsText} onChange={(e) => set("recipientsText", e.target.value)} placeholder="you@yourcompany.com" />
                {!data.flags.emailReady && <p className="mt-1 text-xs text-muted-foreground">Saved now, but emails only go out once an email service is connected to the app.</p>}
              </div>
            )}
            <div>
              <span className="mb-1 block">Slack</span>
              {slackChoices.length === 0 ? <p className="text-xs text-muted-foreground">No Slack channel is connected yet. Add one above.</p> : (
                <ul className="grid gap-1">
                  {slackChoices.map((c) => (
                    <li key={c.id}><label className="flex items-center gap-2"><input type="checkbox" className="size-4" checked={d.slack.includes(c.id)} onChange={(e) => set("slack", e.target.checked ? [...d.slack, c.id] : d.slack.filter((x) => x !== c.id))} /> {c.label ?? "Slack channel"} <span className="text-xs text-muted-foreground">{c.locationId ? `only ${c.accountName ?? "one account"}` : "everything"}</span></label></li>
                  ))}
                </ul>
              )}
            </div>
          </fieldset>

          <fieldset className="grid gap-2 text-sm" disabled={!d.enabled}>
            <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">When</legend>
            {event && t.frequencies.length > 1 && (
              <div className="flex flex-wrap gap-4">
                {t.frequencies.map((f) => <label key={f} className="flex items-center gap-2"><input type="radio" name={`freq-${t.id}`} checked={d.frequency === f} onChange={() => set("frequency", f)} /> {f === "immediate" ? "As it happens" : f === "daily" ? "Once a day, in one message" : "Once a week"}</label>)}
              </div>
            )}
            {(d.frequency === "daily" || d.frequency === "weekly") && (
              <div className="flex flex-wrap items-end gap-3">
                {d.frequency === "weekly" && (
                  <div><label htmlFor={`wd-${t.id}`} className="mb-1 block text-xs text-muted-foreground">Day</label>
                    <select id={`wd-${t.id}`} className={`${inputClass} !w-auto`} value={d.weekday} onChange={(e) => set("weekday", e.target.value as Timing["weekday"])}>{WEEKDAYS.map((w) => <option key={w} value={w}>{WEEKDAY_NAMES[w]}</option>)}</select></div>
                )}
                <div><label htmlFor={`hr-${t.id}`} className="mb-1 block text-xs text-muted-foreground">At</label>
                  <select id={`hr-${t.id}`} className={`${inputClass} !w-auto`} value={d.hour} onChange={(e) => set("hour", Number(e.target.value))}>{hours.map((h) => <option key={h} value={h}>{hh(h)}</option>)}</select></div>
              </div>
            )}
            <div>
              <label htmlFor={`tz-${t.id}`} className="mb-1 block text-xs text-muted-foreground">Time zone</label>
              <div className="flex max-w-sm gap-2">
                <input id={`tz-${t.id}`} className={inputClass} placeholder={data.zone ?? "Africa/Lagos"} value={d.timezone} onChange={(e) => set("timezone", e.target.value)} />
                <Btn onClick={() => set("timezone", Intl.DateTimeFormat().resolvedOptions().timeZone)}>Use mine</Btn>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Left empty, it uses the time zone of your first client account{data.zone ? ` (${data.zone})` : ""}.</p>
            </div>
            {event && (
              <div className="grid gap-2" data-testid={`quiet-${t.id}`}>
                <label className="flex items-center gap-2"><input type="checkbox" className="size-4" checked={d.quietOn} onChange={(e) => set("quietOn", e.target.checked)} /> Quiet hours</label>
                {d.quietOn && (
                  <div className="ml-6 flex flex-wrap items-end gap-3">
                    <div><label htmlFor={`qs-${t.id}`} className="mb-1 block text-xs text-muted-foreground">From</label><select id={`qs-${t.id}`} className={`${inputClass} !w-auto`} value={d.quietStart} onChange={(e) => set("quietStart", Number(e.target.value))}>{hours.map((h) => <option key={h} value={h}>{hh(h)}</option>)}</select></div>
                    <div><label htmlFor={`qe-${t.id}`} className="mb-1 block text-xs text-muted-foreground">Until</label><select id={`qe-${t.id}`} className={`${inputClass} !w-auto`} value={d.quietEnd} onChange={(e) => set("quietEnd", Number(e.target.value))}>{hours.map((h) => <option key={h} value={h}>{hh(h)}</option>)}</select></div>
                    <label className="flex items-center gap-2 pb-2"><input type="checkbox" className="size-4" checked={d.criticalBypass} onChange={(e) => set("criticalBypass", e.target.checked)} /> Critical alerts are still sent at once</label>
                  </div>
                )}
                <p className="text-xs text-muted-foreground" data-testid={`quiet-text-${t.id}`}>{quietText(timing)}</p>
              </div>
            )}
          </fieldset>

          <div className="flex flex-wrap items-center gap-2">
            <Btn variant="primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving..." : "Save"}</Btn>
            <span className="text-xs text-muted-foreground">Saves where, when and quiet hours. The wording has its own button below.</span>
          </div>

          <div className="grid gap-2" data-testid={`wording-${t.id}`}>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">The wording</h4>
            <label htmlFor={`title-${t.id}`} className="text-xs text-muted-foreground">Title</label>
            <input id={`title-${t.id}`} ref={titleRef} className={inputClass} value={d.title} onChange={(e) => set("title", e.target.value)} maxLength={150} />
            <label htmlFor={`body-${t.id}`} className="text-xs text-muted-foreground">Second line (optional)</label>
            <textarea id={`body-${t.id}`} rows={2} className={inputClass} value={d.body} onChange={(e) => set("body", e.target.value)} maxLength={600} />
            <p className="text-xs text-muted-foreground">Add details with: {t.variables.map((v) => <button key={v.name} type="button" title={v.label} onClick={() => insert(v.name)} className="mr-1.5 rounded border px-1.5 py-0.5 font-mono text-[11px] hover:bg-muted">{`{${v.name}}`}</button>)}</p>
            {preview.ok
              ? <div className="border-l-2 border-primary py-1 pl-3 text-sm" data-testid={`preview-${t.id}`}><p className="text-xs text-muted-foreground">Preview, with sample details</p><p className="font-medium">{preview.title}</p>{preview.body && <p>{preview.body}</p>}</div>
              : <InlineAlert tone="danger"><span data-testid={`preview-error-${t.id}`}>{preview.errors.title ?? preview.errors.body}</span></InlineAlert>}
            <div className="flex flex-wrap gap-2">
              <Btn disabled={busy || !preview.ok} onClick={() => void saveWording()}>Save wording</Btn>
              <Btn variant="ghost" disabled={busy || !t.customCopy} onClick={() => void resetWording()}>Reset to default</Btn>
            </div>
          </div>

          <div className="grid gap-2 text-sm" data-testid={`test-${t.id}`}>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Send me a test</h4>
            <div className="flex flex-wrap items-end gap-2">
              <Btn disabled={busy} onClick={() => void sendTest("in_app")}>Add a test to the bell</Btn>
              {t.pref.recipients.length > 0 && (
                <>
                  <label htmlFor={`tto-${t.id}`} className="sr-only">Send the test email to</label>
                  <select id={`tto-${t.id}`} className={`${inputClass} !w-auto`} value={testTo} onChange={(e) => setTestTo(e.target.value)}>{t.pref.recipients.map((r) => <option key={r} value={r}>{r}</option>)}</select>
                  <Btn disabled={busy || !testTo} onClick={() => void sendTest("email")}>Send a test email</Btn>
                </>
              )}
              {slackChoices.length > 0 && (
                <>
                  <label htmlFor={`tds-${t.id}`} className="sr-only">Send the test to Slack channel</label>
                  <select id={`tds-${t.id}`} className={`${inputClass} !w-auto`} value={testDest} onChange={(e) => setTestDest(e.target.value)}>{slackChoices.map((c) => <option key={c.id} value={c.id}>{c.label ?? "Slack channel"}</option>)}</select>
                  <Btn disabled={busy || !testDest} onClick={() => void sendTest("slack")}>Send a test to Slack</Btn>
                </>
              )}
            </div>
            <p className="text-xs text-muted-foreground">A test uses sample details and is marked as a test. Save your addresses first: a test only goes to an address you have saved.</p>
          </div>
          {note && <InlineAlert tone={note.ok ? "success" : "danger"}>{note.text}</InlineAlert>}
        </div>
      )}
    </li>
  );
}

/** One line for Settings: "Daily brief: on, 8:00 your time". Shows nothing for a person who cannot see the choices. */
export function DailyBriefLine() {
  const { data } = useData<Data>("notification-prefs");
  const t = data?.types.find((x) => x.id === "daily_brief");
  if (!t) return null;
  const where = [t.pref.inApp ? "bell" : null, t.pref.email ? "email" : null, t.pref.slackDestinations.length ? "Slack" : null].filter(Boolean).join(", ");
  return (
    <p className="text-sm" data-testid="daily-brief-line">
      <strong className="font-medium">Daily brief:</strong> {t.pref.enabled ? `on, ${t.pref.whenText}${where ? ` (${where})` : ""}` : "off"}. <a className="font-medium underline underline-offset-2" href="#notifications">Change it in Notifications</a>.
    </p>
  );
}
