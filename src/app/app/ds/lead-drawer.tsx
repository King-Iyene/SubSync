"use client";

import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, ExternalLink, Maximize2, Minimize2, MoreHorizontal, ShieldCheck, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { tagColor } from "@/lib/people/tag-colors";
import type { PersonDetail } from "@/lib/analytics/people-person-queries";
import { isEditableTarget, neighbours } from "@/lib/design/ui-logic";
import { draftKey, getDraft } from "@/lib/design/drafts";
import { withLive } from "@/lib/people/person";
import { useApiClient, useData } from "../session";
import { LeadAiSummary } from "./ai-lead";
import { fmtMoney, timeAgo } from "../ui";
import { ActionStrip, dialNoteText, useContactActions, type ActionPerson } from "./contact-actions";
import { HeldNote } from "./held";
import { TimelinePanel } from "./timeline-panel";
import { Fold } from "./fold";
import { RecordTab } from "./wb/record-tab";
import { LiveBadge, LiveExtras, useLiveLead } from "./live-lead";
import { AppointmentsTab } from "./wb/appointments-tab";
import { InfoTip } from "./info-tip";
import { TagsSection } from "./tags-section";
import { LogCall, UndoButton } from "./lead-parts";
import { PopMenu } from "./pop-menu";
import { ErrorState, PanelBoundary, SkeletonRows } from "./states";
import { Composer, Thread } from "./wb/conversation";
import { DealsTab } from "./wb/deals-tab";
import { ReviewSheet, useRunner } from "./wb/runner";
import type { WbContext } from "./wb/types";
import { UpdateTab } from "./wb/update-tab";
import { bestName } from "@/lib/people/names";

// One panel for any lead, opened from any list or chart (N50). It answers four questions in this order: who is this and what should I do (one sentence and one button), how do I
// reach them (Call and Email open the CRM through the white-label link, with a warning first if they asked not to be contacted), what is the history (tags with the day SubSync first
// saw each, deals, a timeline of messages, calls, appointments, deal moves and tag changes), and what changed since I last looked. It is a read-only panel: SubSync places no call, sends
// no message and writes nothing to the CRM (logging a call and the note are SubSync's own). Arrows (or the keys j and k, or the left and right arrows) step to the previous and next
// person of the list it was opened from. Slots are filled where the data exists and left out where it does not (no empty boxes, no invented values).
export type LeadSeed = {
  contactId: string; locationId: string; name: string;
  /** What the list already knew, shown at once while the rest loads. */
  locationName?: string | null; phone?: string | null; email?: string | null; owner?: string | null; unassigned?: boolean; url?: string; note?: string;
  /** One line shown only until the person has loaded (the reason they are on a list); the headline replaces it, so it is not said twice. */
  pending?: string;
  /** Asked not to be contacted, and the account's time zone: used for the warning before a call. */
  dnd?: boolean; timeZone?: string | null;
  /** Which work tab opens first (the Deals tab from the pipeline), and the deal to highlight there. */
  tab?: "conversation" | "update" | "deals"; dealId?: string;
  /** Opened from a Reply button: the Conversation tab opens with the message box open and focused. */
  reply?: boolean;
};
type Tab = "conversation" | "update" | "deals" | "appointments" | "record" | "timeline";

// The live read of the CRM for one lead (custom fields, calls, messages), which is slower than SubSync's own copy and arrives after it.
type Live = {
  ownerName: string; owner: string | null; timeZone: string | null; dnd: boolean;
  live: { state: "ok" | "needs_permission" | "unavailable" | "off"; customFields: Array<{ name: string; value: string }>; calls: Array<{ at: string; direction: string | null; result: string; by: string | null }>; messages: Array<{ at: string; direction: string | null; channel: string; by: string | null }>; note: string | null };
};
type Person = Omit<PersonDetail, "conversationId"> & { ownerName: string; url: string; lastSeenAt: string | null; changed: { count: number; titles: string[]; line: string } | null; now: number };

