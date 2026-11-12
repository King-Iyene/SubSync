"use client";

import { useEffect, useRef, useState } from "react";
import { crmNoteState } from "@/lib/meeting-wording";
import { NUMBER_SETTINGS, SETTINGS_SECTION_KEY, isSectionId, sectionsFor, type SectionId } from "@/lib/settings-sections";
import { storeLines, deleteMyDataText, uninstallText } from "@/lib/data-inventory";
import { remember, remembered } from "../ds/remember";
import { useApiClient, useData } from "../session";
import { Badge, Btn, Card, ErrorBox, inputClass, Loading, PageHeader, timeAgo } from "../ui";
import { SyncStatusPanel } from "./sync-status";
import { ConnectionsSlot } from "./settings-slot-connections";
import { WriteAccessCard } from "./write-access";
import { PipelineHistoryCard } from "./settings-pipeline-history";
import { WatchingSlot } from "./settings-slot-watching";
import { DailyBriefLine } from "./notifications";
import { BrandPreview, PermissionsPanel, SettingsHistoryCard, TestAccountsCard, WhoCanOpenCard, type PermissionGroup } from "./settings-parts";

type S = { staleDays: number; dormantDays: number; slaHours: number; appDomain: string; appDomainSource: "manual" | "sso" | "install" | "default"; detectedDomain: string | null; digestEnabled: boolean; customChecklist: string[]; digestHour: number | null; digestTimezone: string | null; digestEmail: string | null; emailReady?: boolean; brandName: string | null; brandColor: string | null; brandLogoUrl?: string | null; detectedLogoUrl?: string | null; industryTargets?: boolean; keepTranscripts: boolean; pushNotesToCrm: boolean; speedTargetMinutes: number; countAutomatedTouches: boolean; speedBusinessHours: boolean; speedOpenHour: number; speedCloseHour: number; alertQuietHours: boolean; inboxAckGraceMinutes: number };

type Data = {
  features?: Record<string, boolean>; settings: S; slackConfigured: boolean; canDeleteData?: boolean; meetingTool?: boolean; kind?: string;
  clientView?: { on: number; total: number } | null; clientAccounts?: Array<{ locationId: string; name: string; on: boolean }>;
  permissions?: PermissionGroup[]; noteWriteGranted?: boolean | null; testAccounts?: Array<{ locationId: string; name: string; ignored: boolean; looksTest: boolean }>;
};

// Settings in sections with a menu on the left (N76, N89). One form, one Save button: a change made in one section is kept while you look at another, and the
// page says so when something is not saved yet. Which section opens is remembered in this browser; Getting started opens the right one with "Do it now".

