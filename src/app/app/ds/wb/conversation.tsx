"use client";

import { ArrowDown, ChevronDown, ExternalLink, Mail, MessageCircle, MessageSquare, Phone, RefreshCw, SendHorizonal } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useData } from "../../session";
import { InfoTip } from "../info-tip";
import { INPUT, wbButtons, type Runner } from "./runner";
import type { WbContext, WbThread } from "./types";

// The conversation tab: the live thread (fetched when the panel opens, shown, never stored by SubSync) and the composer, docked under it. Sending goes through the review sheet and the server's gateway.

const CHANNELS = [["SMS", "Text"], ["Email", "Email"], ["WhatsApp", "WhatsApp"]] as const;
type Msg = WbThread["messages"][number];
const ICON: Record<string, typeof Phone> = { SMS: MessageSquare, Email: Mail, WhatsApp: MessageCircle, Call: Phone };
const LONG_LINES = 8;

const dayHead = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const dayKey = (iso: string) => new Date(iso).toDateString();

function Bubble({ m }: { m: Msg }) {
  const out = m.direction === "out";
  const long = m.text.split("\n").length > LONG_LINES || m.text.length > 600;
  const [more, setMore] = useState(false);
  const Icon = ICON[m.channel] ?? MessageSquare;
  return (
    <li className={`flex ${out ? "justify-end" : "justify-start"}`} data-testid="wb-message" data-dir={m.direction}>
      <div className={`max-w-[88%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed ${out ? "rounded-br-sm border border-primary/25 bg-primary/12" : "rounded-bl-sm border bg-card"}`}>
        {m.text
          ? <p className={`whitespace-pre-wrap break-words ${long && !more ? "line-clamp-8" : ""}`}>{m.text}</p>
          : <p className="italic text-muted-foreground">{m.channel === "Call" ? "A phone call" : "No text"}</p>}
        {long && <button type="button" onClick={() => setMore(!more)} className="mt-1 min-h-8 cursor-pointer text-xs font-semibold text-primary underline underline-offset-2" data-testid="wb-more">{more ? "Show less" : "Show more"}</button>}
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <Icon aria-hidden className="size-3.5" /><span>{m.channel === "SMS" ? "Text" : m.channel}</span><span aria-hidden>·</span><span className="tabular-nums">{clock(m.at)}</span>
          {m.by && <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-foreground/80">{m.by}</span>}
        </p>
      </div>
    </li>
  );
}

export function Thread({ locationId, contactId, reloadKey, crmUrl }: { locationId: string; contactId: string; reloadKey: number; crmUrl?: string }) {
  const t = useData<WbThread>(`workbench/thread?locationId=${encodeURIComponent(locationId)}&contactId=${encodeURIComponent(contactId)}&k=${reloadKey}`);
  const scroller = useRef<HTMLOListElement>(null);
  const [filter, setFilter] = useState<"all" | "SMS" | "Email" | "WhatsApp">("all");
  const [atEnd, setAtEnd] = useState(true);
  const all = t.data?.messages ?? [];
  const shown = useMemo(() => (filter === "all" ? all : all.filter((m) => m.channel === filter)), [all, filter]);
  const toEnd = (smooth = true) => { const el = scroller.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" }); };
  useEffect(() => { toEnd(false); }, [shown.length, filter]);
  const onScroll = () => { const el = scroller.current; if (el) setAtEnd(el.scrollHeight - el.scrollTop - el.clientHeight < 48); };
  const tabs: Array<["all" | "SMS" | "Email" | "WhatsApp", string]> = [["all", "All"], ...CHANNELS.map(([k, l]) => [k, l] as ["SMS" | "Email" | "WhatsApp", string])];
  return (
    <section aria-label="Conversation" data-testid="wb-thread" className="overflow-hidden rounded-xl border bg-card">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b bg-card px-3 py-2">
        <div role="tablist" aria-label="Channel" className="inline-flex rounded-lg bg-muted p-0.5">
          {tabs.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={filter === k} onClick={() => setFilter(k)} className={`min-h-8 cursor-pointer rounded-md px-2.5 text-sm font-medium ${filter === k ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`} data-testid={`wb-channel-${k}`}>{l}</button>)}
        </div>
        <div className="ml-auto flex items-center gap-1">
          {crmUrl && <a href={crmUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 cursor-pointer items-center gap-1 rounded-md px-2 text-sm font-medium text-primary hover:bg-accent" data-testid="wb-open-crm">Open in your CRM<ExternalLink aria-hidden className="size-3.5" /></a>}
          <button type="button" onClick={() => void t.reload()} className="inline-flex min-h-9 cursor-pointer items-center gap-1 rounded-md px-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Refresh the conversation"><RefreshCw aria-hidden className={`size-3.5 ${t.loading ? "animate-spin" : ""}`} />Refresh</button>
        </div>
      </div>
      <div className="relative">
        {t.loading && !t.data && (
          <div className="space-y-3 p-4" aria-label="Loading the conversation" data-testid="wb-thread-loading">
            {[["w-2/3", "justify-start"], ["w-1/2", "justify-end"], ["w-3/5", "justify-start"]].map(([w, j], i) => <div key={i} className={`flex ${j}`}><div className={`h-12 ${w} animate-pulse rounded-2xl bg-muted`} /></div>)}
          </div>
        )}
        {t.error && <p className="m-4 rounded-lg border border-destructive/40 p-3 text-[15px] text-destructive" role="alert">The conversation could not be loaded. <button type="button" className="cursor-pointer font-medium underline" onClick={() => void t.reload()}>Try again</button></p>}
        {t.data && all.length === 0 && <p className="m-4 rounded-xl border border-dashed p-5 text-center text-[15px] text-muted-foreground" data-testid="wb-thread-empty">{t.data.note ?? "No messages yet. Say hello below."}</p>}
        {t.data && all.length > 0 && shown.length === 0 && <p className="m-4 text-center text-sm text-muted-foreground">No messages on this channel.</p>}
        {shown.length > 0 && (
          <ol ref={scroller} onScroll={onScroll} tabIndex={0} aria-label="Messages" className="thin-scroll min-h-[55vh] max-h-[75vh] space-y-3 overflow-y-auto scroll-smooth px-4 py-4" data-testid="wb-messages">
            {shown.map((m, i) => (
              <li key={m.id} className="list-none">
                {(i === 0 || dayKey(shown[i - 1].at) !== dayKey(m.at)) && <p className="mb-3 mt-1 text-center" data-testid="wb-day"><span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">{dayHead(m.at)}</span></p>}
                <ul><Bubble m={m} /></ul>
              </li>
            ))}
          </ol>
        )}
        {shown.length > 0 && !atEnd && <button type="button" onClick={() => toEnd()} className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 cursor-pointer items-center gap-1 rounded-full border bg-popover px-3 py-1.5 text-xs font-semibold shadow-lg hover:bg-accent" data-testid="wb-jump"><ArrowDown aria-hidden className="size-3.5" />Jump to latest</button>}
      </div>
      {t.data && t.data.state !== "ok" && t.data.state !== "empty" && all.length === 0 && t.data.note && <p className="border-t px-4 py-2 text-sm text-muted-foreground">{t.data.note}</p>}
    </section>
  );
}

export function Composer({ ctx, runner, initial = "SMS", open = true, onOpenChange }: { ctx: WbContext; runner: Runner; initial?: "SMS" | "Email"; open?: boolean; onOpenChange?: (o: boolean) => void }) {
  const [channel, setChannel] = useState<"SMS" | "Email" | "WhatsApp">(initial === "SMS" && !ctx.phone ? "Email" : initial);
  const [text, setText] = useState("");
  const [subject, setSubject] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  const first = ctx.name.trim().split(/\s+/)[0] ?? "";
  const email = channel === "Email";
  const canUse = (c: string) => (c === "Email" ? !!ctx.email : !!ctx.phone);
  const insert = (v: string) => {
    const el = box.current; const at = el ? el.selectionStart : text.length;
    setText((t) => `${t.slice(0, at)}${v}${t.slice(at)}`);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + v.length, at + v.length); });
  };
  const applyTemplate = (id: string) => { const t = ctx.templates.find((x) => x.id === id); if (!t) return; setText(t.text); if (t.subject) setSubject(t.subject); };
  useEffect(() => { const el = box.current; if (el) { el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 224)}px`; } }, [text]);
  const sms = !email ? Math.max(1, Math.ceil(text.length / 160)) : 0;

  if (ctx.dnd) return <p className="mt-4 rounded-xl border border-destructive/50 p-3.5 text-[15px] font-medium text-destructive" data-testid="wb-dnd">{ctx.name} asked not to be contacted. SubSync will not send them anything.</p>;
  if (!open) {
    return (
      <div className="sticky bottom-0 z-10 mt-3 flex items-center gap-3 rounded-xl border bg-card px-3 py-2 shadow-[0_-8px_14px_-10px_rgb(0_0_0/0.3)]" data-testid="wb-composer-collapsed">
        <button type="button" onClick={() => onOpenChange?.(true)} className="flex min-h-10 flex-1 cursor-pointer items-center gap-2 text-left text-[15px] font-medium text-muted-foreground hover:text-foreground" data-testid="wb-composer-open"><SendHorizonal aria-hidden className="size-4" />Write a message</button>
        <span className="inline-flex items-center gap-2 text-muted-foreground" aria-label="Text, Email and WhatsApp"><MessageSquare aria-hidden className="size-4" /><Mail aria-hidden className="size-4" /><MessageCircle aria-hidden className="size-4" /></span>
      </div>
    );
  }
  return (
    <form className="sticky bottom-0 z-10 mt-3 space-y-2.5 rounded-xl border bg-card p-3 shadow-[0_-8px_14px_-10px_rgb(0_0_0/0.3)]" aria-label="Write a message" data-testid="wb-composer" onSubmit={(e) => { e.preventDefault(); void runner.preview({ kind: "message", channel, text, ...(email ? { subject } : {}) }, { quote: email ? `Subject: ${subject}\n\n${text}` : text, verb: "Send now" }); }}>
      <div className="flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="How to send" className="inline-flex rounded-lg border p-0.5">
          {CHANNELS.map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={channel === k} disabled={!canUse(k)} onClick={() => setChannel(k)} className={`min-h-10 rounded-md px-3 text-[15px] font-medium disabled:opacity-40 ${channel === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`} data-testid={`wb-ch-${k}`}>{l}</button>)}
        </div>
        <button type="button" onClick={() => onOpenChange?.(false)} aria-label="Collapse the message box" className="ml-auto inline-flex size-9 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" data-testid="wb-composer-collapse"><ChevronDown aria-hidden className="size-4" /></button>
        <select aria-label="Start from a template" value="" onChange={(e) => applyTemplate(e.target.value)} className={`${INPUT} !w-auto min-w-40`} data-testid="wb-template">
          <option value="">Template...</option>
          {ctx.templates.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </div>
      {email && <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" aria-label="Subject" maxLength={200} className={INPUT} data-testid="wb-subject" />}
      <textarea ref={box} value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={email ? 10000 : 1000} placeholder={`Write to ${first || "them"}...`} aria-label="Message" className="thin-scroll block max-h-56 w-full resize-none rounded-lg border bg-background px-3 py-2.5 text-[15px] leading-relaxed focus-visible:outline-2 focus-visible:outline-[var(--ring)]" data-testid="wb-text" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground"><span>Insert:</span>
          {[["First name", first], ["My name", ctx.me ?? ""], ["Business", ctx.locationName ?? ""]].map(([l, v]) => <button key={l} type="button" disabled={!v} onClick={() => insert(v)} className="min-h-9 rounded-md border px-2.5 text-sm hover:bg-accent disabled:opacity-40" data-testid="wb-merge">{l}</button>)}
        </div>
        <span className="text-xs tabular-nums text-muted-foreground" data-testid="wb-count">{email ? `${text.length} characters` : `${text.length}/160 · ${sms} text${sms === 1 ? "" : "s"}`}</span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5" data-testid="wb-mode-chip">
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${ctx.mode.live ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}><span aria-hidden className={`size-1.5 rounded-full ${ctx.mode.live ? "bg-success" : "bg-muted-foreground"}`} />{ctx.mode.live ? "Live" : "Dry run"}</span>
          <InfoTip label="About sending" text={ctx.mode.live ? "Messages you send are really sent, after you review them." : "Sending is switched off for now: you can write and review, but nothing is sent."} />
        </span>
        <button type="submit" disabled={runner.busy || !text.trim() || (email && !subject.trim())} title={runner.busy ? "Working on the last step" : !text.trim() ? "Write a message first" : email && !subject.trim() ? "Add a subject first" : undefined} className={`${wbButtons.PRIMARY} cursor-pointer disabled:cursor-not-allowed`} data-testid="wb-preview"><SendHorizonal aria-hidden className="size-4" />Review and send</button>
      </div>
    </form>
  );
}
