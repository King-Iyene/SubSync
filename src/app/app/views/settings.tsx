"use client";

import { useEffect, useState } from "react";
import { useApiClient, useData } from "../session";
import type { SyncStatus } from "../types";
import { Badge, Btn, Card, ErrorBox, inputClass, Loading, PageHeader, timeAgo } from "../ui";
import { ConnectionsCard } from "./connections";
import { HealthCard } from "./health-card";

type S = { staleDays: number; dormantDays: number; slaHours: number; appDomain: string; digestEnabled: boolean; customChecklist: string[]; digestHour: number | null; digestTimezone: string | null; digestEmail: string | null; emailReady?: boolean; brandName: string | null; brandColor: string | null; industryTargets?: boolean; keepTranscripts: boolean; speedTargetMinutes: number; countAutomatedTouches: boolean };

export function SettingsView() {
  const api = useApiClient();
  const { data, error, loading, reload } = useData<{ features?: Record<string, boolean>; settings: S; slackConfigured: boolean; kind?: string; clientView?: { on: number; total: number } | null; clientAccounts?: Array<{ locationId: string; name: string; on: boolean }> }>("settings");
  const sync = useData<SyncStatus>("sync");
  const keys = useData<{ keys: Array<{ id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null }>; max: number; endpoint: string }>("api-keys");
  const [keyName, setKeyName] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [form, setForm] = useState<S | null>(null);
  const [slack, setSlack] = useState("");
  const [checklist, setChecklist] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [digest, setDigest] = useState<string | null>(null);

  useEffect(() => {
    if (data && !form) {
      // First load only: copy server values into the editable form.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm(data.settings);
      setChecklist(data.settings.customChecklist.join("\n"));
    }
  }, [data, form]);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data || !form) return null;

  const num = (key: "staleDays" | "dormantDays" | "slaHours") => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: Number(e.target.value) });

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const body: Record<string, unknown> = {
        staleDays: form.staleDays, dormantDays: form.dormantDays, slaHours: form.slaHours, appDomain: form.appDomain,
        digestEnabled: form.digestEnabled, digestHour: form.digestHour, digestTimezone: form.digestTimezone, digestEmail: form.digestEmail, brandName: form.brandName, brandColor: form.brandColor, keepTranscripts: form.keepTranscripts, speedTargetMinutes: form.speedTargetMinutes, countAutomatedTouches: form.countAutomatedTouches,
        customChecklist: checklist.split("\n").map((l) => l.trim()).filter(Boolean),
      };
      if (slack.trim()) body.slackWebhookUrl = slack.trim();
      await api.put("settings", body);
      setSlack("");
      await reload();
      setMsg({ ok: true, text: "Saved. Alerts and scores have been recalculated." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const call = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      void reload();
      setMsg({ ok: true, text: done });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-3xl">
      <PageHeader title="Settings" subtitle="Tune what counts as stale, dormant or overdue for your agency." />
      {msg && <p className={`mb-4 rounded-lg border px-3 py-2 text-sm ${msg.ok ? "" : "border-red-500/40 bg-red-500/5"}`} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}

      <div className="space-y-4">
        <Card title="Thresholds">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="stale" className="mb-1 block text-sm font-medium">Stale deal after (days)</label>
              <input id="stale" type="number" min={7} max={365} className={inputClass} value={form.staleDays} onChange={num("staleDays")} />
              <p className="mt-1 text-xs text-muted-foreground">An open deal with no movement for this long is stale.</p>
            </div>
            <div>
              <label htmlFor="dormant" className="mb-1 block text-sm font-medium">Dormant after (days)</label>
              <input id="dormant" type="number" min={7} max={365} className={inputClass} value={form.dormantDays} onChange={num("dormantDays")} />
              <p className="mt-1 text-xs text-muted-foreground">No new contacts, deal changes or messages for this long.</p>
            </div>
            <div>
              <label htmlFor="sla" className="mb-1 block text-sm font-medium">Reply SLA (hours)</label>
              <input id="sla" type="number" min={1} max={168} className={inputClass} value={form.slaHours} onChange={num("slaHours")} />
              <p className="mt-1 text-xs text-muted-foreground">An inbound message unanswered this long is a breach.</p>
            </div>
          </div>
        </Card>

        <Card title="Onboarding checklist">
          <label htmlFor="custom" className="mb-1 block text-sm font-medium">Your own steps (one per line, up to 10)</label>
          <textarea id="custom" rows={4} className={inputClass} value={checklist} onChange={(e) => setChecklist(e.target.value)} placeholder={"Send welcome gift\nCollect testimonial"} />
          <p className="mt-1 text-xs text-muted-foreground">These appear on every account&apos;s checklist next to the automatic checks.</p>
        </Card>

        {data.clientView && (
          <Card title="Client access">
            <ul className="mb-4 divide-y rounded-lg border text-sm" aria-label="Client access by account">
              {(data.clientAccounts ?? []).map((a) => (
                <li key={a.locationId} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="font-medium">{a.name}</span>
                  <span className="flex items-center gap-3">
                    <Badge tone={a.on ? "good" : "neutral"}>{a.on ? "On" : "Off"}</Badge>
                    <button type="button" role="switch" aria-checked={a.on} aria-label={`Client access for ${a.name}`} disabled={busy}
                      onClick={() => call(() => api.put(`accounts/${a.locationId}/flags`, { clientView: !a.on }), `Client access ${a.on ? "off" : "on"} for ${a.name}.`)}
                      className={`relative h-6 w-11 rounded-full transition-colors disabled:opacity-50 ${a.on ? "bg-primary" : "bg-muted-foreground/40"}`}>
                      <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${a.on ? "left-[22px]" : "left-0.5"}`} />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mb-3 text-sm text-muted-foreground">
              Let your clients&apos; own staff open SubSync inside their account. They see a read-only view of that one account only: never other clients, your fees, notes or settings.
              Right now it is on for {data.clientView.on} of {data.clientView.total} accounts. You can also switch it on per client from the account page.
            </p>
            <div className="flex flex-wrap gap-2">
              <Btn disabled={busy} onClick={() => call(() => api.put("settings", { clientViewAll: true }), "Client view is on for every account.")}>Switch on for all</Btn>
              <Btn disabled={busy} onClick={() => call(() => api.put("settings", { clientViewAll: false }), "Client view is off for every account.")}>Switch off for all</Btn>
            </div>
          </Card>
        )}

        {data.features?.meetings !== false && (
        <Card title="Meeting notes privacy">
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 size-4" checked={form.keepTranscripts} onChange={(e) => setForm({ ...form, keepTranscripts: e.target.checked })} />
            <span>Keep full transcripts when a meeting tool sends them. Off by default: only the summary and action items are stored, which is safer for clinics and anyone handling private conversations.</span></label>
        </Card>
        )}

        <Card title="Speed to lead">
          <p className="mb-3 text-sm text-muted-foreground">How fast a new lead should hear from a person. A lead cools in minutes, so the target is short. Messages from workflows and campaigns are not replies unless you say so.</p>
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label htmlFor="speed-target" className="mb-1 block text-sm font-medium">Reply target (minutes)</label>
              <input id="speed-target" type="number" min={1} max={1440} className={`${inputClass} !w-32`} value={form.speedTargetMinutes} onChange={(e) => setForm({ ...form, speedTargetMinutes: Number(e.target.value) })} />
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" className="size-4" checked={form.countAutomatedTouches} onChange={(e) => setForm({ ...form, countAutomatedTouches: e.target.checked })} /> Count automatic messages as a reply</label>
          </div>
        </Card>

        <Card title="Your name on reports">
          <p className="mb-3 text-sm text-muted-foreground">Shown at the top of printed client reports and quarterly reviews, so what you hand to a client carries your name, not ours.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="brand-name" className="mb-1 block text-sm font-medium">Business name</label>
              <input id="brand-name" className={inputClass} maxLength={60} placeholder="Acme Marketing" value={form.brandName ?? ""} onChange={(e) => setForm({ ...form, brandName: e.target.value || null })} />
            </div>
            <div>
              <label htmlFor="brand-color" className="mb-1 block text-sm font-medium">Colour</label>
              <div className="flex items-center gap-2">
                <input id="brand-color" type="color" className="h-9 w-14 cursor-pointer rounded-lg border bg-background p-1" value={form.brandColor ?? "#1d4ed8"} onChange={(e) => setForm({ ...form, brandColor: e.target.value })} />
                {form.brandColor && <Btn variant="ghost" onClick={() => setForm({ ...form, brandColor: null })}>Clear</Btn>}
              </div>
            </div>
          </div>
        </Card>

        {data.features?.connections !== false && <ConnectionsCard />}

        <Card title="Slack alerts and daily brief">
          <p className="mb-3 text-sm text-muted-foreground">
            New critical and warning alerts are posted to your Slack channel, and a weekly summary can go out on Mondays.
            {data.slackConfigured ? " A channel is saved (its address is never shown again)." : " Connect Slack above, or paste a Slack web address below."}
          </p>
          <label htmlFor="slack" className="mb-1 block text-sm font-medium">Or paste a Slack web address (advanced)</label>
          <input id="slack" className={inputClass} type="password" autoComplete="off" placeholder={data.slackConfigured ? "Saved. Paste a new URL to replace it" : "https://hooks.slack.com/services/..."} value={slack} onChange={(e) => setSlack(e.target.value)} />
          <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={form.digestEnabled} onChange={(e) => setForm({ ...form, digestEnabled: e.target.checked })} /> Send the daily brief to Slack</label>
          <div className="mt-3">
            <label htmlFor="digest-email" className="mb-1 block text-sm font-medium">Weekly email (Mondays)</label>
            <input id="digest-email" type="email" className={inputClass} placeholder="you@youragency.com" value={form.digestEmail ?? ""} onChange={(e) => setForm({ ...form, digestEmail: e.target.value.trim() || null })} />
            <p className="mt-1 text-xs text-muted-foreground">{data.settings.emailReady ? "One address. Sent Monday at the hour below, in your time zone." : "Saved now, but nothing is sent until an email service is connected to the app."}</p>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="digest-hour" className="mb-1 block text-sm font-medium">Send at</label>
              <select id="digest-hour" className={inputClass} value={form.digestHour ?? 8} onChange={(e) => setForm({ ...form, digestHour: Number(e.target.value) })}>
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="digest-zone" className="mb-1 block text-sm font-medium">Time zone</label>
              <div className="flex gap-2">
                <input id="digest-zone" className={inputClass} placeholder="Africa/Lagos" value={form.digestTimezone ?? ""} onChange={(e) => setForm({ ...form, digestTimezone: e.target.value.trim() || null })} />
                <Btn onClick={() => setForm({ ...form, digestTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone })}>Use mine</Btn>
              </div>
            </div>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Goes out once a day at that hour. Left blank, it uses 08:00 in the time zone of your first client account.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Btn disabled={busy || !data.slackConfigured} onClick={() => call(() => api.post("settings/test-slack"), "Test message sent to Slack.")}>Send test message</Btn>
            <Btn onClick={async () => setDigest((await api.get<{ text: string }>("digest")).text)}>Preview the daily brief</Btn>
          </div>
          {digest && <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-xs">{digest}</pre>}
        </Card>

        {data.features?.ai !== false && (
        <Card title="AI assistant connector">
          <p className="mb-3 text-sm text-muted-foreground">
            Let Claude, ChatGPT or any assistant that supports MCP answer questions about all your clients at once, for example
            &quot;which accounts are at risk this week?&quot; or &quot;find John Smith across my clients&quot;. Access is read-only and limited to your agency.
          </p>
          {keys.error?.status === 402 ? (
            <p className="rounded-lg border border-sky-500/40 bg-sky-500/5 p-3 text-sm">The AI connector is part of the paid plan.</p>
          ) : (
            <>
              {keys.data && (
                <dl className="mb-3 space-y-1 text-sm">
                  <div className="flex flex-wrap gap-x-2"><dt className="text-muted-foreground">Server address:</dt><dd><code className="rounded bg-muted px-1.5 py-0.5 text-xs">{keys.data.endpoint}</code></dd></div>
                  <div className="flex flex-wrap gap-x-2"><dt className="text-muted-foreground">Authentication:</dt><dd>send your key as <code className="rounded bg-muted px-1.5 py-0.5 text-xs">Authorization: Bearer &lt;key&gt;</code></dd></div>
                </dl>
              )}
              {newKey && (
                <div className="mb-3 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm" role="status">
                  <p className="font-medium">Copy your new key now. It is shown only once.</p>
                  <code className="mt-2 block break-all rounded bg-muted p-2 text-xs">{newKey}</code>
                  <Btn variant="ghost" onClick={() => setNewKey(null)}>I have copied it</Btn>
                </div>
              )}
              {keys.data && keys.data.keys.length > 0 && (
                <ul className="mb-3 divide-y rounded-lg border">
                  {keys.data.keys.map((k) => (
                    <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                      <span><span className="font-medium">{k.name}</span> <span className="text-muted-foreground">· {k.prefix}… · created {timeAgo(k.createdAt)} · {k.lastUsedAt ? `used ${timeAgo(k.lastUsedAt)}` : "never used"}</span></span>
                      <Btn disabled={busy} onClick={() => call(async () => { await api.post(`api-keys/${k.id}/revoke`); await keys.reload(); }, "Key revoked. It no longer works.")}>Revoke</Btn>
                    </li>
                  ))}
                </ul>
              )}
              <form className="flex flex-wrap gap-2" onSubmit={(e) => {
                e.preventDefault();
                void call(async () => {
                  const res = await api.post<{ key: string }>("api-keys", { name: keyName.trim() });
                  setNewKey(res.key);
                  setKeyName("");
                  await keys.reload();
                }, "Key created.");
              }}>
                <input className={`${inputClass} max-w-xs`} placeholder="Name, e.g. Claude desktop" maxLength={60} value={keyName} onChange={(e) => setKeyName(e.target.value)} aria-label="Name for the new key" />
                <Btn type="submit" disabled={busy || !keyName.trim()}>Create key</Btn>
              </form>
            </>
          )}
        </Card>
        )}

        <Card title="Links">
          <label htmlFor="domain" className="mb-1 block text-sm font-medium">The address you log in to</label>
          <input id="domain" className={inputClass} value={form.appDomain} onChange={(e) => setForm({ ...form, appDomain: e.target.value })} />
          <p className="mt-1 text-xs text-muted-foreground">White-label agencies: use your own domain so &quot;Open&quot; links land in your branded app.</p>
        </Card>

        <div className="lg:col-span-2"><HealthCard /></div>
        <Card title="Data sync">
          {sync.data ? (
            <p className="text-sm text-muted-foreground">Last completed {timeAgo(sync.data.lastFinishedAt)} · {sync.data.pending} queued · {sync.data.failed} failed. Data refreshes automatically about once a day and as changes arrive.</p>
          ) : <p className="text-sm text-muted-foreground">Checking...</p>}
          <div className="mt-3"><Btn disabled={busy} onClick={() => call(async () => { await api.post("sync"); await sync.reload(); }, api.demo ? "Insights refreshed." : "Sync started.")}>{api.demo ? "Refresh insights" : "Sync now"}</Btn></div>
        </Card>

        <Card title="What we store">
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Contacts: name, email, phone, tags and dates, only to power search and data-quality checks.</li>
            <li>Deals: name, value, stage and dates. Conversations: who wrote, when and through which channel; never message text.</li>
            <li>Everything is deleted when you uninstall SubSync, and tokens are encrypted at rest.</li>
          </ul>
        </Card>

        <Card title="Delete my data">
          <p className="mb-3 text-sm text-muted-foreground">
            Permanently removes everything SubSync has copied from your client accounts: contacts, deals, conversation summaries, scores, alerts and history.
            Your settings and keys stay, and the next sync starts from scratch. Uninstalling the app deletes it all automatically.
          </p>
          <div className="flex flex-wrap gap-2">
            <input className={`${inputClass} max-w-48`} placeholder="Type DELETE" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} aria-label="Type DELETE to confirm" />
            <Btn disabled={busy || confirmText !== "DELETE" || api.demo} onClick={() => call(async () => { await api.post("settings/purge", { confirm: "DELETE" }); setConfirmText(""); }, "All synced data deleted.")}>Delete all synced data</Btn>
          </div>
          {api.demo && <p className="mt-2 text-xs text-muted-foreground">Disabled in demo mode.</p>}
        </Card>

        <div><Btn variant="primary" disabled={busy} onClick={save}>{busy ? "Saving..." : "Save settings"}</Btn></div>
      </div>
    </div>
  );
}
