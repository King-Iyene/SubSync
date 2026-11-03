"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState, type KeyboardEvent, type ReactNode } from "react";
import { paginate, PAGE_SIZE, PREVIEW_ROWS } from "@/lib/design/ui-logic";
import { EmptyState } from "./states";

// The one list for the whole app (N14): ten rows and a "View all" button, never an endless scroll. "View all" opens the full list in place with a
// header that stays put, an optional toolbar for filters that stays put, and pages of 25. Each row is a flex row on a phone and a grid on a wide
// screen, so a long list never needs a sideways scroll. A row can open the lead drawer (onOpen).
export type Column<T> = {
  key: string; header: string;
  cell: (row: T) => ReactNode;
  /** CSS grid width on a wide screen, such as "minmax(0,2fr)" or "7rem". Default: an equal share. */
  width?: string;
  align?: "left" | "right";
  /** The column that names the row. It opens the row when onOpen is set, and is never given a label on a phone. */
  primary?: boolean;
};

export function DataList<T>({
  title, rows, columns, rowKey, onOpen, empty = "Nothing to show.", preview = PREVIEW_ROWS, pageSize = PAGE_SIZE, toolbar, total, caption, copyText,
}: {
  title?: string; rows: readonly T[]; columns: Array<Column<T>>; rowKey: (row: T) => string; onOpen?: (row: T, index: number) => void; empty?: string;
  preview?: number; pageSize?: number; toolbar?: ReactNode;
  /** The real size of the list when `rows` is only the first part of it (for example the server sent the first 50 of 3,000). */
  total?: number; caption?: string;
  /** One line of plain text per row. When given, a "Copy list" button puts every loaded row on the clipboard (for a message, a note, a spreadsheet). */
  copyText?: (row: T) => string;
}) {
  const [all, setAll] = useState(false);
  const [page, setPage] = useState(1);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const text = rows.map((r) => copyText?.(r) ?? "").join(String.fromCharCode(10));
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { window.prompt("Copy this list", text); }
  };
  // Up and Down arrows move between the names in the list, Enter opens one.
  const onKeys = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const all = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-row-primary]")];
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    if (at === -1) return;
    e.preventDefault();
    all[Math.min(all.length - 1, Math.max(0, at + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
  };
  const size = total !== undefined && total > rows.length ? total : rows.length;
  if (rows.length === 0) return <EmptyState compact title={empty} />;
  const grid = columns.map((c) => c.width ?? "minmax(0,1fr)").join(" ");
  const paged = paginate(rows, page, pageSize);
  const shown = all ? paged.rows : rows.slice(0, preview);
  const offset = all ? paged.from - 1 : 0;
  const Header = (
    <div className="hidden items-center gap-3 border-b bg-muted/60 px-3 py-2 text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground @3xl:grid @3xl:[grid-template-columns:var(--cols)]" style={{ ["--cols" as string]: grid }} aria-hidden>
      {columns.map((c) => <span key={c.key} className={c.align === "right" ? "text-right" : ""}>{c.header}</span>)}
    </div>
  );
  return (
    <div className="@container min-w-0 rounded-lg border bg-card" data-testid="data-list" data-mode={all ? "all" : "preview"}>
      {(title || toolbar) && (
        <div className={`${all ? "sticky top-0 z-10 " : ""}flex flex-wrap items-center justify-between gap-2 rounded-t-lg border-b bg-card px-3 py-2.5`}>
          {title && <h3 className="text-sm font-semibold">{title}</h3>}
          {toolbar}
        </div>
      )}
      <div className={all ? "sticky top-0 z-[5]" : ""}>{Header}</div>
      <ul className="divide-y" aria-label={title ?? caption} onKeyDown={onKeys}>
        {shown.map((row, n) => (
          <li key={rowKey(row)} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5 text-sm @3xl:grid @3xl:gap-3 @3xl:py-2 @3xl:[grid-template-columns:var(--cols)]" style={{ ["--cols" as string]: grid }}>
            {columns.map((c) => {
              const content = c.cell(row);
              const body = c.primary && onOpen ? <button type="button" data-row-primary onClick={() => onOpen(row, offset + n)} className="min-h-9 text-left font-medium hover:underline">{content}</button> : content;
              return (
                <span key={c.key} className={`min-w-0 ${c.primary ? "w-full font-medium @3xl:w-auto" : ""} ${c.align === "right" ? "@3xl:text-right" : ""}`}>
                  {!c.primary && c.header && <span className="mr-1.5 text-xs text-muted-foreground @3xl:hidden">{c.header}:</span>}{body}
                </span>
              );
            })}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
        {copyText && <button type="button" onClick={copy} className="min-h-9 rounded-lg px-2 font-medium text-primary underline" data-testid="list-copy">{copied ? "Copied" : "Copy list"}</button>}
        {all ? (
          <>
            <span data-testid="list-range">Showing {paged.from} to {paged.to} of {paged.total}</span>
            <span className="flex items-center gap-1">
              <button type="button" aria-label="Previous page" disabled={paged.page <= 1} onClick={() => setPage(paged.page - 1)} className="inline-flex size-9 items-center justify-center rounded-lg border hover:bg-muted disabled:opacity-40"><ChevronLeft aria-hidden className="size-4" /></button>
              <span aria-live="polite">Page {paged.page} of {paged.pages}</span>
              <button type="button" aria-label="Next page" disabled={paged.page >= paged.pages} onClick={() => setPage(paged.page + 1)} className="inline-flex size-9 items-center justify-center rounded-lg border hover:bg-muted disabled:opacity-40"><ChevronRight aria-hidden className="size-4" /></button>
              <button type="button" onClick={() => { setAll(false); setPage(1); }} className="ml-2 min-h-9 rounded-lg px-2 font-medium text-primary underline">Show fewer</button>
            </span>
          </>
        ) : (
          <>
            <span data-testid="list-range">Showing {Math.min(preview, rows.length)} of {size}</span>
            {rows.length > preview && <button type="button" onClick={() => setAll(true)} className="min-h-9 rounded-lg px-2 font-medium text-primary underline">View all {size}</button>}
          </>
        )}
      </div>
      {total !== undefined && total > rows.length && <p className="border-t px-3 py-2 text-xs text-muted-foreground" data-testid="list-capped">Only the first {rows.length} of {total} are loaded here. Narrow the filter to see the rest.</p>}
    </div>
  );
}