const dayOf = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex gap-3 py-1.5 text-sm"><dt className="w-24 shrink-0 text-muted-foreground">{label}</dt><dd className="min-w-0 break-words">{children}</dd></div>;
}
const H3 = ({ children }: { children: ReactNode }) => <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</h3>;
const BUTTON = "ds-press inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md border bg-card px-3.5 text-sm font-medium hover:bg-accent focus-visible:outline-2 focus-visible:outline-[var(--ring)] sm:min-h-9";
const PRIMARY = "ds-press inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-[var(--ring)] sm:min-h-9";

function Body({ seed, top, showAccount, wide, onLogged }: { seed: LeadSeed; top?: ReactNode; showAccount: boolean; wide: boolean; onLogged: (label: string, message?: string, id?: string) => void }) {
  const api = useApiClient();
  const path = `${encodeURIComponent(seed.locationId)}/${encodeURIComponent(seed.contactId)}`;
  const person = useData<Person>(`people/person/${path}`);
  const extraQ = useData<Live>(`people/contact/${path}`);
  const extra = extraQ.data;
  const actions = useContactActions();
  const wbq = useData<WbContext>(`workbench/context?locationId=${encodeURIComponent(seed.locationId)}&contactId=${encodeURIComponent(seed.contactId)}`);
  const wb = wbq.data;
  const [tab, setTab] = useState<Tab>(seed.tab ?? "conversation");
  const [threadKey, setThreadKey] = useState(0);
  const [channelPref, setChannelPref] = useState<"SMS" | "Email">("SMS");
  // The message box opens by itself when this person has an unsent draft, so the words are never hidden behind "Write a message".
  const [composerOpen, setComposerOpen] = useState(!!seed.reply || !!getDraft(draftKey(seed.locationId, seed.contactId)));
  // Re-reading the panel's parts after a change. A re-read never starts while one is still on its way (a new one would cancel the old answer, so a slow CRM would starve the panel
  // of any answer at all); one more follows when something changed meanwhile. The message box is never part of this: it is not remounted, so a draft is never lost.
  const refreshing = useRef(false), again = useRef(false);
  const reloadRef = useRef<() => Promise<unknown>[]>(() => []);
  useEffect(() => { reloadRef.current = () => [wbq.reload(), person.reload(), extraQ.reload()]; });
  const refresh = useRef(() => {
    if (refreshing.current) { again.current = true; return; }
    refreshing.current = true;
    setThreadKey((k) => k + 1);
    void Promise.allSettled(reloadRef.current()).finally(() => { refreshing.current = false; if (again.current) { again.current = false; refresh.current(); } });
  });
  const runner = useRunner(seed.locationId, seed.contactId, () => { setThreadKey((k) => k + 1); void wbq.reload(); void person.reload(); });
  const data = person.data;
  const c = data?.contact;
  // Opens the Update tab, brings one block into view and puts the cursor in its first field.
  const goUpdate = (block: string, field: string) => {
    setTab("update");
    let tries = 0;
    const tick = () => { const el = document.querySelector<HTMLElement>(`[data-testid="${block}"]`); if (el) { el.scrollIntoView({ block: "center" }); el.querySelector<HTMLElement>(field)?.focus({ preventScroll: true }); } else if (tries++ < 20) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  };
  // Live read-through: the CRM is asked right away and every few seconds; when something changed the copy-based parts are reloaded (the copy was updated by that read).
  const { live, stopped } = useLiveLead(seed.locationId, seed.contactId, () => refresh.current());

  // Opening a person is remembered for them alone ("Recently opened", "what changed since you last looked"). It is only recorded once the panel has really shown them.
  const seen = useRef(false);
  useEffect(() => { if (data && !seen.current) { seen.current = true; void api.put("people/seen", { locationId: seed.locationId, contactId: seed.contactId }).catch(() => undefined); } }, [data, api, seed.locationId, seed.contactId]);

  const phone = c?.phone ?? seed.phone ?? null;
  const email = c?.email ?? seed.email ?? null;
  const dnd = c?.dnd ?? extra?.dnd ?? seed.dnd ?? false;
  const url = data?.url ?? seed.url ?? "";
  const name = bestName(c?.name, seed.name, phone, email);
  const owner = seed.unassigned ? "No owner" : c ? (c.owner ? data!.ownerName : "No owner") : seed.owner ?? null;
  const ap: ActionPerson = useMemo(() => ({ key: "panel", name, phone, email, dnd, timeZone: extra?.timeZone ?? c?.timeZone ?? seed.timeZone ?? null, url, locationName: c?.locationName ?? seed.locationName ?? null, ownerName: owner, why: seed.note ?? seed.pending ?? null }), [name, phone, email, dnd, extra, c, seed, url, owner]);
  const timeline = useMemo(() => withLive(data?.timeline ?? [], extra?.live ?? null), [data, extra]);

  const tone = data?.headline.tone;
  const tlNote = extra && extra.live.state !== "off" ? extra.live.note : null;
  const tz = extra?.timeZone ?? c?.timeZone ?? seed.timeZone ?? null;
  return (
    <div className={wide ? "grid grid-cols-[minmax(0,1fr)_380px] items-start gap-6" : ""}>
    <div className="min-w-0">
      <div className="min-w-0">
        <h2 className="truncate text-lg font-semibold" data-testid="drawer-name">{name}</h2>
        {(showAccount || !c) && <p className="truncate text-sm text-muted-foreground">{c?.locationName ?? seed.locationName ?? ""}</p>}
      </div>

      <LiveBadge live={live} stopped={stopped} />
      {data ? (
        <div className="mt-3" data-testid="drawer-headline" data-tone={tone}>
          <p className={`text-base font-medium leading-snug ${tone === "stop" ? "text-destructive" : ""}`}>{data.headline.line}</p>
          {data.headline.next && <p className="mt-0.5 text-sm text-muted-foreground">{data.headline.next}</p>}
        </div>
      ) : dnd ? <p className="mt-3 text-base font-medium text-destructive" data-testid="drawer-headline">Asked not to be contacted. Do not call or message this person.</p> : null}
      {seed.note && <p className="mt-2 text-sm text-muted-foreground" data-testid="drawer-why">{seed.note}</p>}
      {!data && seed.pending && <p className="mt-2 text-sm text-muted-foreground" data-testid="drawer-pending">{seed.pending}</p>}
      {top}
      <LeadAiSummary locationId={seed.locationId} contactId={seed.contactId} dnd={dnd} />
      <LiveExtras live={live} />
      {data?.changed && <p className="mt-2 text-xs text-muted-foreground" data-testid="drawer-changed">{data.changed.line}</p>}

      {person.error && person.error.status === 404 && <p className="mt-4 text-sm text-muted-foreground" data-testid="drawer-not-copied">SubSync has not copied this contact yet, so its history is not shown. Open them in your CRM to work on them.</p>}
      {person.error && person.error.status !== 404 && <div className="mt-5"><ErrorState error={person.error} onRetry={person.reload} /></div>}

      <HeldNote locationId={seed.locationId} contactId={seed.contactId} name={name} />
      <div className="mt-4 flex flex-wrap items-center gap-2" data-testid="drawer-actions">
        <button type="button" onClick={() => actions.call(ap)} disabled={!phone} className={dnd ? BUTTON : PRIMARY} data-testid="drawer-call">Call{url ? <ExternalLink aria-hidden className="size-3.5" /> : null}</button>
        <button type="button" onClick={() => { setChannelPref("SMS"); setComposerOpen(true); setTab("conversation"); }} disabled={!phone || dnd} title={dnd ? "Asked not to be contacted" : !phone ? "This contact has no phone number" : undefined} className={BUTTON} data-testid="drawer-message">Text</button>
        <button type="button" onClick={() => { setChannelPref("Email"); setComposerOpen(true); setTab("conversation"); }} disabled={!email || dnd} title={dnd ? "Asked not to be contacted" : email ? undefined : "This contact has no email address"} aria-describedby={email ? undefined : "drawer-email-why"} className={BUTTON} data-testid="drawer-email">Email</button>
        <PopMenu label={`More for ${name}`} testId="drawer-more" triggerClassName="ds-press inline-flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-[var(--ring)] sm:size-9"
          items={[
            // Writes go through the same preview-and-confirm sheet as the Update tab (dry-run when writes are off); note, task, tag and owner open the Update tab at that block instead of repeating it.
            ...(wb ? [
              { key: "note", label: "Add note", onSelect: () => goUpdate("wb-note", "textarea") },
              { key: "task", label: "Create task", onSelect: () => goUpdate("wb-task", "input") },
              { key: "tag", label: "Add tag", onSelect: () => goUpdate("wb-tags", "input") },
              { key: "owner", label: "Change owner", onSelect: () => goUpdate("wb-owner", "select") },
              dnd
                ? { key: "dnd", label: "Allow contact again", hint: "Only if they agreed to be contacted", onSelect: () => void runner.preview({ kind: "dnd", on: false }, { verb: "Allow contact", quote: `${name} asked not to be contacted. Only continue if they have told you it is fine again.` }) }
                : { key: "dnd", label: "Mark do not disturb", hint: "They asked not to be contacted", onSelect: () => void runner.preview({ kind: "dnd", on: true }, { verb: "Mark do not disturb", quote: `Only do this if ${name} asked not to be contacted. SubSync will then block calls, texts and emails to them.` }) },
            ] : []),
            { key: "copy", label: actions.copied === "panel" ? "Copied" : "Copy details", onSelect: () => void actions.copy(ap, showAccount) },
            ...(url ? [{ key: "crm", label: "Open in your CRM", onSelect: () => { window.open(url, "_blank", "noopener,noreferrer"); } }] : []),
            ...(wb?.canDelete ? [{ key: "delete", label: "Delete contact", danger: true, hint: "You will type their name to confirm", onSelect: () => void runner.preview({ kind: "delete", confirmText: "" }, { verb: "Delete forever", typeName: wb.name }) }] : []),
          ]}><MoreHorizontal aria-hidden className="size-4" /></PopMenu>
      </div>
      {(!email || !phone) && <p id="drawer-email-why" className="mt-2 text-xs text-muted-foreground" data-testid="drawer-no-contact-way">{!email && !phone ? "This contact has no email address and no phone number in your CRM." : !email ? "Email is off because this contact has no email address in your CRM." : "Call and Text are off because this contact has no phone number in your CRM."}</p>}
      <ActionStrip actions={actions} k="panel" className="mt-2" />
      {c && data && <Fold id="tags" title="Tags" bare className="mt-4"><TagsSection key={seed.contactId} locationId={seed.locationId} contactId={seed.contactId} name={name} tags={c.tags} tagDates={data.tagDates} tagExact={data.tagExact ?? {}} /></Fold>}
      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1"><InfoTip label="About Call and Email" text={dialNoteText(actions.provider)} /></div>
      {person.loading && !data && <div className="mt-5"><SkeletonRows rows={4} label="Loading this person..." /></div>}

      {wb && (
        <section className="mt-5" aria-label="Work on this person" data-testid="wb-work">
          {!wb.mode.live && <p className="mb-3 flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground" data-testid="wb-mode"><ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0" />{wb.mode.demo ? "Demo: try everything, nothing is ever sent." : wb.mode.masterOn ? "Changes from SubSync are not allowed for this account yet (Settings). You can try everything: nothing reaches your CRM." : "Changes from SubSync are switched off. You can try everything: it shows what would happen and nothing reaches your CRM."}</p>}
          <div role="tablist" aria-label="What to do" className={`grid ${wide ? "grid-cols-5" : "grid-cols-6"} gap-1 rounded-xl bg-muted p-1`}>
            {([["conversation", "Conversation"], ["update", "Update"], ["deals", wb.deals.length ? `Deals (${wb.deals.length})` : "Deals"], ["appointments", wb.appointments.length ? `Appointments (${wb.appointments.length})` : "Appointments"], ["record", "Record"], ...(wide ? [] : [["timeline", "Timeline"] as const])] as const).map(([k, l]) => (
              <button key={k} type="button" role="tab" id={`wb-tab-${k}`} aria-selected={tab === k} aria-controls="wb-panel" onClick={() => setTab(k)} className={`min-h-10 cursor-pointer rounded-lg px-3.5 text-[15px] font-medium ${tab === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`} data-testid={`wb-tab-${k}`}>{l}</button>
            ))}
          </div>
          <div role="tabpanel" id="wb-panel" aria-labelledby={`wb-tab-${tab}`} className="pt-5">
            {tab === "conversation" && <><Thread locationId={seed.locationId} contactId={seed.contactId} reloadKey={threadKey} crmUrl={wb.crmUrl ?? url} /><Composer ctx={wb} runner={runner} initial={channelPref} open={composerOpen} onOpenChange={setComposerOpen} focusOnMount={!!seed.reply} draftKey={draftKey(seed.locationId, seed.contactId)} lead={{ locationId: seed.locationId, contactId: seed.contactId }} /></>}
            {tab === "update" && <UpdateTab ctx={wb} runner={runner} />}
            {tab === "timeline" && data && <TimelinePanel items={timeline} timeZone={tz} note={tlNote} className="max-h-[70vh]" />}
            {tab === "record" && <RecordTab locationId={seed.locationId} contactId={seed.contactId} name={name} account={c?.locationName ?? seed.locationName ?? null} fields={extra?.live.customFields ?? []} />}
            {tab === "appointments" && <AppointmentsTab ctx={wb} crmUrl={wb.crmUrl ?? url} runner={runner} locationId={seed.locationId} onChanged={() => { setThreadKey((k) => k + 1); void wbq.reload(); void person.reload(); }} />}
            {tab === "deals" && <DealsTab ctx={wb} runner={runner} focusId={seed.dealId ?? null} contactId={seed.contactId} locationId={seed.locationId} />}
          </div>
        </section>
      )}
      {wbq.error && wbq.error.status !== 404 && <p className="mt-4 text-sm text-muted-foreground">The workbench could not be loaded. <button type="button" className="font-medium underline" onClick={() => void wbq.reload()}>Try again</button></p>}

      <Fold id="about" title="About this person" className="mt-6">
      <dl className="divide-y border-y">
        {phone && <Row label="Phone"><span className="tabular-nums">{phone}</span></Row>}
        {email && <Row label="Email"><span className="break-all">{email}</span></Row>}
        {wb ? (
          <Row label="Owner"><select aria-label="Owner" value={wb.ownerId ?? ""} disabled={runner.busy || wb.users.length === 0} onChange={(e) => { if (e.target.value && e.target.value !== wb.ownerId) void runner.preview({ kind: "owner", userId: e.target.value }, { verb: "Change owner" }); }} className="h-9 max-w-full rounded-md border bg-card px-2 text-sm" data-testid="drawer-owner-select"><option value="" disabled={!!wb.ownerId}>Unassigned</option>{wb.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>{wb.usersNeedPermission && <p className="mt-1 text-xs text-muted-foreground" data-testid="drawer-owner-hint">Allow reading team members to pick owners.</p>}</Row>
        ) : owner ? <Row label="Owner">{owner}</Row> : null}
        {c && <Row label="Source">{c.source ?? "Not recorded"}</Row>}
        {c && <Row label="Last activity">{c.lastActivityAt ? timeAgo(c.lastActivityAt) : "None recorded"}</Row>}
      </dl>
      </Fold>


      {data && data.deals.length > 0 && (
        <section className="mt-5" aria-label="Deals">
          <H3>Deals</H3>
          <ul className="divide-y rounded-lg border text-sm">
            {data.deals.slice(0, 8).map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0 truncate">{d.name ?? "Untitled deal"}{d.stage && <span style={stageStyle(d.stage)} className="tag-pill ml-2 inline-block rounded-full px-2 py-0.5 text-xs font-semibold" data-testid="deal-stage">{d.stage}</span>}<span className="text-muted-foreground">{d.stale ? " · no movement" : ""}</span></span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{d.status === "open" ? fmtMoney(d.value) : d.status}</span>
              </li>
            ))}
          </ul>
        </section>
      )}


      {phone && !dnd && c && <LogCall locationId={seed.locationId} contactId={seed.contactId} onLogged={onLogged} />}

      {wb && <div className="sticky bottom-0 z-10 -mx-5 -mb-5 mt-6"><ReviewSheet r={runner} name={name} /></div>}
      {url && <p className="mt-6 text-xs"><a href={url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground underline underline-offset-4 hover:text-foreground">Open in your CRM</a></p>}
    </div>
    {wide && data && <div className="sticky top-0 h-[calc(100vh-7rem)]"><TimelinePanel items={timeline} timeZone={tz} note={tlNote} className="h-full" /></div>}
    </div>
  );
}

const stageStyle = (name: string): CSSProperties => { const c = tagColor(name); return { "--tg-bg-l": c.light.bg, "--tg-fg-l": c.light.fg, "--tg-bg-d": c.dark.bg, "--tg-fg-d": c.dark.fg } as CSSProperties; };
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

export function LeadDrawer({ leads, index, onIndex, onClose, top, showAccount = true, onLogged, above = false }: {
  leads: readonly LeadSeed[]; index: number | null; onIndex: (i: number) => void; onClose: () => void;
  /** A call was logged from the panel (the list behind it may now have moved: refresh it when the panel closes). */
  onLogged?: () => void;
  /** Extra block shown right under the headline (for example the appointment a lead was opened from). */
  top?: (seed: LeadSeed, index: number) => ReactNode;
  /** Whether to say which client account the person belongs to (a single account does not need it). */
  showAccount?: boolean;
  /** Opened from inside another side panel: sit above it instead of beside it. */
  above?: boolean;
}) {
  const close = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [said, setSaid] = useState("");
  // Wide by default; the person can make it extra wide, and the choice is remembered for them (private windows just forget it).
  const [wide, setWide] = useState(false);
  useEffect(() => { try { setWide(localStorage.getItem("subsync.panelWide") === "1"); } catch { /* not available */ } }, []);
  const toggleWide = () => { setWide((w) => { try { localStorage.setItem("subsync.panelWide", w ? "0" : "1"); } catch { /* not available */ } return !w; }); };
  // What was just written to the CRM stays on screen after the panel moves to the next person, with Undo.
  const [saved, setSaved] = useState<{ text: string; id: string | null } | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);
  const api = useApiClient();
  const open = index !== null && index >= 0 && index < leads.length;
  const count = leads.length;
  const at = index ?? -1;

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    close.current?.focus();
    return () => { opener.current?.focus?.(); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = isEditableTarget(el) || e.isComposing;
      if (e.key === "Escape") { e.stopPropagation(); onClose(); return; } // stop here: a panel underneath must not also close on the same key
      if (e.key === "Tab" && box.current) {
        const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
        if (items.length === 0) return;
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        return;
      }
      // The panel is a dialog, so its keys only work while it is open: left and right (or k and j) step through the list, and never while typing or with a menu open.
      if (typing || e.metaKey || e.ctrlKey || e.altKey || document.querySelector("[role=menu]")) return;
      if ((e.key === "ArrowRight" || e.key === "j") && at < count - 1) { e.preventDefault(); onIndex(at + 1); }
      else if ((e.key === "ArrowLeft" || e.key === "k") && at > 0) { e.preventDefault(); onIndex(at - 1); }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [open, onClose, onIndex, at, count]);

  if (!open) return null;
  const nb = neighbours(at, count);
  const seed = leads[at];
  // After a call is logged the next person is already waiting: move on, and say so for a screen reader.
  const logged = (label: string, message?: string, id?: string) => {
    onLogged?.();
    if (message) setSaved({ text: `${label}: ${message}`, id: id ?? null });
    if (nb.next !== null) { setSaid(`Logged: ${label}. Next: ${leads[nb.next].name}.`); onIndex(nb.next); } else setSaid(`Logged: ${label}.`);
  };
  if (typeof document === "undefined") return null;
  // Rendered on document.body so the panel is the same on every screen (flush right, full height), whatever the page behind it does. It carries the shell's own theme class and
  // colour variables across, because those live on the shell element, not on the body.
  const shell = document.querySelector<HTMLElement>("[data-theme]");
  return createPortal(
    <div className={`${shell?.classList.contains("dark") ? "dark " : ""}fixed inset-0 ${above ? "z-[1100]" : "z-[90]"} print:hidden`} ref={(el) => { if (el && shell) el.style.cssText += shell.style.cssText; }} data-testid="lead-drawer-root">
      <div className="absolute inset-0 bg-black/45" onClick={onClose} aria-hidden />
      <aside ref={box} role="dialog" aria-modal="true" aria-label={`Lead: ${seed.name}`} className={`absolute inset-y-0 right-0 flex w-full flex-col border-l bg-popover text-popover-foreground shadow-[var(--shadow-lift)] transition-[width] ${wide ? "md:w-[min(92vw,1320px)]" : "md:w-[min(70vw,960px)]"}`} data-wide={wide} data-testid="lead-drawer">
        <header className="flex items-center justify-between gap-2 border-b px-4 py-2">
          <div className="flex items-center gap-1">
            <button type="button" aria-label="Previous lead" disabled={nb.prev === null} onClick={() => nb.prev !== null && onIndex(nb.prev)} className="inline-flex size-11 items-center justify-center rounded-lg hover:bg-muted disabled:opacity-35"><ChevronLeft aria-hidden className="size-5" /></button>
            <span className="min-w-14 text-center text-xs text-muted-foreground tabular-nums" data-testid="drawer-position">{at + 1} of {count}</span>
            <button type="button" aria-label="Next lead" disabled={nb.next === null} onClick={() => nb.next !== null && onIndex(nb.next)} className="inline-flex size-11 items-center justify-center rounded-lg hover:bg-muted disabled:opacity-35" data-testid="drawer-next"><ChevronRight aria-hidden className="size-5" /></button>
          </div>
          <div className="flex items-center gap-1"><button type="button" onClick={toggleWide} aria-label={wide ? "Make the panel narrower" : "Make the panel wider"} aria-pressed={wide} className="hidden size-11 cursor-pointer items-center justify-center rounded-lg hover:bg-muted md:inline-flex" data-testid="drawer-wide">{wide ? <Minimize2 aria-hidden className="size-4" /> : <Maximize2 aria-hidden className="size-4" />}</button><button ref={close} type="button" aria-label="Close" onClick={onClose} className="inline-flex size-11 items-center justify-center rounded-lg hover:bg-muted"><X aria-hidden className="size-5" /></button></div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <PanelBoundary key={seed.locationId + seed.contactId} onClose={onClose}><Body key={seed.locationId + seed.contactId + (seed.note ?? "")} seed={seed} top={top?.(seed, at)} showAccount={showAccount} wide={wide} onLogged={logged} /></PanelBoundary>
        </div>
        {saved && (
          <div className="flex items-center justify-between gap-2 border-t bg-card px-5 py-3 text-sm" role="status" data-testid="drawer-saved">
            <span>{saved.text}{saved.id && <UndoButton busy={undoBusy} testId="drawer-saved-undo" onConfirm={() => { setUndoBusy(true); void api.post<{ message: string }>("people/write-undo", { id: saved.id }).then((r) => setSaved({ text: r.message, id: null })).catch((e: Error) => setSaved({ text: e.message, id: null })).finally(() => setUndoBusy(false)); }} />}</span>
            <button type="button" className="min-h-9 cursor-pointer underline" onClick={() => setSaved(null)}>Dismiss</button>
          </div>
        )}
        <p className="sr-only" role="status" aria-live="polite">{said}</p>
      </aside>
    </div>,
    document.body,
  );
}
