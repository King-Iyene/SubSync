"use client";

import { RefreshCw, SendHorizonal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useData } from "../../session";
import { timeAgo } from "../../ui";
import { INPUT, wbButtons, type Runner } from "./runner";
import type { WbContext, WbThread } from "./types";

// The conversation tab: the live thread (fetched when the panel opens, shown, never stored by SubSync) and the composer. Sending goes through the review sheet and the server's gateway.

const CHANNELS = [["SMS", "Text"], ["Email", "Email"], ["WhatsApp", "WhatsApp"]] as const;

export function Thread({ locationId, contactId, reloadKey }: { locationId: string; contactId: string; reloadKey: number }) {
  const t = useData<WbThread>(`workbench/thread?locationId=${encodeURIComponent(locationId)}&contactId=${encodeURIComponent(contactId)}&k=${reloadKey}`);
  const end = useRef<HTMLDivElement>(null);
  const count = t.data?.messages.length ?? 0;
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [count]);
  return (
    <section aria-label="Conversation" data-testid="wb-thread">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Conversation</h3>
        <button type="button" onClick={() => void t.reload()} className="inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-sm text-muted-foreground hover:text-foreground" aria-label="Refresh the conversation"><RefreshCw aria-hidden className={`size-3.5 ${t.loading ? "animate-spin" : ""}`} />Refresh</button>
      </div>
      {t.loading && !t.data && <div className="h-24 animate-pulse rounded-xl bg-muted" aria-label="Loading the conversation" />}
      {t.error && <p className="rounded-lg border border-destructive/40 p-3 text-[15px] text-destructive">The conversation could not be loaded. <button type="button" className="font-medium underline" onClick={() => void t.reload()}>Try again</button></p>}
      {t.data && t.data.messages.length === 0 && <p className="rounded-xl border border-dashed p-4 text-[15px] text-muted-foreground" data-testid="wb-thread-empty">{t.data.note ?? "No messages yet. Say hello below."}</p>}
      {t.data && t.data.state !== "ok" && t.data.state !== "empty" && t.data.messages.length === 0 && <p className="mt-2 text-sm text-muted-foreground">{t.data.note}</p>}
      {t.data && t.data.messages.length > 0 && (
        <ol className="max-h-80 space-y-2.5 overflow-y-auto rounded-xl bg-muted/40 p-3" data-testid="wb-messages">
          {t.data.messages.map((m) => (
            <li key={m.id} className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[86%] rounded-2xl px-3.5 py-2 text-[15px] leading-snug ${m.direction === "out" ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm border bg-card"}`}>
                {m.text ? <p className="whitespace-pre-wrap break-words">{m.text}</p> : <p className="italic opacity-80">{m.channel === "Call" ? "A phone call" : "No text"}</p>}
                <p className={`mt-1 text-[11px] ${m.direction === "out" ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{m.channel} · {timeAgo(m.at)}{m.by ? ` · ${m.by}` : ""}</p>
              </div>
            </li>
          ))}
          <div ref={end} />
        </ol>
      )}
    </section>
  );
}

export function Composer({ ctx, runner, initial = "SMS" }: { ctx: WbContext; runner: Runner; initial?: "SMS" | "Email" }) {
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
  const sms = !email ? Math.max(1, Math.ceil(text.length / 160)) : 0;

  if (ctx.dnd) return <p className="mt-4 rounded-xl border border-destructive/50 p-3.5 text-[15px] font-medium text-destructive" data-testid="wb-dnd">{ctx.name} asked not to be contacted. SubSync will not send them anything.</p>;
  return (
    <form className="mt-4 space-y-3" aria-label="Write a message" data-testid="wb-composer" onSubmit={(e) => { e.preventDefault(); void runner.preview({ kind: "message", channel, text, ...(email ? { subject } : {}) }, { quote: email ? `Subject: ${subject}\n\n${text}` : text, verb: "Send now" }); }}>
      <div className="flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="How to send" className="inline-flex rounded-lg border p-0.5">
          {CHANNELS.map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={channel === k} disabled={!canUse(k)} onClick={() => setChannel(k)} className={`min-h-10 rounded-md px-3 text-[15px] font-medium disabled:opacity-40 ${channel === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`} data-testid={`wb-ch-${k}`}>{l}</button>)}
        </div>
        <select aria-label="Start from a template" value="" onChange={(e) => applyTemplate(e.target.value)} className={`${INPUT} !w-auto min-w-40`} data-testid="wb-template">
          <option value="">Template...</option>
          {ctx.templates.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </div>
      {email && <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" aria-label="Subject" maxLength={200} className={INPUT} data-testid="wb-subject" />}
      <textarea ref={box} value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={email ? 10000 : 1000} placeholder={`Write to ${first || "them"}...`} aria-label="Message" className="block w-full rounded-lg border bg-background px-3 py-2.5 text-[15px] leading-relaxed focus-visible:outline-2 focus-visible:outline-[var(--ring)]" data-testid="wb-text" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground"><span>Insert:</span>
          {[["First name", first], ["My name", ctx.me ?? ""], ["Business", ctx.locationName ?? ""]].map(([l, v]) => <button key={l} type="button" disabled={!v} onClick={() => insert(v)} className="min-h-9 rounded-md border px-2.5 text-sm hover:bg-accent disabled:opacity-40" data-testid="wb-merge">{l}</button>)}
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">{email ? `${text.length} characters` : `${text.length} characters, ${sms} text${sms === 1 ? "" : "s"}`}</span>
      </div>
      <button type="submit" disabled={runner.busy || !text.trim()} className={`${wbButtons.PRIMARY} w-full sm:w-auto`} data-testid="wb-preview"><SendHorizonal aria-hidden className="size-4" />Review and send</button>
    </form>
  );
}
