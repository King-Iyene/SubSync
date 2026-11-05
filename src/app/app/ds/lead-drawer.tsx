"use client";

import { ChevronLeft, ChevronRight, MoreHorizontal, ShieldCheck, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PersonDetail } from "@/lib/analytics/people-person-queries";
import { neighbours } from "@/lib/design/ui-logic";
import { withLive } from "@/lib/people/person";
import { useApiClient, useData } from "../session";
import { fmtMoney, timeAgo } from "../ui";
import { ActionStrip, useContactActions, type ActionPerson } from "./contact-actions";
import { DialerSetting } from "./dial-button";
import { LogCall, NoteToSelf, Timeline } from "./lead-parts";
import { PopMenu } from "./pop-menu";
import { ErrorState, SkeletonRows } from "./states";
import { CallSheet } from "./wb/call-sheet";
import { Composer, Thread } from "./wb/conversation";
import { DealsTab } from "./wb/deals-tab";
import { ReviewSheet, useRunner } from "./wb/runner";
import type { WbContext } from "./wb/types";
import { UpdateTab } from "./wb/update-tab";

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
};
type Tab = "conversation" | "update" | "deals";

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

function Body({ seed, top, showAccount, onLogged }: { seed: LeadSeed; top?: ReactNode; showAccount: boolean; onLogged: (label: string) => void }) {
  const api = useApiClient();
  const path = `${encodeURIComponent(seed.locationId)}/${encodeURIComponent(seed.contactId)}`;
  const person = useData<Person>(`people/person/${path}`);
  const extra = useData<Live>(`people/contact/${path}`).data;
  const actions = useContactActions();
  const wbq = useData<WbContext>(`workbench/context?locationId=${encodeURIComponent(seed.locationId)}&contactId=${encodeURIComponent(seed.contactId)}`);
  const wb = wbq.data;
  const [tab, setTab] = useState<Tab>(seed.tab ?? "conversation");
  const [calling, setCalling] = useState(false);
  const [threadKey, setThreadKey] = useState(0);
  const [channelPref, setChannelPref] = useState<"SMS" | "Email">("SMS");
  const runner = useRunner(seed.locationId, seed.contactId, () => { setThreadKey((k) => k + 1); void wbq.reload(); void person.reload(); });
  const data = person.data;
  const c = data?.contact;

  // Opening a person is remembered for them alone ("Recently opened", "what changed since you last looked"). It is only recorded once the panel has really shown them.
  const seen = useRef(false);
  useEffect(() => { if (data && !seen.current) { seen.current = true; void api.put("people/seen", { locationId: seed.locationId, contactId: seed.contactId }).catch(() => undefined); } }, [data, api, seed.locationId, seed.contactId]);

  const phone = c?.phone ?? seed.phone ?? null;
  const email = c?.email ?? seed.email ?? null;
  const dnd = c?.dnd ?? extra?.dnd ?? seed.dnd ?? false;
  const url = data?.url ?? seed.url ?? "";
  const name = c?.name ?? seed.name;
  const owner = seed.unassigned ? "No owner" : c ? (c.owner ? data!.ownerName : "No owner") : seed.owner ?? null;
  const ap: ActionPerson = useMemo(() => ({ key: "panel", name, phone, email, dnd, timeZone: extra?.timeZone ?? c?.timeZone ?? seed.timeZone ?? null, url, locationName: c?.locationName ?? seed.locationName ?? null, ownerName: owner, why: seed.note ?? seed.pending ?? null }), [name, phone, email, dnd, extra, c, seed, url, owner]);
  const timeline = useMemo(() => withLive(data?.timeline ?? [], extra?.live ?? null), [data, extra]);

  const tone = data?.headline.tone;
  return (
    <>
      <div className="min-w-0">
        <h2 className="truncate text-lg font-semibold" data-testid="drawer-name">{name}</h2>
        {(showAccount || !c) && <p className="truncate text-sm text-muted-foreground">{c?.locationName ?? seed.locationName ?? ""}</p>}
      </div>

      {data ? (
        <div className="mt-3" data-testid="drawer-headline" data-tone={tone}>
          <p className={`text-base font-medium leading-snug ${tone === "stop" ? "text-destructive" : ""}`}>{data.headline.line}</p>
          {data.headline.next && <p className="mt-0.5 text-sm text-muted-foreground">{data.headline.next}</p>}
        </div>
      ) : dnd ? <p className="mt-3 text-base font-medium text-destructive" data-testid="drawer-headline">Asked not to be contacted. Do not call or message this person.</p> : null}
      {seed.note && <p className="mt-2 text-sm text-muted-foreground" data-testid="drawer-why">{seed.note}</p>}
      {!data && seed.pending && <p className="mt-2 text-sm text-muted-foreground" data-testid="drawer-pending">{seed.pending}</p>}
      {top}
      {data?.changed && <p className="mt-2 text-xs text-muted-foreground" data-testid="drawer-changed">{data.changed.line}</p>}

      {person.error && person.error.status === 404 && <p className="mt-4 text-sm text-muted-foreground" data-testid="drawer-not-copied">SubSync has not copied this contact yet, so its history is not shown. Open them in your CRM to work on them.</p>}
      {person.error && person.error.status !== 404 && <div className="mt-5"><ErrorState error={person.error} onRetry={person.reload} /></div>}

      <div className="mt-4 flex flex-wrap items-center gap-2" data-testid="drawer-actions">
        <button type="button" onClick={() => setCalling((v) => !v)} disabled={!phone} aria-expanded={calling} className={dnd ? BUTTON : PRIMARY} data-testid="drawer-call">Call</button>
        <button type="button" onClick={() => { setChannelPref("SMS"); setTab("conversation"); setCalling(false); }} disabled={!phone || dnd} className={BUTTON} data-testid="drawer-message">Text</button>
        <button type="button" onClick={() => { setChannelPref("Email"); setTab("conversation"); setCalling(false); }} disabled={!email || dnd} className={BUTTON} data-testid="drawer-email">Email</button>
        <PopMenu label={`More for ${name}`} testId="drawer-more" triggerClassName="ds-press inline-flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-[var(--ring)] sm:size-9"
          items={[
            { key: "copy", label: actions.copied === "panel" ? "Copied" : "Copy details", onSelect: () => void actions.copy(ap, showAccount) },
            ...(url ? [{ key: "crm", label: "Open in your CRM", onSelect: () => { window.open(url, "_blank", "noopener,noreferrer"); } }] : []),
          ]}><MoreHorizontal aria-hidden className="size-4" /></PopMenu>
      </div>
      {!calling && <ActionStrip actions={actions} k="panel" className="mt-2" />}
      {calling && phone && <CallSheet phone={phone} name={name} dnd={dnd} locationId={seed.locationId} contactId={seed.contactId} runner={runner} actions={actions} ap={ap} onClose={() => setCalling(false)} onLogged={onLogged} />}
      {person.loading && !data && <div className="mt-5"><SkeletonRows rows={4} label="Loading this person..." /></div>}

      {wb && (
        <section className="mt-5" aria-label="Work on this person" data-testid="wb-work">
          {!wb.mode.live && <p className="mb-3 flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground" data-testid="wb-mode"><ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0" />{wb.mode.demo ? "Demo: try everything, nothing is ever sent." : wb.mode.masterOn ? "Changes from SubSync are not allowed for this account yet (Settings). You can try everything: nothing reaches your CRM." : "Changes from SubSync are switched off. You can try everything: it shows what would happen and nothing reaches your CRM."}</p>}
          <div role="tablist" aria-label="What to do" className="flex gap-1 border-b">
            {([["conversation", "Conversation"], ["update", "Update"], ["deals", wb.deals.length ? `Deals (${wb.deals.length})` : "Deals"]] as const).map(([k, l]) => (
              <button key={k} type="button" role="tab" id={`wb-tab-${k}`} aria-selected={tab === k} aria-controls="wb-panel" onClick={() => setTab(k)} className={`-mb-px min-h-11 border-b-2 px-3.5 text-[15px] font-medium ${tab === k ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`} data-testid={`wb-tab-${k}`}>{l}</button>
            ))}
          </div>
          <div role="tabpanel" id="wb-panel" aria-labelledby={`wb-tab-${tab}`} className="pt-4">
            {tab === "conversation" && <><Thread locationId={seed.locationId} contactId={seed.contactId} reloadKey={threadKey} /><Composer key={channelPref} ctx={wb} runner={runner} initial={channelPref} /></>}
            {tab === "update" && <UpdateTab ctx={wb} runner={runner} />}
            {tab === "deals" && <DealsTab ctx={wb} runner={runner} focusId={seed.dealId ?? null} />}
          </div>
        </section>
      )}
      {wbq.error && wbq.error.status !== 404 && <p className="mt-4 text-sm text-muted-foreground">The workbench could not be loaded. <button type="button" className="font-medium underline" onClick={() => void wbq.reload()}>Try again</button></p>}

      <h3 className="mb-1 mt-8 text-xs font-semibold uppercase tracking-wide text-muted-foreground">About this person</h3>
      <dl className="divide-y border-y">
        {phone && <Row label="Phone"><span className="tabular-nums">{phone}</span></Row>}
        {email && <Row label="Email"><span className="break-all">{email}</span></Row>}
        {owner && <Row label="Owner">{owner}</Row>}
        {c && <Row label="Source">{c.source ?? "Not recorded"}</Row>}
        {c && <Row label="Last activity">{c.lastActivityAt ? timeAgo(c.lastActivityAt) : "None recorded"}</Row>}
      </dl>

      {c && c.tags.length > 0 && (
        <section className="mt-5" aria-label="Tags" data-testid="drawer-tags">
          <H3>Tags</H3>
          <ul className="flex flex-wrap gap-1.5">
            {c.tags.slice(0, 30).map((t) => (
              <li key={t} className="rounded border px-1.5 py-0.5 text-xs" data-testid="drawer-tag">
                <span className="font-medium">{t}</span>
                <span className="text-muted-foreground">{data!.tagDates[t] ? ` · added ${dayOf(data!.tagDates[t])}` : ""}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-xs text-muted-foreground" data-testid="drawer-tags-note">
            {data!.watchingSince
              ? `Your CRM does not say when a tag was added. A day is when SubSync first saw the tag, since it started watching on ${dayOf(data!.watchingSince)}. Older tags have no day.`
              : "Your CRM does not say when a tag was added. SubSync records the day from now on."}
          </p>
        </section>
      )}

      {data && data.deals.length > 0 && (
        <section className="mt-5" aria-label="Deals">
          <H3>Deals</H3>
          <ul className="divide-y rounded-lg border text-sm">
            {data.deals.slice(0, 8).map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0 truncate">{d.name ?? "Untitled deal"}<span className="text-muted-foreground">{d.stage ? ` · ${d.stage}` : ""}{d.stale ? " · no movement" : ""}</span></span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{d.status === "open" ? fmtMoney(d.value) : d.status}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {extra && extra.live.customFields.length > 0 && (
        <section className="mt-5" aria-label="Custom fields" data-testid="drawer-fields">
          <H3>Custom fields</H3>
          <dl className="divide-y border-y">{extra.live.customFields.map((f, i) => <Row key={i} label={f.name}>{f.value}</Row>)}</dl>
        </section>
      )}

      {phone && !dnd && c && <LogCall locationId={seed.locationId} contactId={seed.contactId} onLogged={onLogged} />}
      <NoteToSelf name={name} account={c?.locationName ?? seed.locationName ?? null} />
      <div className="mt-3"><DialerSetting /></div>

      {data && <Timeline items={timeline} nowMs={data.now} note={extra && extra.live.state !== "off" ? extra.live.note : null} />}
      {wb && <div className="sticky bottom-0 z-10 -mx-5 -mb-5 mt-6"><ReviewSheet r={runner} name={name} /></div>}
      {url && <p className="mt-6 text-xs"><a href={url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground underline underline-offset-4 hover:text-foreground">Open in your CRM</a></p>}
    </>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

export function LeadDrawer({ leads, index, onIndex, onClose, top, showAccount = true, onLogged }: {
  leads: readonly LeadSeed[]; index: number | null; onIndex: (i: number) => void; onClose: () => void;
  /** A call was logged from the panel (the list behind it may now have moved: refresh it when the panel closes). */
  onLogged?: () => void;
  /** Extra block shown right under the headline (for example the appointment a lead was opened from). */
  top?: (seed: LeadSeed, index: number) => ReactNode;
  /** Whether to say which client account the person belongs to (a single account does not need it). */
  showAccount?: boolean;
}) {
  const close = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [said, setSaid] = useState("");
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
      const typing = !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
      if (e.key === "Escape") { onClose(); return; }
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
  const logged = (label: string) => {
    onLogged?.();
    if (nb.next !== null) { setSaid(`Logged: ${label}. Next: ${leads[nb.next].name}.`); onIndex(nb.next); } else setSaid(`Logged: ${label}.`);
  };
  return (
    <div className="fixed inset-0 z-50 print:hidden" data-testid="lead-drawer-root">
      <div className="absolute inset-0 bg-black/45" onClick={onClose} aria-hidden />
      <aside ref={box} role="dialog" aria-modal="true" aria-label={`Lead: ${seed.name}`} className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l bg-popover text-popover-foreground shadow-[var(--shadow-lift)]" data-testid="lead-drawer">
        <header className="flex items-center justify-between gap-2 border-b px-4 py-2">
          <div className="flex items-center gap-1">
            <button type="button" aria-label="Previous lead" disabled={nb.prev === null} onClick={() => nb.prev !== null && onIndex(nb.prev)} className="inline-flex size-11 items-center justify-center rounded-lg hover:bg-muted disabled:opacity-35"><ChevronLeft aria-hidden className="size-5" /></button>
            <span className="min-w-14 text-center text-xs text-muted-foreground tabular-nums" data-testid="drawer-position">{at + 1} of {count}</span>
            <button type="button" aria-label="Next lead" disabled={nb.next === null} onClick={() => nb.next !== null && onIndex(nb.next)} className="inline-flex size-11 items-center justify-center rounded-lg hover:bg-muted disabled:opacity-35" data-testid="drawer-next"><ChevronRight aria-hidden className="size-5" /></button>
          </div>
          <button ref={close} type="button" aria-label="Close" onClick={onClose} className="inline-flex size-11 items-center justify-center rounded-lg hover:bg-muted"><X aria-hidden className="size-5" /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <Body key={seed.locationId + seed.contactId + (seed.note ?? "")} seed={seed} top={top?.(seed, at)} showAccount={showAccount} onLogged={logged} />
        </div>
        <p className="sr-only" role="status" aria-live="polite">{said}</p>
      </aside>
    </div>
  );
}