/** `openSection` is set when an old address (#connections) asks for one section; the person can still pick another afterwards. */
/** `embedded` (the new Settings hub) draws only those old sections, without this page's own title and menu, and keeps one form across them. */
export function SettingsView({ openSection, embedded }: { openSection?: SectionId; embedded?: SectionId[] } = {}) {
  const api = useApiClient();
  const { data, error, loading, reload } = useData<Data>("settings");
  const keys = useData<{ keys: Array<{ id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null }>; max: number; endpoint: string }>("api-keys");
  const [keyName, setKeyName] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [override, setOverride] = useState("");
  const [form, setForm] = useState<S | null>(null);
  const [slack, setSlack] = useState("");
  const [checklist, setChecklist] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [digest, setDigest] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(() => openSection ?? remembered(SETTINGS_SECTION_KEY));
  // An old link to a page that moved into Settings asks for its section, also when Settings is already open.
  useEffect(() => {
    if (!openSection) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPicked(openSection);
    remember(SETTINGS_SECTION_KEY, openSection);
  }, [openSection]);
  // The answer the page held when Save was pressed: the form is filled again from the NEXT answer (the saved values as the server holds them), never from this one.
  const before = useRef<Data | null>(null);

  useEffect(() => {
    if (!data) return;
    if (!form || (before.current !== null && data !== before.current)) {
      // First load, and again after a save: copy the server's values into the editable form.
      before.current = null;
      setForm(data.settings);
      setChecklist(data.settings.customChecklist.join("\n"));
    }
  }, [data, form]);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data || !form) return null;

  const kind = data.kind === "business" ? "business" : "agency";
  const sections = sectionsFor(kind);
  const section: SectionId = embedded ? ("" as SectionId) : isSectionId(picked) && sections.some((s) => s.id === picked) ? picked : sections[0].id;
  const current = sections.find((s) => s.id === section)!;
  const choose = (id: SectionId) => { setPicked(id); remember(SETTINGS_SECTION_KEY, id); setMsg(null); };

  const num = (key: "staleDays" | "dormantDays" | "slaHours") => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: Number(e.target.value) });
  const dirty = JSON.stringify(form) !== JSON.stringify(data.settings) || slack.trim() !== "" || override.trim() !== "" || checklist.split("\n").map((l) => l.trim()).filter(Boolean).join("\n") !== data.settings.customChecklist.join("\n");

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const body: Record<string, unknown> = {
        staleDays: form.staleDays, dormantDays: form.dormantDays, slaHours: form.slaHours,
        digestEnabled: form.digestEnabled, digestHour: form.digestHour, digestTimezone: form.digestTimezone, digestEmail: form.digestEmail, brandName: form.brandName, brandColor: form.brandColor, brandLogoUrl: form.brandLogoUrl ?? null, keepTranscripts: form.keepTranscripts, pushNotesToCrm: form.pushNotesToCrm, speedTargetMinutes: form.speedTargetMinutes, countAutomatedTouches: form.countAutomatedTouches,
        alertQuietHours: form.alertQuietHours, speedBusinessHours: form.speedBusinessHours, speedOpenHour: form.speedOpenHour, speedCloseHour: form.speedCloseHour,
        customChecklist: checklist.split("\n").map((l) => l.trim()).filter(Boolean),
      };
      if (data.features?.inbox_breach_alert === true) body.inboxAckGraceMinutes = form.inboxAckGraceMinutes;
      if (slack.trim()) body.slackWebhookUrl = slack.trim();
      // The login address is found automatically. Only a typed one is sent, and it is an override.
      if (override.trim() && override.trim().toLowerCase() !== form.appDomain) body.appDomainOverride = override.trim();
      const changedNumber = NUMBER_SETTINGS.some((k) => form[k as keyof S] !== data.settings[k as keyof S]);
      await api.put("settings", body);
      setSlack("");
      setOverride("");
      before.current = data; // the form is read back from the answer that follows, so the page shows what the server holds
      await reload();
      setMsg({ ok: true, text: changedNumber ? "Saved. Your numbers and alerts have been recalculated." : "Saved." });
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

  const meetingsShown = data.features?.meetings !== false || data.meetingTool === true;
  const note = crmNoteState(data.noteWriteGranted ?? null, form.pushNotesToCrm);
  const saveBar = (
    <div className="flex flex-wrap items-center gap-3 border-t pt-4">
      <Btn variant="primary" disabled={busy || !dirty} onClick={save}>{busy ? "Saving..." : "Save settings"}</Btn>
      {dirty && <span className="text-sm text-muted-foreground" data-testid="unsaved">You have changes that are not saved yet. They are kept while you look at another section.</span>}
    </div>
  );

  return (
    <div className="max-w-5xl">
      {!embedded && <PageHeader title="Settings" subtitle="What counts as late, where alerts go, who can see what, and your data. Pick a section." />}
      {msg && <p className={`mb-4 border-l-2 py-1 pl-3 text-sm ${msg.ok ? "border-success" : "border-destructive"}`} role={msg.ok ? "status" : "alert"} data-testid="settings-message">{msg.text}</p>}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
        {!embedded && <nav aria-label="Settings sections" data-testid="settings-nav" className="flex max-w-full gap-1 overflow-x-auto border-b pb-2">
          {sections.map((s) => (
            <button key={s.id} type="button" onClick={() => choose(s.id)} aria-current={s.id === section ? "page" : undefined}
              className={`min-h-11 shrink-0 rounded-lg px-4 py-2 text-left text-[0.95rem] transition-colors ${s.id === section ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"}`}>{s.title}</button>
          ))}
        </nav>}

        <div className="min-w-0 space-y-4" data-testid={`section-${section}`}>
          {!embedded && section !== "sync" && <div><h2 className="text-lg font-semibold tracking-tight">{current.title}</h2><p className="text-sm text-muted-foreground">{current.hint}</p></div>}

          {(section === "team" || embedded?.includes("team")) && (
            <>
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
              {data.testAccounts && (
                <TestAccountsCard accounts={data.testAccounts} busy={busy}
                  onToggle={(a) => call(() => api.put(`accounts/${a.locationId}/flags`, { ignored: !a.ignored }), a.ignored ? `${a.name} counts again.` : `${a.name} is left out of every number.`)} />
              )}
              <WhoCanOpenCard agency={kind === "agency"} />
            </>
          )}

          {(section === "notifications" || embedded?.includes("notifications")) && (
            <Card title="Daily brief and alerts">
              <DailyBriefLine />
              <p className="mt-1 text-sm text-muted-foreground">Choose where each alert, the daily brief and the weekly summary go (the bell, email, one or more Slack channels), when, the quiet hours and the wording. It works without any setup.</p>
              <p className="mt-2"><a className="text-sm font-medium underline underline-offset-2" href="#notifications" data-testid="open-notifications">Open Notifications</a></p>
            </Card>
          )}

          {(section === "notifications" || embedded?.includes("notifications")) && (
            <Card title="Slack alerts and daily brief">
              <label className="mb-3 flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 size-4" checked={form.alertQuietHours} onChange={(e) => setForm({ ...form, alertQuietHours: e.target.checked })} /> <span>Quiet hours: warnings are emailed between 07:00 and 21:00 in your time zone, and wait for the morning otherwise. Critical alerts are always sent at once. Every email has a link to stop it.</span></label>
              <p className="mb-3 text-sm text-muted-foreground">
                New critical and warning alerts are posted to your Slack channel, and a weekly summary can go out on Mondays.
                {data.slackConfigured ? " A channel is saved (its address is never shown again)." : " Connect Slack under Integrations, or paste a Slack web address below."}
              </p>
              <label htmlFor="slack" className="mb-1 block text-sm font-medium">Or paste a Slack web address (advanced)</label>
              <input id="slack" className={inputClass} type="password" autoComplete="off" placeholder={data.slackConfigured ? "Saved. Paste a new URL to replace it" : "https://hooks.slack.com/services/..."} value={slack} onChange={(e) => setSlack(e.target.value)} />
              <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={form.digestEnabled} onChange={(e) => setForm({ ...form, digestEnabled: e.target.checked })} /> Send the daily brief to Slack</label>
              <div className="mt-3">
                <label htmlFor="digest-email" className="mb-1 block text-sm font-medium">Weekly email (Mondays)</label>
                <input id="digest-email" type="email" className={inputClass} placeholder="you@yourcompany.com" value={form.digestEmail ?? ""} onChange={(e) => setForm({ ...form, digestEmail: e.target.value.trim() || null })} />
                <p className="mt-1 text-xs text-muted-foreground">{data.settings.emailReady ? "One address. Sent Monday at the hour below, in your time zone." : "Saved now, but nothing is sent until an email service is connected to the app."}</p>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              <p className="mt-1 text-xs text-muted-foreground">Checked every hour and sent once a day at that hour in that time zone (the Monday email only on Mondays). If a check is late it still goes out within 3 hours of it; after that the day is skipped instead of sending a morning message in the evening. Left blank, it uses 08:00 in the time zone of your first client account.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Btn disabled={busy || !data.slackConfigured} onClick={() => call(() => api.post("settings/test-slack"), "Test message sent to Slack.")}>Send test message</Btn>
                <Btn onClick={async () => setDigest((await api.get<{ text: string }>("digest")).text)}>Preview the daily brief</Btn>
              </div>
              {digest && <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-xs">{digest}</pre>}
            </Card>
          )}

          {(section === "integrations" || embedded?.includes("integrations")) && (
            <>
              {data.features?.connections !== false && <ConnectionsSlot />}
              <PermissionsPanel groups={data.permissions} />
              <WriteAccessCard />
            </>
          )}

          {(section === "targets" || embedded?.includes("targets")) && (
            <>
              <Card title="Thresholds">
                <p className="mb-3 text-sm text-muted-foreground" data-testid="you-enter-this">You choose these numbers. SubSync does not read them from your CRM, and every count of late, stale and quiet uses the ones shown here.</p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div>
                    <label htmlFor="stale" className="mb-1 block text-sm font-medium">Stale deal after (days)</label>
                    <input id="stale" type="number" min={7} max={365} className={inputClass} value={form.staleDays} onChange={num("staleDays")} />
                    <p className="mt-1 text-xs text-muted-foreground">An open deal with no movement for this long is stale.</p>
                  </div>
                  <div>
                    <label htmlFor="dormant" className="mb-1 block text-sm font-medium">Gone quiet after (days)</label>
                    <input id="dormant" type="number" min={7} max={365} className={inputClass} value={form.dormantDays} onChange={num("dormantDays")} />
                    <p className="mt-1 text-xs text-muted-foreground">No new contacts, deal changes or messages for this long.</p>
                  </div>
                  <div>
                    <label htmlFor="sla" className="mb-1 block text-sm font-medium">Reply target (hours)</label>
                    <input id="sla" type="number" min={1} max={168} className={inputClass} value={form.slaHours} onChange={num("slaHours")} />
                    <p className="mt-1 text-xs text-muted-foreground">A customer message unanswered this long is late.</p>
                  </div>
                </div>
              </Card>
              <PipelineHistoryCard />
              <Card title="Speed to lead">
                <p className="mb-3 text-sm text-muted-foreground">How fast a new lead should hear from a person. A lead cools in minutes, so the target is short. SubSync does not send replies: it measures how long your team took. Messages from workflows and campaigns are not replies unless you say so.</p>
                <div className="flex flex-wrap items-end gap-4">
                  <div>
                    <label htmlFor="speed-target" className="mb-1 block text-sm font-medium">Reply target (minutes)</label>
                    <input id="speed-target" type="number" min={1} max={1440} className={`${inputClass} !w-32`} value={form.speedTargetMinutes} onChange={(e) => setForm({ ...form, speedTargetMinutes: Number(e.target.value) })} />
                  </div>
                  <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" className="size-4" checked={form.countAutomatedTouches} onChange={(e) => setForm({ ...form, countAutomatedTouches: e.target.checked })} /> Count automatic messages as a reply</label>
                  <p className="basis-full text-xs text-muted-foreground">Off by default: a text from a workflow or campaign is not a person replying, so the clock keeps running until your team answers.</p>
                </div>
                <div className="mt-4 flex flex-wrap items-end gap-4">
                  <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" className="size-4" checked={form.speedBusinessHours} onChange={(e) => setForm({ ...form, speedBusinessHours: e.target.checked })} /> Only count business hours</label>
                  <div>
                    <label htmlFor="speed-open" className="mb-1 block text-sm font-medium">Opens (hour)</label>
                    <input id="speed-open" type="number" min={0} max={23} className={`${inputClass} !w-24`} disabled={!form.speedBusinessHours} value={form.speedOpenHour} onChange={(e) => setForm({ ...form, speedOpenHour: Number(e.target.value) })} />
                  </div>
                  <div>
                    <label htmlFor="speed-close" className="mb-1 block text-sm font-medium">Closes (hour)</label>
                    <input id="speed-close" type="number" min={1} max={24} className={`${inputClass} !w-24`} disabled={!form.speedBusinessHours} value={form.speedCloseHour} onChange={(e) => setForm({ ...form, speedCloseHour: Number(e.target.value) })} />
                  </div>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">With this on, a lead that arrives when your team is closed (evenings, weekends) starts its reply clock at the next opening time in that account&apos;s own time zone, Monday to Friday. A lead that arrives during opening hours and is still unanswered at closing keeps counting overnight.</p>
              </Card>
              {data.features?.inbox_breach_alert === true && (
                <Card title="Unanswered alert escalation">
                  <label htmlFor="inbox-ack-grace" className="mb-1 block text-sm font-medium">Escalate an unread alert after (minutes)</label>
                  <input id="inbox-ack-grace" type="number" min={15} max={720} step={15} className={`${inputClass} !w-32`} value={form.inboxAckGraceMinutes} onChange={(e) => setForm({ ...form, inboxAckGraceMinutes: Number(e.target.value) })} />
                  <p className="mt-1 text-xs text-muted-foreground">If the assigned owner has not opened the 24-hour alert by then, notify the account admin. Default: 120 minutes.</p>
                </Card>
              )}
            </>
          )}

          {(section === "brand" || embedded?.includes("brand")) && (
            <Card title="Your name on reports">
              <p className="mb-3 text-sm text-muted-foreground">Replaces our name on every screen, in the browser tab, on printed client reports and quarterly reviews, in emails and on share links, so what you hand to a client carries your name, not ours.</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                <div className="sm:col-span-2">
                  <label htmlFor="brand-logo" className="mb-1 block text-sm font-medium">Logo web address</label>
                  <input id="brand-logo" type="url" inputMode="url" className={inputClass} maxLength={500} placeholder="https://example.com/logo.png" value={form.brandLogoUrl ?? ""} onChange={(e) => setForm({ ...form, brandLogoUrl: e.target.value.trim() || null })} data-testid="brand-logo" />
                  <p className="mt-1 text-xs text-muted-foreground">{form.brandLogoUrl ? "Starts with https://. Leave it empty to go back to the SubSync logo." : "Starts with https://. Leave it empty to show the SubSync logo. We never download it. Your browser loads it."}</p>
                </div>
              </div>
              <BrandPreview name={form.brandName} color={form.brandColor} logoUrl={form.brandLogoUrl ?? null} />
            </Card>
          )}

          {(section === "privacy" || embedded?.includes("privacy")) && (
            <>
              {meetingsShown && (
                <Card title="Meeting notes privacy">
                  <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 size-4" checked={form.keepTranscripts} onChange={(e) => setForm({ ...form, keepTranscripts: e.target.checked })} />
                    <span>Keep full transcripts when a meeting tool sends them. Off by default: only the summary and action items are stored, which is safer for clinics and anyone handling private conversations.</span></label>
                  <label className="mt-3 flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 size-4" checked={form.pushNotesToCrm && note.canEnable} disabled={!note.canEnable} onChange={(e) => setForm({ ...form, pushNotesToCrm: e.target.checked })} data-testid="push-notes" />
                    <span>Also add each meeting to the matched contact&apos;s notes in your CRM.</span></label>
                  <p className={`mt-2 text-xs ${note.tone === "needs_permission" ? "font-medium text-warning" : "text-muted-foreground"}`} data-testid="push-notes-state">{note.text}</p>
                  <p className="mt-2 text-xs text-muted-foreground">You are responsible for telling people in a meeting that it is recorded and for having their consent. Summaries can hold private details, so keep transcripts off unless you need them.</p>
                </Card>
              )}
              <Card title="What we store">
                <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground" data-testid="what-we-store">
                  {storeLines({ meetings: meetingsShown }).map((l) => <li key={l.id}><strong className="font-medium text-foreground">{l.title}:</strong> {l.text}</li>)}
                </ul>
                <p className="mt-3 text-xs text-muted-foreground">{uninstallText()}</p>
                <p className="mt-2 text-sm">Why each permission is asked, which outside services handle data and how we keep it safe: <a className="underline underline-offset-4" href="/trust" target="_blank" rel="noreferrer">the Trust page</a>.</p>
              </Card>
              <Card title="Delete my data">
                <p className="mb-3 text-sm text-muted-foreground">{deleteMyDataText()}</p>
                <div className="flex flex-wrap gap-2">
                  <input className={`${inputClass} max-w-48`} placeholder="Type DELETE" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} aria-label="Type DELETE to confirm" disabled={!data.canDeleteData} />
                  <Btn disabled={busy || confirmText !== "DELETE" || api.demo || !data.canDeleteData} onClick={() => call(async () => { await api.post("settings/purge", { confirm: "DELETE" }); setConfirmText(""); }, "All synced data deleted.")}>Delete all synced data</Btn>
                </div>
                {!data.canDeleteData && !api.demo && <p className="mt-2 text-xs text-muted-foreground">Only the owner of your company account can delete all the data. Ask them to do it. The attempt is written to the activity record.</p>}
                {api.demo && <p className="mt-2 text-xs text-muted-foreground">Disabled in demo mode.</p>}
              </Card>
            </>
          )}

          {(section === "sync" || embedded?.includes("sync")) && (
            <>
              <WatchingSlot />
              <SyncStatusPanel />
            </>
          )}

          {(section === "advanced" || embedded?.includes("advanced")) && (
            <>
              <Card title="Links">
                <p className="text-sm">&quot;Open&quot; links go to <strong>{data.settings.appDomain}</strong>.</p>
                <p className="mt-1 text-xs text-muted-foreground" data-testid="domain-source">
                  {data.settings.appDomainSource === "manual" ? "You set this address yourself below."
                    : data.settings.appDomainSource === "default" ? "SubSync has not seen your own login address yet, so links use the standard one. Open SubSync from your CRM menu once and it fills in by itself."
                    : "SubSync found this address by itself when you opened it from your CRM. You do not need to do anything."}
                </p>
                <label htmlFor="domain" className="mb-1 mt-3 block text-sm font-medium">Use a different address (only if the links above are wrong)</label>
                <input id="domain" className={inputClass} placeholder="app.youragency.com" value={override} onChange={(e) => setOverride(e.target.value)} />
                {data.settings.appDomainSource === "manual" && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Btn disabled={busy} onClick={() => call(() => api.put("settings", { appDomainOverride: null }), data.settings.detectedDomain ? "Links use the address SubSync found." : "Links use the standard address until SubSync sees yours.")}>Stop using my address</Btn>
                    {data.settings.detectedDomain && <span className="text-xs text-muted-foreground">SubSync found {data.settings.detectedDomain}.</span>}
                  </div>
                )}
              </Card>

              <Card title="Onboarding checklist">
                <label htmlFor="custom" className="mb-1 block text-sm font-medium">Your own steps (one per line, up to 10)</label>
                <textarea id="custom" rows={4} className={inputClass} value={checklist} onChange={(e) => setChecklist(e.target.value)} placeholder={"Send welcome gift\nCollect testimonial"} />
                <p className="mt-1 text-xs text-muted-foreground">These appear on every account&apos;s checklist next to the automatic checks.</p>
              </Card>

              {data.features?.ai !== false && (
                <Card title="AI assistant connector">
                  <p className="mb-3 text-sm text-muted-foreground">
                    Let Claude, ChatGPT or any assistant that supports MCP answer questions about all your clients at once, for example
                    &quot;which accounts are at risk this week?&quot; or &quot;find John Smith across my clients&quot;. Access is read-only and limited to your company&apos;s accounts.
                  </p>
                  {keys.error?.status === 402 ? (
                    <p className="border-l-2 border-primary py-1 pl-3 text-sm">The AI connector is part of the paid plan.</p>
                  ) : (
                    <>
                      {keys.data && (
                        <dl className="mb-3 space-y-1 text-sm">
                          <div className="flex flex-wrap gap-x-2"><dt className="text-muted-foreground">Server address:</dt><dd><code className="rounded bg-muted px-1.5 py-0.5 text-xs">{keys.data.endpoint}</code></dd></div>
                          <div className="flex flex-wrap gap-x-2"><dt className="text-muted-foreground">Authentication:</dt><dd>send your key as <code className="rounded bg-muted px-1.5 py-0.5 text-xs">Authorization: Bearer &lt;key&gt;</code></dd></div>
                        </dl>
                      )}
                      {newKey && (
                        <div className="mb-3 border-l-2 border-success py-1 pl-3 text-sm" role="status">
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

              <SettingsHistoryCard />
            </>
          )}

          {(embedded ? embedded.length > 0 && dirty : (section === "team" || section === "integrations" ? dirty : section !== "sync")) && saveBar}
        </div>
      </div>
    </div>
  );
}
