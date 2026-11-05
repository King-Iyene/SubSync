"use client";

import { useEffect, useMemo, useState } from "react";
import type { AccessKind } from "@/lib/access";
import { accountsQuery, parseTodayAccounts, withTodayAccounts } from "@/lib/analytics/today-queue";
import type { TodayData } from "@/lib/analytics/today-types";
import type { GrowthData } from "@/lib/analytics/growth";
import type { GoFn } from "../nav";
import { ApiProvider, useApiClient, useData } from "../session";
import { EmptyState, Page, remember, remembered, Skeleton, SkeletonRows } from "../ds";
import { Btn, ErrorBox } from "../ui";
import { TodayPage } from "./today-page";
import "./today-theme.css";

// Today's container: it loads the read, keeps the client-account choice (in this page's address as `ta=`, and in this browser, for Today only), and hands everything to TodayPage
// (src/app/app/views/today-page.tsx), which draws the page for every role. See docs/features/TODAY.md.

type Segments = { accounts: Array<{ id: string; name: string; ignored: boolean }> };
const TODAY_KEY = "today-accounts";

function initialAccounts(enabled: boolean): string[] {
  if (typeof window === "undefined" || !enabled) return [];
  const fromAddress = parseTodayAccounts(window.location.hash);
  if (fromAddress.length > 0) return fromAddress;
  return parseTodayAccounts(`#x?ta=${remembered(TODAY_KEY) ?? ""}`);
}

/** Today's own account choice: in the address (`#today?ta=...`), remembered per person for Today only, and kept in step with Back and Forward. */
function useTodayAccounts(enabled: boolean): [string[], (ids: string[]) => void] {
  const [picked, setPicked] = useState<string[]>(() => initialAccounts(enabled));
  const commit = (ids: string[]) => {
    setPicked(ids);
    try { window.history.replaceState(null, "", withTodayAccounts(window.location.hash || "#today", ids)); } catch { /* the choice still applies */ }
    remember(TODAY_KEY, ids.length ? ids.join(",") : null);
  };
  useEffect(() => {
    if (picked.length > 0 && parseTodayAccounts(window.location.hash).length === 0) {
      try { window.history.replaceState(null, "", withTodayAccounts(window.location.hash || "#today", picked)); } catch { /* see above */ }
    }
    // Once, for a choice restored from this browser.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const sync = () => setPicked(parseTodayAccounts(window.location.hash));
    window.addEventListener("popstate", sync);
    window.addEventListener("subsync-today-accounts", sync);
    return () => { window.removeEventListener("popstate", sync); window.removeEventListener("subsync-today-accounts", sync); };
  }, []);
  return [enabled ? picked : [], enabled ? commit : () => undefined];
}

export function TodayView({ go, kind }: { go: GoFn; kind: AccessKind }) {
  const base = useApiClient();
  const agency = kind === "agency";
  const [picked, setPicked] = useTodayAccounts(agency);
  const scoped = useMemo(() => (picked.length ? base.filtered(accountsQuery(picked)) : base), [base, picked]);
  return <ApiProvider value={scoped}><TodayBody go={go} kind={kind} picked={picked} setPicked={setPicked} /></ApiProvider>;
}

function TodayBody({ go, kind, picked, setPicked }: { go: GoFn; kind: AccessKind; picked: string[]; setPicked: (ids: string[]) => void }) {
  const api = useApiClient();
  const today = useData<TodayData>("today");
  const growth = useData<GrowthData>("today/growth");
  const seg = useData<Segments>(kind === "agency" ? "segments" : null);
  const [syncing, setSyncing] = useState(false);

  const options = useMemo(() => (seg.data?.accounts ?? []).filter((a) => !a.ignored).map((a) => ({ id: a.id, name: a.name })), [seg.data]);
  // A choice that names an account this company does not have (an old remembered choice, a typed address) is dropped; the server ignores it anyway.
  useEffect(() => {
    if (!seg.data || picked.length === 0) return;
    const known = new Set(options.map((o) => o.id));
    const clean = picked.filter((p) => known.has(p));
    if (clean.length !== picked.length) setPicked(clean);
  }, [seg.data, options, picked, setPicked]);

  const t = today.data;
  const sync = async () => { setSyncing(true); try { await api.post("sync"); await today.reload(); await growth.reload(); } finally { setSyncing(false); } };
  // "See all" next to "Showing KD Squares" also ends the shell's own one-account narrowing (the shell reads this), so every page shows every client account again.
  const clearShell = () => { try { window.dispatchEvent(new Event("subsync-clear-account-filter")); } catch { /* the page still shows every account */ } };

  if (today.error && !t) return <Page title="Today"><ErrorBox error={today.error} onRetry={today.reload} /></Page>;
  if (!t) {
    return (
      <Page title="Today">
        <div className="mb-8 space-y-3" role="status" aria-busy="true" aria-label="Working out what needs you today"><Skeleton className="h-14 w-3/4" /><Skeleton className="h-10 w-40" /></div>
        <div className="mt-8"><SkeletonRows rows={5} label="Working out what to do first..." /></div>
      </Page>
    );
  }
  if (kind === "agency" && t.accounts.length === 0 && picked.length === 0) {
    return (
      <Page title="Today">
        <EmptyState title="SubSync has not found any client accounts yet" body="The first read takes a few minutes after SubSync is installed. Press Sync now, or follow the steps in Getting started."
          action={<div className="flex gap-2"><Btn variant="primary" onClick={sync} disabled={syncing}>{syncing ? "Syncing..." : "Sync now"}</Btn><Btn onClick={() => go("help")}>Open Getting started</Btn></div>} />
      </Page>
    );
  }
  return <TodayPage go={go} t={t} kind={kind} reload={async () => { await today.reload(); }} sync={sync} syncing={syncing} options={options} picked={picked} setPicked={setPicked} error={today.error?.message ?? null} clearShell={clearShell} growth={{ data: growth.data, loading: growth.loading, error: growth.error?.message ?? null, reload: () => void growth.reload() }} />;
}
