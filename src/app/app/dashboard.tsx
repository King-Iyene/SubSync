"use client";

import { TODAY_FONTS } from "./views/today-fonts";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { accentTokens } from "@/lib/design/color";
import { EMPTY_FILTER, filterFromLink, filterToLink, filterToQuery, isFiltered, type FilterValue } from "@/lib/design/filters";
import { buildHash, parseHash, type ViewState } from "@/lib/design/route";
import { keptParams } from "@/lib/design/route";
import { withTodayAccounts } from "@/lib/analytics/today-queue";
import { THEME_PREFS, type ThemePref } from "@/lib/design/ui-logic";
import { NAV_FOR, type AccessKind } from "@/lib/access";
import { movedSettingsSection } from "@/lib/settings-sections";
import {
  Briefcase, CalendarCheck, ClipboardCheck, Zap, CircleHelp, Copy, Eraser, Inbox, Kanban, LayoutDashboard, Mic, Monitor, Moon, PhoneCall, Plug, Search, Settings, Sun, Target, UserRound, Users, Wrench, type LucideIcon,
  Sparkles, UsersRound,
  Workflow, CreditCard, Landmark,
} from "lucide-react";
import { NAV, PARENT, visibleNav, type GoFn, type ViewId } from "./nav";
import { useBrandedText } from "./brand-text";
import { BrandLogo, ProductMark } from "./brand-logo";
import { Btn } from "./ui";
import { FeedbackBox } from "./feedback-box";
import { BackLink, BackProvider, ModuleTabs, TrailProvider } from "./ds/template";
import { InlineAlert } from "./ds/alert";
import { GlobalFilterBar } from "./ds/global-filter";
import { useTheme } from "./ds/theme";
import { remember, remembered } from "./ds/remember";
import { ApiProvider, makeApi, type Api } from "./session";
import { LeadDrawerHost } from "./ds/lead-drawer-host";
const AppointmentInsights = dynamic(() => import("./views/appointment-insights").then((m) => m.AppointmentInsights), { ssr: false });
import { sampleOn as dqSample } from "./views/dq/dq-data";
import { GlobalSearch } from "./views/global-search";
import { AskDataCard } from "./views/ask-data";
import type { ClientsFeatures } from "./views/clients";
import { GuideHelpButton, NewMark, StNavEntry, StProvider } from "./views/st-state";
import { FreshnessStrip as StatusLine } from "./views/sync-status";
import { fixturesOn as clSample } from "./views/cl3/data";
import { fnfxOn as fnSample } from "./views/fn/data";
import { EmptyState } from "./ds/states";
import { fixturesOn as pmSample } from "./views/pm/data";
import { fixturesOn as ppSample } from "./views/pp3/data";
import { TodayModule } from "./views/td3/module";
import { overviewMerged } from "@/lib/analytics/today3-intel";
import { fixturesOn as tdSample } from "./views/td3/data";
import { NotificationBell } from "./views/notification-bell";
import { LiveStatus, SyncNow } from "./ds/sync-now";

import { TodayView } from "./views/today";

