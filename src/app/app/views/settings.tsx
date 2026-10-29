"use client";

import { useEffect, useState } from "react";
import { useApiClient, useData } from "../session";
import type { SyncStatus } from "../types";
import { Btn, Card, ErrorBox, inputClass, Loading, PageHeader, timeAgo } from "../ui";

type S = { staleDays: number; dormantDays: number; slaHours: number; appDomain: string; digestEnabled: boolean; customChecklist: string[] };

export function SettingsView() {
  const api = useApiClient();
  const { data, error, loading, reload } = useData<{ settings: S; slackConfigured: boolean }>("settings");
  const sync = useData<SyncStatus>("sync");
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
        digestEnabled: form.digestEnabled,
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

        <Card title="Slack">
          <p className="mb-3 text-sm text-muted-foreground">
            New critical and warning alerts are posted to a Slack channel, and a weekly summary can go out on Mondays.
            {data.slackConfigured ? " A webhook is saved (it is never shown again)." : " Create an incoming webhook in Slack and paste its URL here."}
          </p>
          <label htmlFor="slack" className="mb-1 block text-sm font-medium">Webhook URL</label>
          <input id="slack" className={inputClass} type="password" autoComplete="off" placeholder={data.slackConfigured ? "Saved. Paste a new URL to replace it" : "https://hooks.slack.com/services/..."} value={slack} onChange={(e) => setSlack(e.target.value)} />
          <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={form.digestEnabled} onChange={(e) => setForm({ ...form, digestEnabled: e.target.checked })} /> Send a weekly summary on Mondays</label>
          <div className="mt-3 flex flex-wrap gap-2">
            <Btn disabled={busy || !data.slackConfigured} onClick={() => call(() => api.post("settings/test-slack"), "Test message sent to Slack.")}>Send test message</Btn>
            <Btn onClick={async () => setDigest((await api.get<{ text: string }>("digest")).text)}>Preview weekly summary</Btn>
          </div>
          {digest && <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-xs">{digest}</pre>}
        </Card>

        <Card title="Links">
          <label htmlFor="domain" className="mb-1 block text-sm font-medium">The address you log in to</label>
          <input id="domain" className={inputClass} value={form.appDomain} onChange={(e) => setForm({ ...form, appDomain: e.target.value })} />
          <p className="mt-1 text-xs text-muted-foreground">White-label agencies: use your own domain so &quot;Open&quot; links land in your branded app.</p>
        </Card>

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

        <div><Btn variant="primary" disabled={busy} onClick={save}>{busy ? "Saving..." : "Save settings"}</Btn></div>
      </div>
    </div>
  );
}