// Round 6 (cold start): every page except Today is loaded when first needed (and warmed on hover and when the browser is idle), so the first paint carries only the shell and Today.
function ViewLoading() {
  return <div aria-busy="true" aria-label="Loading" className="space-y-3 p-1">{[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-lg bg-muted/60" />)}</div>;
}
const AccountDetailView = dynamic(() => import("./views/account-detail").then((m) => m.AccountDetailView), { ssr: false, loading: () => <ViewLoading /> });
const AlertsView = dynamic(() => import("./views/alerts").then((m) => m.AlertsView), { ssr: false, loading: () => <ViewLoading /> });
const AppointmentsModule = dynamic(() => import("./views/ap3/module").then((m) => m.AppointmentsModule), { ssr: false, loading: () => <ViewLoading /> });
const AuditView = dynamic(() => import("./views/audit").then((m) => m.AuditView), { ssr: false, loading: () => <ViewLoading /> });
const SpeedView = dynamic(() => import("./views/speed").then((m) => m.SpeedView), { ssr: false, loading: () => <ViewLoading /> });
const AppointmentsView = dynamic(() => import("./views/appointments").then((m) => m.AppointmentsView), { ssr: false, loading: () => <ViewLoading /> });
const CleanupModule = dynamic(() => import("./views/cleanup-hub").then((m) => m.CleanupModule), { ssr: false, loading: () => <ViewLoading /> });
const DqModule = dynamic(() => import("./views/dq/dq-module").then((m) => m.DqModule), { ssr: false, loading: () => <ViewLoading /> });
const MeetingsView = dynamic(() => import("./views/meetings").then((m) => m.MeetingsView), { ssr: false, loading: () => <ViewLoading /> });
const WorkflowsView = dynamic(() => import("./views/workflows").then((m) => m.WorkflowsView), { ssr: false, loading: () => <ViewLoading /> });
const DataHealthView = dynamic(() => import("./views/data-health").then((m) => m.DataHealthView), { ssr: false, loading: () => <ViewLoading /> });
const PeopleModule = dynamic(() => import("./views/people-module").then((m) => m.PeopleModule), { ssr: false, loading: () => <ViewLoading /> });
const ClientsView = dynamic(() => import("./views/clients").then((m) => m.ClientsView), { ssr: false, loading: () => <ViewLoading /> });
const DealsView = dynamic(() => import("./views/deals").then((m) => m.DealsView), { ssr: false, loading: () => <ViewLoading /> });
const EmailHealthView = dynamic(() => import("./views/email-health").then((m) => m.EmailHealthView), { ssr: false, loading: () => <ViewLoading /> });
const HelpView = dynamic(() => import("./views/help").then((m) => m.HelpView), { ssr: false, loading: () => <ViewLoading /> });
const SettingsHub = dynamic(() => import("./views/settings-hub").then((m) => m.SettingsHub), { ssr: false, loading: () => <ViewLoading /> });
const GuidesView = dynamic(() => import("./views/guides-view").then((m) => m.GuidesView), { ssr: false, loading: () => <ViewLoading /> });
const NewsView = dynamic(() => import("./views/news-view").then((m) => m.NewsView), { ssr: false, loading: () => <ViewLoading /> });
const RoadmapView = dynamic(() => import("./views/roadmap").then((m) => m.RoadmapView), { ssr: false, loading: () => <ViewLoading /> });
const InboxView = dynamic(() => import("./views/inbox").then((m) => m.InboxView), { ssr: false, loading: () => <ViewLoading /> });
const OnboardingView = dynamic(() => import("./views/onboarding").then((m) => m.OnboardingView), { ssr: false, loading: () => <ViewLoading /> });
const OverviewView = dynamic(() => import("./views/overview").then((m) => m.OverviewView), { ssr: false, loading: () => <ViewLoading /> });
const PipelineView = dynamic(() => import("./views/pipeline").then((m) => m.PipelineView), { ssr: false, loading: () => <ViewLoading /> });
const PipelineModule = dynamic(() => import("./views/pl3/module").then((m) => m.PipelineModule), { ssr: false, loading: () => <ViewLoading /> });
const ClientsModule = dynamic(() => import("./views/cl3/module").then((m) => m.ClientsModule), { ssr: false, loading: () => <ViewLoading /> });
const MoneyModule = dynamic(() => import("./views/money/module").then((m) => m.MoneyModule), { ssr: false, loading: () => <ViewLoading /> });
const TeamView = dynamic(() => import("./views/people").then((m) => m.TeamView), { ssr: false, loading: () => <ViewLoading /> });
const TeamModule = dynamic(() => import("./views/pp3/module").then((m) => m.TeamModule), { ssr: false, loading: () => <ViewLoading /> });
const SettingsView = dynamic(() => import("./views/settings").then((m) => m.SettingsView), { ssr: false, loading: () => <ViewLoading /> });
const IntegrationsPage = dynamic(() => import("./views/connections").then((m) => m.IntegrationsPage), { ssr: false, loading: () => <ViewLoading /> });
const NotificationsPage = dynamic(() => import("./views/notifications").then((m) => m.NotificationsPage), { ssr: false, loading: () => <ViewLoading /> });

/** Starts loading a page's code ahead of the click. Never throws. */
const PRELOAD: Record<string, () => Promise<unknown>> = {
  AccountDetailView: () => import("./views/account-detail"),
  AlertsView: () => import("./views/alerts"),
  AppointmentsModule: () => import("./views/ap3/module"),
  AuditView: () => import("./views/audit"),
  SpeedView: () => import("./views/speed"),
  AppointmentsView: () => import("./views/appointments"),
  CleanupModule: () => import("./views/cleanup-hub"),
  DqModule: () => import("./views/dq/dq-module"),
  MeetingsView: () => import("./views/meetings"),
  WorkflowsView: () => import("./views/workflows"),
  DataHealthView: () => import("./views/data-health"),
  PeopleModule: () => import("./views/people-module"),
  ClientsView: () => import("./views/clients"),
  DealsView: () => import("./views/deals"),
  EmailHealthView: () => import("./views/email-health"),
  HelpView: () => import("./views/help"),
  SettingsHub: () => import("./views/settings-hub"),
  GuidesView: () => import("./views/guides-view"),
  NewsView: () => import("./views/news-view"),
  RoadmapView: () => import("./views/roadmap"),
  InboxView: () => import("./views/inbox"),
  OnboardingView: () => import("./views/onboarding"),
  OverviewView: () => import("./views/overview"),
  PipelineView: () => import("./views/pipeline"),
  PipelineModule: () => import("./views/pl3/module"),
  ClientsModule: () => import("./views/cl3/module"),
  MoneyModule: () => import("./views/money/module"),
  TeamView: () => import("./views/people"),
  TeamModule: () => import("./views/pp3/module"),
  SettingsView: () => import("./views/settings"),
  IntegrationsPage: () => import("./views/connections"),
  NotificationsPage: () => import("./views/notifications"),
};
const NAV_WARM: Record<string, string[]> = {
  speed: ["SpeedView"], appointments: ["AppointmentsModule", "AppointmentsView"], accounts: ["ClientsModule", "ClientsView"], clients: ["ClientsModule", "ClientsView"], account: ["AccountDetailView"],
  settings: ["SettingsHub", "SettingsView"], cleanup: ["CleanupModule", "DqModule"], duplicates: ["CleanupModule", "DqModule"], "data-health": ["DataHealthView", "CleanupModule"],
  people: ["PeopleModule"], search: ["PeopleModule"], leads: ["PeopleModule"], calls: ["PeopleModule"], team: ["TeamModule", "TeamView"], pipeline: ["PipelineModule", "PipelineView"], deals: ["PipelineView", "DealsView"],
  payments: ["MoneyModule"], finance: ["MoneyModule"], meetings: ["MeetingsView"], workflows: ["WorkflowsView"], alerts: ["AlertsView"], help: ["GuidesView", "HelpView"], roadmap: ["NewsView", "RoadmapView"],
  overview: ["OverviewView"], audit: ["AuditView"], inbox: ["InboxView"], onboarding: ["ClientsModule", "OnboardingView"], notifications: ["NotificationsPage"], connections: ["IntegrationsPage"],
};
export function warmView(id: string): void { for (const n of NAV_WARM[id] ?? []) void PRELOAD[n]?.().catch(() => undefined); }

type Auth =
  | { status: "waiting" }
  | { status: "outside" }
  | { status: "error"; message: string }
  | { status: "not_installed" }
  | { status: "maintenance"; message: string }
  | { status: "ready"; api: Api; demo: boolean; userName: string | null; features: Record<string, boolean>; locked: string[]; kind: AccessKind; locationId: string | null; brand: { name: string | null; color: string | null; logoUrl?: string | null } };

type SsoResponse = {
  error?: string;
  installed?: boolean;
  maintenance?: boolean;
  demo?: boolean;
  session?: string;
  kind?: AccessKind;
  user?: { userName?: string | null; activeLocation?: string | null };
  entitlements?: { features: Record<string, boolean>; locked?: string[] };
  brand?: { name: string | null; color: string | null; logoUrl?: string | null };
};

async function exchange(body: unknown): Promise<{ ok: boolean; status: number; data: SsoResponse }> {
  const res = await fetch("/api/sso", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { ok: res.ok, status: res.status, data: (await res.json().catch(() => ({}))) as SsoResponse };
}

// `/app#speed`, `/app#account=<id>` or `/app#speed?hideTest=1` opens that view (and filter) first, so a link, a reload and the browser Back button all land where the
// person was (N7, N8). Handy for demos and screenshots; the signed-in session is still required to see any data. The address logic is in src/lib/design/route.ts.
const VIEW_IDS = NAV.map((n) => n.id as string);
function stateFromHash(): { view: ViewState; filter: FilterValue } {
  if (typeof window === "undefined") return { view: { id: "today" }, filter: EMPTY_FILTER };
  return parseHash(window.location.hash, VIEW_IDS);
}

// `?as=business` or `?as=client` opens the demo as a single business or as a client's staff; `?as=location` as an agency person who opened SubSync from inside one client account.
// Only demo mode honours it; real sign-in decides the view from the host's user context.
function demoView(): "business" | "client" | "location" | undefined {
  if (typeof window === "undefined") return undefined;
  const as = new URLSearchParams(window.location.search).get("as");
  return as === "business" || as === "client" || as === "location" ? as : undefined;
}

/** True when the Unanswered tab can live in Speed to lead for this session: both features are on, not locked, and both pages are in this kind of session's menu. */
function inboxTabOn(auth: Auth): boolean {
  if (auth.status !== "ready") return false;
  const ok = (id: string, feature: string) => NAV_FOR[auth.kind].has(id) && auth.features[feature] !== false && !auth.locked.includes(feature);
  return ok("speed", "speed") && ok("inbox", "inbox");
}

/** The tab an address asks Speed to open first (`#speed?tab=unanswered`). */
function speedStart(): "unanswered" | undefined {
  if (typeof window === "undefined") return undefined;
  const q = window.location.hash.split("?")[1];
  return q && new URLSearchParams(q).get("tab") === "unanswered" ? "unanswered" : undefined;
}

export function Dashboard() {
  const [auth, setAuth] = useState<Auth>({ status: "waiting" });
  const { pref: themePref, theme, setPref: setThemePref } = useTheme();
  const [start] = useState(stateFromHash);
  const [view, setViewState] = useState<{ id: ViewId; locationId?: string }>(start.view as { id: ViewId; locationId?: string });
  // The pages the person came through, newest last, so a drill-in has a "Back to ..." that returns to the page, account and filter they left (N7).
  const [trail, setTrail] = useState<Array<{ id: ViewId; locationId?: string }>>([]);
  // The last filter is remembered in this browser; a link that carries its own filter wins (KF-5).
  const [filter, setFilterState] = useState<FilterValue>(() => (typeof window === "undefined" || isFiltered(start.filter) || window.location.hash.includes("?") ? start.filter : filterFromLink(remembered("filter") ?? "")));
  const filterRef = useRef(filter);
  // Embedded in the host page: ask the parent who the user is. Assume embedded during server
  // render so the first paint matches.
  const embedded = useSyncExternalStore(() => () => {}, () => window.parent !== window, () => true);
  const pending = useRef<((payload: string | null) => void) | null>(null);
  // Bumped whenever the sign-in effect restarts, so a wait that began earlier cannot overwrite the current screen.
  const epoch = useRef(0);
  const refreshRef = useRef<() => Promise<string | null>>(async () => null);

  const apply = useCallback((r: { ok: boolean; status: number; data: SsoResponse }): string | null => {
    if (r.ok && r.data.installed === false) {
      setAuth({ status: "not_installed" });
      return null;
    }
    if (r.ok && r.data.session) {
      const demo = r.data.demo === true;
      setAuth({
        status: "ready", api: makeApi(r.data.session, () => refreshRef.current(), demo), demo,
        userName: r.data.user?.userName ?? null, features: r.data.entitlements?.features ?? {}, locked: r.data.entitlements?.locked ?? [],
        kind: r.data.kind ?? "agency", locationId: r.data.user?.activeLocation ?? null, brand: r.data.brand ?? { name: null, color: null },
      });
      return r.data.session;
    }
    if (r.data.maintenance) { setAuth({ status: "maintenance", message: r.data.error ?? "SubSync is down for a short maintenance. It will be back shortly." }); return null; }
    setAuth({ status: "error", message: r.data.error ?? "Could not sign you in." });
    return null;
  }, []);

  // Ask the host page for fresh encrypted user context and exchange it for a session.
  const signIn = useCallback(async (): Promise<string | null> => {
    const mine = epoch.current;
    const payload = await new Promise<string | null>((resolve) => {
      pending.current = resolve;
      window.parent.postMessage({ message: "REQUEST_USER_DATA" }, "*");
      setTimeout(() => {
        if (pending.current === resolve) {
          pending.current = null;
          resolve(null);
        }
      }, 6000);
    });
    // The page decided meanwhile that it is not embedded (or the effect restarted): this wait is stale, so it must not
    // overwrite what the page shows now.
    if (mine !== epoch.current) return null;
    if (!payload) {
      // The host did not answer. With demo mode on (never in production) show sample data
      // instead of dead-ending, which also covers previews that frame the page.
      const demo = await exchange({ demo: true, as: demoView() }).catch(() => null);
      if (demo?.ok) return apply(demo);
      setAuth({ status: "error", message: "No response from the host page. Please refresh." });
      return null;
    }
    try {
      return apply(await exchange({ payload }));
    } catch {
      setAuth({ status: "error", message: "Could not reach SubSync. Please refresh." });
      return null;
    }
  }, [apply]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      const data = event.data as { message?: string; payload?: unknown } | null;
      if (data?.message === "REQUEST_USER_DATA_RESPONSE" && typeof data.payload === "string" && pending.current) {
        const resolve = pending.current;
        pending.current = null;
        resolve(data.payload);
      }
    };
    window.addEventListener("message", onMessage);

    if (!embedded) {
      // Opened directly (not inside the host page). Demo mode, when enabled, shows sample data.
      void exchange({ demo: true, as: demoView() }).then((r) => {
        if (r.ok) apply(r);
        else if (r.data.maintenance) setAuth({ status: "maintenance", message: r.data.error ?? "SubSync is down for a short maintenance. It will be back shortly." });
        else setAuth({ status: "outside" });
      }).catch(() => setAuth({ status: "outside" }));
    } else {
      // signIn only sets state after awaiting the host page's reply, never synchronously.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void signIn();
    }
    return () => {
      epoch.current += 1;
      window.removeEventListener("message", onMessage);
    };
  }, [embedded, apply, signIn]);

  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; filterRef.current = filter; });
  // A move made by a page ("Open" a deal list from the audit) remembers where it came from and adds a browser history entry, so both the Back link and
  // the browser Back button return. A menu click starts a fresh trail.
  const move = useCallback((next: { id: ViewId; locationId?: string }, keepTrail: boolean) => {
    const here = viewRef.current;
    // Today for ONE client account (stage F5, N2): the same page with the filter narrowed to that account. The way back returns to the filter that was on.
    // Today's own account choice (`ta=`) belongs to Today alone: it does not touch the shared filter that every other page uses.
    const only = next.id === "today" && next.locationId ? next.locationId : null;
    const target: { id: ViewId; locationId?: string } = only ? { id: "today" } : next;
    if (!only && here.id === next.id && (here.locationId ?? "") === (next.locationId ?? "")) { window.scrollTo({ top: 0 }); return; }
    // The entry being left keeps its own filter in its address (a remembered filter is not in the address yet), so Back lands on the same numbers.
    try { window.history.replaceState(null, "", buildHash(here, filterRef.current, keptParams(window.location.hash))); } catch { /* see below */ }
    setTrail((t) => (keepTrail ? [...t, here].slice(-12) : []));
    setViewState(target);
    try { window.history.pushState(null, "", only ? withTodayAccounts(buildHash(target, filterRef.current), [only]) : buildHash(target, filterRef.current)); } catch { /* a frame that forbids it: the screen still changes */ }
    if (only) window.dispatchEvent(new Event("subsync-today-accounts"));
    window.scrollTo({ top: 0 });
  }, []);
  const go: GoFn = useCallback((id, locationId) => move({ id, locationId }, true), [move]);
  const goTop: GoFn = useCallback((id, locationId) => move({ id, locationId }, false), [move]);
  const setFilter = useCallback((f: FilterValue) => {
    setFilterState(f);
    remember("filter", isFiltered(f) ? filterToLink(f) : null);
    try { window.history.replaceState(null, "", buildHash(viewRef.current, f, keptParams(window.location.hash))); } catch { /* see above */ }
  }, []);
  // Today's "Showing KD Squares. See all" also ends the one-account narrowing the shell started with, so the other pages show every client account again.
  useEffect(() => {
    const clear = () => setFilter(EMPTY_FILTER);
    window.addEventListener("subsync-clear-account-filter", clear);
    return () => window.removeEventListener("subsync-clear-account-filter", clear);
  }, [setFilter]);
  // The browser Back and Forward buttons: read the page and filter from the address.
  useEffect(() => {
    const onPop = () => {
      const s = stateFromHash();
      setViewState(s.view as { id: ViewId; locationId?: string });
      setFilterState(s.filter);
      setTrail((t) => t.slice(0, -1));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // The API client asks for a fresh session through this when a request comes back 401.
  useEffect(() => {
    refreshRef.current = () => (embedded ? signIn() : exchange({ demo: true, as: demoView() }).then(apply));
  }, [embedded, signIn, apply]);

  // The "show only" filter (client accounts, industry, owner, test accounts) narrows every page for agencies. It is part of the page address.
  const filterQuery = filterToQuery(filter);
  const baseApi = auth.status === "ready" ? auth.api : null;
  // Opened from inside one client account (the platform sends that account with the sign-in): start on it, with a way back to all of them.
  const launched = useRef(false);
  // Once Today is on screen and the browser is idle, load the code of the pages people open next, one at a time, so the first click on any of them has nothing left to download.
  const ready = auth.status === "ready";
  useEffect(() => {
    if (!ready) return;
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const order = ["speed", "appointments", "accounts", "people", "settings", "cleanup", "alerts", "pipeline", "team"];
    let i = 0, stopped = false;
    const next = () => { if (stopped || i >= order.length) return; warmView(order[i++]); if (ric) ric(next, { timeout: 4000 }); else setTimeout(next, 600); };
    const start = window.setTimeout(() => { if (ric) ric(next, { timeout: 4000 }); else next(); }, 1200);
    return () => { stopped = true; window.clearTimeout(start); };
  }, [ready]);
  useEffect(() => {
    if (auth.status !== "ready" || launched.current) return;
    launched.current = true;
    if (auth.kind === "agency" && auth.locationId && !window.location.hash) {
      const only = { ...EMPTY_FILTER, accounts: [auth.locationId] };
      // Not remembered: the next time SubSync is opened from the agency menu it must show every client account again.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFilterState(only);
      try { window.history.replaceState(null, "", withTodayAccounts(buildHash({ id: "today" }, only), [auth.locationId])); window.dispatchEvent(new Event("subsync-today-accounts")); } catch { /* the screen still narrows */ }
    }
  }, [auth]);
  // An old address that moved into Settings (#connections) is rewritten to the page it lives in now, so the address, a reload and the Back button agree with the screen.
  useEffect(() => {
    if (auth.status !== "ready" || !movedSettingsSection(view.id) || !NAV_FOR[auth.kind].has("settings")) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setViewState({ id: "settings" });
    try { window.history.replaceState(null, "", buildHash({ id: "settings" }, filterRef.current, keptParams(window.location.hash))); } catch { /* the screen is already right */ }
  }, [auth, view.id]);
  // Unanswered messages is a tab of Speed to lead (nav.ts). An old address (#inbox, a notification, an email) is rewritten to Speed on that tab, like Connections into Settings.
  const inboxTab = inboxTabOn(auth);
  useEffect(() => {
    if (auth.status !== "ready" || view.id !== "inbox" || !inboxTab) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setViewState({ id: "speed" });
    try { window.history.replaceState(null, "", `${buildHash({ id: "speed" }, filterRef.current, [keptParams(window.location.hash).replace(/(^|&)tab=unanswered/, ""), "tab=unanswered"].filter(Boolean).join("&").replace(/^&/, ""))}`); } catch { /* the screen is already right */ }
  }, [auth, view.id, inboxTab]);
  // True while the page shows only the account SubSync was opened from (the filter is that one account). Pages draw no account filter then.
  const fromAccount = auth.status === "ready" && auth.kind === "agency" && Boolean(auth.locationId) && filter.accounts.length === 1 && filter.accounts[0] === auth.locationId;
  useBrandedText(auth.status === "ready" ? auth.brand.name : null);
  const api = useMemo(() => (baseApi ? (filterQuery ? baseApi.filtered(filterQuery) : baseApi) : null), [baseApi, filterQuery]);

  // Count which pages get opened, so the getting-started checklist can tick itself off.
  useEffect(() => {
    if (api) void api.post("usage", { view: view.id }).catch(() => {});
    // Also remembered in this browser, so a client's staff (whose steps cannot be ticked from the company counter) see their own progress in Getting started.
    remember(`seen-${view.id}`, "1");
  }, [api, view.id]);

  if (auth.status === "waiting") return <Centered title="Loading SubSync" body="Checking your account..." />;
  if (auth.status === "outside") {
    return <Centered title="Open SubSync from your account menu" body="This page is built to run inside your account. Open SubSync from the left menu of one of your client accounts." />;
  }
  if (auth.status === "maintenance") return <Centered title="Back shortly" body={auth.message} />;
  if (auth.status === "not_installed") {
    return <Centered title="SubSync is not set up for your company yet" body="Install SubSync from the app marketplace for your company, then open it again from the menu." />;
  }
  if (auth.status === "error" || !api) {
    return <Centered title="We could not sign you in" body={auth.status === "error" ? auth.message : "Please refresh."} />;
  }

  const limited = auth.kind !== "agency";
  // Connections is Settings, Integrations now: an old address opens Settings on that section (a client's staff have no Settings, so theirs stays the Integrations page).
  const movedTo = movedSettingsSection(view.id);
  const viewId: ViewId = movedTo && NAV_FOR[auth.kind].has("settings") ? "settings" : view.id;
  // Features that are switched off (flags) are not shown at all.
  // Switched off for everyone: not shown. Locked by plan: shown with a Pro note, and the page explains.
  const locked = (feature: string) => auth.locked.includes(feature);
  const off = (feature: string) => auth.features[feature] === false && !locked(feature);
  // Clean-up v2 (stage DQ): each switch is on when the feature is on for this account and not locked by the plan; ?cufx shows the labelled sample.
  const dqFlag = (f: string) => (auth.features[f] === true && !auth.locked.includes(f)) || dqSample();
  const dqOn = dqFlag("dq_module");
  // A page that lives inside a module as a tab (People holds Contact search, Leads and Call lists) has no menu entry of its own.
  // (A page that lives inside the Clients module has no entry of its own for an agency; a business and a client's staff have no Clients module, so their Setup stays in their menu.)
  // The Clean-up entry stays while either of its two features is on (a switched-off tab is left out inside it).
  const hideOverview = !limited && overviewMerged(auth.features);
  const menu0 = visibleNav(NAV_FOR[auth.kind], { limited, off: (f) => (f === "cleanup" ? off("cleanup") && off("duplicates") : f === "team" && limited ? auth.features.pp_module !== true || locked("pp_module") : off(f)) });
  const menu = hideOverview ? menu0.filter((n) => n.id !== "overview") : menu0;
  // The sidebar: the pilot menu in plain groups that scroll, and Settings, Getting started and What's new pinned underneath so they are always visible.
  const mainMenu = menu.filter((n) => n.group !== "Settings and help");
  const footMenu = menu.filter((n) => n.group === "Settings and help");
  const renderNav = (list: typeof menu) => list.map((n, i) => (
      <StNavEntry key={n.id} id={n.id} onWarm={warmView}><div>
        {n.group !== (list[i - 1]?.group ?? null) && (n.group && n.group !== "Settings and help" ? <p data-testid="nav-group" className="px-3 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/70">{n.group}</p> : i > 0 || n.group === "Settings and help" ? <div className="my-2 border-t border-sidebar-border" /> : null)}
        <button type="button" onClick={() => goTop(n.id)} aria-current={n.id === active ? "page" : undefined}
          className={`group relative flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left text-[0.86rem] transition-colors ${n.id === active ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"}`}>
          {n.id === active && <span aria-hidden className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-sidebar-primary" />}
          {(() => { const Icon = ICONS[n.id]; return Icon ? <Icon aria-hidden className={`size-[17px] shrink-0 ${n.id === active ? "text-sidebar-primary" : "opacity-70 group-hover:opacity-100"}`} /> : null; })()}
          <span className="flex-1">{labelFor(n)}</span>
          {locked(n.feature) && <span className="text-[10px] font-semibold uppercase tracking-wide text-sidebar-primary">Pro</span>}
          <NewMark view={n.id} />
        </button>
      </div></StNavEntry>
  ));
  const labelFor = (n: (typeof NAV)[number]) => (limited && n.id === "overview" ? "My account" : n.label);
  // Pages that live inside another page highlight their parent in the menu.
  const shown: ViewId = viewId;
  const parentOfShown = PARENT[shown];
  const active = limited && shown === "onboarding" ? shown : parentOfShown && menu.some((n) => n.id === parentOfShown) ? parentOfShown : shown;
  // The "Section" of the "Section > Page" trail above each title: the menu group, or the parent module for a page that lives inside one.
  const activeItem = menu.find((n) => n.id === active);
  const trailSection = activeItem ? (PARENT[shown] && activeItem.id !== shown ? activeItem.label : activeItem.group && activeItem.group !== "Settings and help" ? activeItem.group : null) : null;
  const agency = auth.demo ? "Demo Company" : limited ? "Your business" : "Your company";
  const own = auth.locationId;

  // People: one module for finding contacts. Its tabs are the pages that used to be separate menu entries (nothing was removed); stage F10 grows it.
  // F10: Search and filters, Smart lists (with the built-in call lists), Going cold, Imports and sources. The old Contact search, Leads and Call lists addresses open the matching tab.
  const peopleOn = NAV_FOR[auth.kind].has("search") && !off("search");
  const callsAllowed = NAV_FOR[auth.kind].has("calls") && !off("calls") && !locked("calls");
  const peopleStart = view.id === "calls" ? 1 : view.id === "leads" ? 2 : 0;
  const pipeTabs = [{ label: "Forecast and stages", node: <PipelineView /> }, { label: "Stale deals and hygiene", node: <DealsView /> }];
  // A business or a client's staff keep the small Setup module (their own checklist and email sending). An agency has the Clients module instead.
  const setupTabs = [{ label: "Setup checklists", node: <OnboardingView go={go} /> }, { label: "Email sender health", node: <EmailHealthView /> }];
  const clientFeatures: ClientsFeatures = { health: !off("health"), onboarding: !off("onboarding"), clients: !off("clients"), reports: !off("reports"), setupCompare: !off("setup_compare"), playbooks: !off("playbooks") };

  // Today (front page): the new module replaces the old hub when its flag is on; the older tabs stay reachable under Numbers > More numbers.
  const tdOn = (auth.features.td_module === true && !auth.locked.includes("td_module")) || tdSample();
  const content = (() => {
    // A business or a client sees its own account as the home page, never an accounts list.
    if (limited) {
      const id = viewId === "account" ? "overview" : viewId;
      if (!NAV_FOR[auth.kind].has(id)) return <Centered title="Not available" body="This page is not part of your view of SubSync." />;
      // A page that is switched off is switched off for a business too (the menu already leaves it out; this covers a typed address).
      const pageFeature = NAV.find((n) => n.id === id)?.feature;
      if (pageFeature && off(pageFeature)) return <Centered title="Not available" body="This page is switched off right now." />;
      if (id === "myday") return <ApiProvider value={baseApi}><TodayView go={go} kind={auth.kind} /></ApiProvider>;
      if (id === "overview") return own ? <AccountDetailView key={own} locationId={own} go={go} agency={agency} limited /> : <Centered title="Open SubSync from inside your account" body="We could not tell which account you are in." />;
    }
    const feature = NAV.find((n) => n.id === viewId)?.feature;
    if (feature && off(feature)) return <Centered title="Not available" body="This page is switched off right now." />;
    if (feature && locked(feature)) return <Centered title="Part of the paid plan" body="This page is included in the Pro plan. Ask whoever manages your SubSync plan to upgrade, and it appears here straight away." />;
    switch (viewId) {
      // Today reads with the unfiltered client and applies its own account choice, so the shared filter never changes what Today counts.
      case "today": return <ApiProvider value={baseApi}><AskDataCard />{tdOn ? <TodayModule key="td3" go={go} kind={auth.kind} /> : <TodayView go={go} kind={auth.kind} />}</ApiProvider>;
      // "My day" is Today now (one page, one menu item). The old address still opens it.
      case "myday": return <ApiProvider value={baseApi}>{tdOn ? <TodayModule key="td3" go={go} kind={auth.kind} /> : <TodayView go={go} kind={auth.kind} />}</ApiProvider>;
      case "people": case "search": case "leads": case "calls": return peopleOn ? <PeopleModule key={"people" + peopleStart} start={peopleStart} callsAllowed={callsAllowed} find={auth.features.fl_find === true && !auth.locked.includes("fl_find")} bulk={auth.features.fl_bulk === true && !auth.locked.includes("fl_bulk")} /> : <Centered title="Not available" body="This page is switched off right now." />;
      case "audit": return <AuditView />;
      // Speed to lead holds the Unanswered tab (when messages and speed are both on); `#speed?tab=unanswered` and the old #inbox open it first.
      case "speed": return <SpeedView go={go} unanswered={inboxTab} start={speedStart()} />;
      // Overview is merged into Today > Numbers: the old address opens Numbers with a one-line "Overview moved here" (the page itself stays in the code, behind the ov_screen flag).
      case "overview": return overviewMerged(auth.features) ? <ApiProvider value={baseApi}><TodayModule key="td3-ov" go={go} kind={auth.kind} initialTab="numbers" fromOverview /></ApiProvider> : <OverviewView go={go} />;
      case "accounts": if ((auth.features.cl_module === true && !auth.locked.includes("cl_module")) || clSample()) return <ClientsModule key="cl3" go={go} features={clientFeatures} />; return <ClientsView key="accounts" go={go} initialTab="health" features={clientFeatures} />;
      case "account": return view.locationId ? <AccountDetailView key={view.locationId} locationId={view.locationId} go={go} agency={agency} /> : <ClientsView key="accounts" go={go} initialTab="health" features={clientFeatures} />;
      case "deals": return <ModuleTabs key="pipe" start={1} tabs={pipeTabs} />;
      case "inbox": return inboxTab ? <SpeedView go={go} unanswered start="unanswered" /> : <InboxView go={go} />;
      case "onboarding": return limited ? <ModuleTabs key="setup" start={0} tabs={setupTabs} /> : (auth.features.cl_module === true && !auth.locked.includes("cl_module")) || clSample() ? <ClientsModule key="cl3" go={go} features={clientFeatures} initialTab="onboarding" /> : <ClientsView key="onboarding" go={go} initialTab="onboarding" features={clientFeatures} />;
      case "email": return limited ? <ModuleTabs key="setup" start={1} tabs={setupTabs} /> : <EmailHealthView />;
      case "duplicates": case "cleanup": if (dqOn) return <DqModule key="dq" kind={auth.kind} start={viewId === "duplicates" ? "duplicates" : "overview"} duplicatesOn={dqFlag("dq_dupes")} intakeOn={dqFlag("dq_intake")} fixOn={auth.features.cu_fix === true && !auth.locked.includes("cu_fix")} cleanupOn={!off("cleanup") && NAV_FOR[auth.kind].has("cleanup")} />;
        return <CleanupModule key={viewId} kind={auth.kind} start={viewId === "cleanup" ? "quality" : "duplicates"} duplicatesOn={!off("duplicates") && NAV_FOR[auth.kind].has("duplicates")} cleanupOn={!off("cleanup") && NAV_FOR[auth.kind].has("cleanup")} fixOn={auth.features.cu_fix === true && !auth.locked.includes("cu_fix")} healthOn={auth.features.cu_health === true && !auth.locked.includes("cu_health")} legacyHealth={auth.features.cu_health === true && !off("data_health") ? <ApiProvider value={baseApi}><DataHealthView go={go} kind={auth.kind} /></ApiProvider> : null} />;
      case "alerts": return <AlertsView go={go} />;
      case "settings": return auth.features.st_settings === true && !auth.locked.includes("st_settings") ? <SettingsHub go={go} features={auth.features} openOld={movedTo ?? undefined} /> : <SettingsView openSection={movedTo ?? undefined} />;
      case "connections": return <IntegrationsPage />;
      case "notifications": return <NotificationsPage />;
      case "help": return auth.features.st_guides === true && !auth.locked.includes("st_guides") ? <GuidesView go={go} /> : <HelpView go={go} />;
      case "roadmap": return auth.features.st_news === true && !auth.locked.includes("st_news") ? <NewsView go={go} features={auth.features} /> : <RoadmapView />;
      case "pipeline": return auth.features.pl_module === true && !auth.locked.includes("pl_module") ? <PipelineModule key="pipe3" moneyFlow={auth.features.pl_money_flow === true && !auth.locked.includes("pl_money_flow")} actions={auth.features.pl_actions === true && !auth.locked.includes("pl_actions")} /> : <ModuleTabs key="pipe" start={0} tabs={pipeTabs} />;
      case "team": if ((auth.features.pp_module === true && !auth.locked.includes("pp_module")) || ppSample()) return <TeamModule key="pp3" go={go} />; return limited ? <Centered title="Not available" body="This page is switched off right now." /> : <TeamView />;
      case "appointments": return auth.features.appt_module === true && !auth.locked.includes("appt_module") ? <AppointmentsModule key="appts3" go={go} flowTree={auth.features.appt_flow_tree === true} leadership={auth.features.ap_exec === true} funnel={auth.features.bf_funnel === true && !auth.locked.includes("bf_funnel") ? { cohorts: auth.features.bf_cohorts === true, forecast: auth.features.bf_forecast === true, recover: auth.features.bf_recover === true } : null} /> : <ModuleTabs key="appts" start={0} tabs={[{ label: "Appointments", node: <AppointmentsView go={go} /> }, { label: "Insights", node: <AppointmentInsights /> }]} />;
      case "meetings": return <MeetingsView go={() => go("appointments")} logged={auth.features.mn_logged === true && !auth.locked.includes("mn_logged")} outcomes={auth.features.mn_outcomes === true && !auth.locked.includes("mn_outcomes")} list={auth.features.mn_list === true && !auth.locked.includes("mn_list")} followups={auth.features.mn_followups === true && !auth.locked.includes("mn_followups")} coach={auth.features.mn_coach === true && !auth.locked.includes("mn_coach")} />;
      // Workflows reads with the unfiltered client and keeps its own account choice (like Today), so the shared filter never changes what it counts.
      case "data-health": if (dqOn) return <DqModule key="dq" kind={auth.kind} start="overview" duplicatesOn={dqFlag("dq_dupes")} intakeOn={dqFlag("dq_intake")} fixOn={auth.features.cu_fix === true && !auth.locked.includes("cu_fix")} cleanupOn={!off("cleanup") && NAV_FOR[auth.kind].has("cleanup")} legacyHealth={<ApiProvider value={baseApi}><DataHealthView go={go} kind={auth.kind} /></ApiProvider>} />;
        if (auth.features.cu_health === true && !auth.locked.includes("cu_health")) return <CleanupModule key="dh" kind={auth.kind} start="health" duplicatesOn={!off("duplicates") && NAV_FOR[auth.kind].has("duplicates")} cleanupOn={!off("cleanup") && NAV_FOR[auth.kind].has("cleanup")} fixOn={auth.features.cu_fix === true && !auth.locked.includes("cu_fix")} healthOn legacyHealth={<ApiProvider value={baseApi}><DataHealthView go={go} kind={auth.kind} /></ApiProvider>} />;
        return <ApiProvider value={baseApi}><DataHealthView go={go} kind={auth.kind} /></ApiProvider>;
      // Money: Payments and Finance are ONE page now (Plans and churn | Client payments | Payouts). Both old addresses open it on the right tab; the code, flags and data of both stay.
      case "payments": case "finance": {
        const pmOn = (auth.features.pm_module === true && !auth.locked.includes("pm_module")) || pmSample(), fnOn = (auth.features.fn_module === true && !auth.locked.includes("fn_module")) || fnSample();
        return pmOn || fnOn ? <MoneyModule key={`money-${view.id}`} go={go} start={view.id === "finance" ? (fnOn ? "plans" : "payments") : (pmOn ? "payments" : "plans")} pmOn={pmOn} fnOn={fnOn} /> : <EmptyState title="Money is not switched on yet" body="It will appear here as soon as it is ready for your account." />;
      }
      case "workflows": return <ApiProvider value={baseApi}><WorkflowsView go={go} kind={auth.kind} /></ApiProvider>;
      case "clients": if ((auth.features.cl_module === true && !auth.locked.includes("cl_module")) || clSample()) return <ClientsModule key="cl3" go={go} features={clientFeatures} />; return <ClientsView key="clients" go={go} initialTab="health" features={clientFeatures} />;
    }
  })();

  // The agency's own colour sits on top of the tokens (N52). The page colour is made readable on the page's surface in the current theme, and the side
  // menu's mark readable on its navy, so a very dark or very pale brand colour can never make text or buttons unreadable (accentTokens, tested).
  const accent = auth.brand.color ? accentTokens(auth.brand.color, theme) : null;
  const menuAccent = auth.brand.color ? accentTokens(auth.brand.color, "dark") : null;
  const accentStyle = accent && menuAccent ? ({
    "--primary": accent.text, "--primary-foreground": accentTokens(accent.text, theme)!.onFill, "--ring": accent.text,
    "--sidebar-primary": menuAccent.text, "--sidebar-primary-foreground": accentTokens(menuAccent.text, "dark")!.onFill, "--sidebar-ring": menuAccent.text,
  } as React.CSSProperties) : undefined;
  // The freshness line is built once: on Today it sits in the top row with search and the bell, on every other page above the page.
  const strip = <StatusLine inline={view.id === "today"} />;
  const previous = trail.length > 0 ? trail[trail.length - 1] : null;
  const backLabel = previous ? (previous.id === "account" ? "the client account" : NAV.find((n) => n.id === previous.id)?.label ?? "the last page") : null;
  const back = previous && backLabel ? { label: backLabel, go: () => window.history.back() } : null;

  return (
    <ApiProvider value={api}>
      <StProvider features={auth.features}>
      <div className={`${theme === "dark" ? "dark " : ""}${(view.id === "today" || view.id === "speed") ? `today ${TODAY_FONTS} ` : ""}flex min-h-screen bg-background text-foreground`} data-theme={theme} style={accentStyle}>
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col self-start border-r border-sidebar-border bg-sidebar p-4 text-sidebar-foreground md:flex print:hidden">
          <div className="flex items-center gap-2.5 px-2 pt-1">
            <BrandLogo
              url={auth.brand.logoUrl} name={auth.brand.name ?? "SubSync"} height={36} className="max-w-full"
              fallback={<>
                {auth.brand.name ? <span aria-hidden className="flex size-8 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground"><svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h10a4 4 0 0 1 0 8H8" /><path d="M20 16H10a4 4 0 0 1 0-8h6" opacity="0.55" /></svg></span> : <ProductMark height={32} />}
                <span className="text-[1.05rem] font-semibold tracking-tight text-sidebar-accent-foreground">{auth.brand.name ?? "SubSync"}</span>
              </>}
            />
          </div>
          <nav className="sidebar-scroll mt-3 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pr-1" aria-label="Sections">
            {renderNav(mainMenu)}
          </nav>
          {footMenu.length > 0 && <nav className="mt-1 flex flex-col gap-0.5" aria-label="Settings and help">{renderNav(footMenu)}</nav>}
          <div className="mt-3 flex items-center justify-between gap-2 px-1" role="group" aria-label="Appearance">
            {THEME_PREFS.map((p) => {
              const Icon = THEME_ICON[p];
              return <button key={p} type="button" aria-pressed={themePref === p} aria-label={THEME_LABEL[p]} title={THEME_LABEL[p]} onClick={() => setThemePref(p)}
                className={`flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg text-xs ${themePref === p ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60"}`}><Icon aria-hidden className="size-4" />{p === "system" ? "Auto" : p === "dark" ? "Dark" : "Light"}</button>;
            })}
          </div>
          <div className="mt-2 flex items-center gap-2.5 border-t border-sidebar-border px-3 pt-3">
            <span className="min-w-0 text-xs leading-4"><span className="block truncate font-medium text-sidebar-accent-foreground">{auth.userName ?? "Signed in"}</span><span className="block text-sidebar-foreground/55">{auth.kind === "agency" ? "All client accounts" : auth.kind === "business" ? "Your business" : "Read-only view"}</span></span>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {auth.demo && (
            <div className="border-b border-amber-500/20 bg-amber-400/15 px-4 py-2 text-center text-xs font-medium text-amber-900 dark:text-amber-200 print:hidden" role="note">
              Demo mode: this is sample data for a fictional company, not real clients.
            </div>
          )}
          <nav className="fixed inset-x-0 bottom-0 z-30 flex gap-1 overflow-x-auto border-t bg-card p-1.5 shadow-[var(--shadow-lift)] md:hidden print:hidden" aria-label="Sections" data-testid="phone-menu">
            {menu.map((n) => (
              <StNavEntry key={n.id} id={n.id} onWarm={warmView}><button type="button" onClick={() => goTop(n.id)} aria-current={n.id === active ? "page" : undefined}
                className={`flex min-h-12 min-w-[4.5rem] shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg px-2.5 text-xs leading-tight transition-colors ${n.id === active ? "bg-accent font-semibold text-foreground" : "text-muted-foreground"}`}>
                {(() => { const Icon = ICONS[n.id]; return Icon ? <Icon aria-hidden className="size-5" /> : null; })()}
                <span className="max-w-[5.5rem] truncate">{labelFor(n)}</span>
              </button></StNavEntry>
            ))}
          </nav>
          <main className="mx-auto w-full max-w-[1800px] flex-1 p-4 pb-24 sm:px-10 sm:py-8 md:pb-8">
            {fromAccount && view.id !== "today" && (
              <InlineAlert className="mb-3" action={<Btn variant="ghost" onClick={() => { setFilter(EMPTY_FILTER); try { window.history.replaceState(null, "", withTodayAccounts(window.location.hash, [])); window.dispatchEvent(new Event("subsync-today-accounts")); } catch { /* see above */ } }}>See all client accounts</Btn>}>
                You opened this from inside a client account, so every page shows only that account.
              </InlineAlert>
            )}
            {back && <BackLink label={back.label} onClick={back.go} />}
            {/* One slim row above every page: which client accounts are counted on the left, search and notifications on the right (D1; was four stacked blocks). */}
            <div className="mb-3 flex flex-wrap items-start gap-x-4 gap-y-1 print:hidden" data-testid="toolbar">
              <div className="min-w-0 flex-1">
                {/* On Today the quiet freshness line sits here, in the one row with search and the bell (the page below draws its own account filter and "Showing" chip). */}
                {view.id === "today" && strip}
              </div>
              <div className="ml-auto flex shrink-0 items-center">
                {auth.kind !== "client" ? <div className="mr-2"><SyncNow agency={auth.kind === "agency" && Boolean(baseApi)} /></div> : <div className="mr-2"><LiveStatus /></div>}
                <GuideHelpButton view={view.id} go={go} />
                {NAV_FOR[auth.kind].has("search") && !off("search") && <GlobalSearch go={go} />}
                <NotificationBell go={go} />
              </div>
            </div>
                            {/* ONE filter bar for every page with numbers (KF-11): accounts (agency) and dates, always open. Today keeps its own account choice (ta=) but the bar edits it. */}
                <ApiProvider value={baseApi ?? api}><GlobalFilterBar view={view.id === "meetings" && auth.features.mn_list === true && !auth.locked.includes("mn_list") ? "meetings-list" : view.id} agency={auth.kind === "agency" && Boolean(baseApi)} value={filter} onChange={setFilter}
                  onAllClients={fromAccount ? () => { setFilter(EMPTY_FILTER); try { window.history.replaceState(null, "", withTodayAccounts(window.location.hash, [])); window.dispatchEvent(new Event("subsync-today-accounts")); } catch { /* the filter is cleared anyway */ } } : undefined} /></ApiProvider>
            {trailSection && <p data-testid="trail" className="mb-2 text-sm max-sm:hidden font-medium text-muted-foreground print:hidden">{trailSection} <span aria-hidden>&gt;</span><span className="sr-only">then</span> {NAV.find((n) => n.id === shown)?.label ?? ""}</p>}
            {view.id !== "today" && strip}<BackProvider value={back}><TrailProvider value={trailSection}>{content}</TrailProvider></BackProvider>
            <FeedbackBox page={view.id} />
          </main>
        </div>
      </div>
      <LeadDrawerHost />
      </StProvider>
    </ApiProvider>
  );
}

const THEME_ICON: Record<ThemePref, LucideIcon> = { dark: Moon, light: Sun, system: Monitor };
const THEME_LABEL: Record<ThemePref, string> = { dark: "Dark appearance", light: "Light appearance", system: "Match my device" };

const ICONS: Record<string, LucideIcon> = {
  today: Sun, myday: Sun, people: UsersRound, audit: ClipboardCheck, speed: Zap, overview: LayoutDashboard, inbox: Inbox, appointments: CalendarCheck, meetings: Mic, search: Search, pipeline: Kanban, leads: Target, calls: PhoneCall,
  accounts: Briefcase, clients: UserRound, team: Users, onboarding: Wrench, duplicates: Copy, cleanup: Eraser, settings: Settings, connections: Plug, help: CircleHelp, roadmap: Sparkles, workflows: Workflow, payments: CreditCard, finance: Landmark, "data-health": ClipboardCheck,
};

function Centered({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8 text-foreground">
      <div className="max-w-md space-y-3 text-center">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm leading-6 text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}
