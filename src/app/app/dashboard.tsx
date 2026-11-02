"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { accentTokens } from "@/lib/design/color";
import { EMPTY_FILTER, filterFromLink, filterToLink, filterToQuery, isFiltered, type FilterValue } from "@/lib/design/filters";
import { buildHash, parseHash, type ViewState } from "@/lib/design/route";
import { rangesOf } from "@/lib/design/range";
import { THEME_PREFS, type ThemePref } from "@/lib/design/ui-logic";
import { NAV_FOR, type AccessKind } from "@/lib/access";
import {
  Briefcase, CalendarCheck, ClipboardCheck, Zap, CircleHelp, Copy, Eraser, Inbox, Kanban, LayoutDashboard, Mic, Monitor, Moon, PhoneCall, Plug, Search, Settings, Sun, Target, UserRound, Users, Wrench, type LucideIcon,
  Sparkles, UsersRound,
} from "lucide-react";
import { NAV, PARENT, type GoFn, type ViewId } from "./nav";
import { useBrandedText } from "./brand-text";
import { Btn } from "./ui";
import { FeedbackBox } from "./feedback-box";
import { BackLink, BackProvider, ModuleTabs, type ModuleTab } from "./ds/template";
import { InlineAlert } from "./ds/alert";
import { FilterDrawer } from "./ds/filters";
import { useTheme } from "./ds/theme";
import { remember, remembered } from "./ds/remember";
import { MyDayView } from "./ds/my-day";
import { ApiProvider, makeApi, type Api } from "./session";
import { AccountDetailView } from "./views/account-detail";
import { AlertsView } from "./views/alerts";
import { AppointmentInsights } from "./views/appointment-insights";
import { AuditView } from "./views/audit";
import { SpeedView } from "./views/speed";
import { AppointmentsView } from "./views/appointments";
import { CleanupView } from "./views/cleanup";
import { MeetingsView } from "./views/meetings";
import { GlobalSearch } from "./views/global-search";
import { PeopleModule } from "./views/people-module";
import { ClientsView, type ClientsFeatures } from "./views/clients";
import { DealsView } from "./views/deals";
import { DuplicatesView } from "./views/duplicates";
import { EmailHealthView } from "./views/email-health";
import { HelpView } from "./views/help";
import { RoadmapView } from "./views/roadmap";
import { FreshnessStrip as StatusLine } from "./views/sync-status";
import { InboxView } from "./views/inbox";
import { OnboardingView } from "./views/onboarding";
import { OverviewView } from "./views/overview";
import { PipelineView } from "./views/pipeline";
import { DealMoves, TeamView } from "./views/people";
import { SettingsView } from "./views/settings";
import { ConnectionsPage } from "./views/connections";
import { TodayView } from "./views/today";

type Auth =
  | { status: "waiting" }
  | { status: "outside" }
  | { status: "error"; message: string }
  | { status: "not_installed" }
  | { status: "maintenance"; message: string }
  | { status: "ready"; api: Api; demo: boolean; userName: string | null; features: Record<string, boolean>; locked: string[]; kind: AccessKind; locationId: string | null; brand: { name: string | null; color: string | null } };

type SsoResponse = {
  error?: string;
  installed?: boolean;
  maintenance?: boolean;
  demo?: boolean;
  session?: string;
  kind?: AccessKind;
  user?: { userName?: string | null; activeLocation?: string | null };
  entitlements?: { features: Record<string, boolean>; locked?: string[] };
  brand?: { name: string | null; color: string | null };
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

// `?as=business` or `?as=client` opens the demo as a single business or as a client's staff.
// Only demo mode honours it; real sign-in decides the view from the host's user context.
function demoView(): "business" | "client" | undefined {
  if (typeof window === "undefined") return undefined;
  const as = new URLSearchParams(window.location.search).get("as");
  return as === "business" || as === "client" ? as : undefined;
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
    const scoped = next.id === "today" && next.locationId ? { ...EMPTY_FILTER, accounts: [next.locationId] } : null;
    const target: { id: ViewId; locationId?: string } = scoped ? { id: "today" } : next;
    if (!scoped && here.id === next.id && (here.locationId ?? "") === (next.locationId ?? "")) { window.scrollTo({ top: 0 }); return; }
    // The entry being left keeps its own filter in its address (a remembered filter is not in the address yet), so Back lands on the same numbers.
    try { window.history.replaceState(null, "", buildHash(here, filterRef.current, rangesOf(window.location.hash))); } catch { /* see below */ }
    setTrail((t) => (keepTrail ? [...t, here].slice(-12) : []));
    setViewState(target);
    if (scoped) { setFilterState(scoped); filterRef.current = scoped; }
    try { window.history.pushState(null, "", buildHash(target, scoped ?? filterRef.current)); } catch { /* a frame that forbids it: the screen still changes */ }
    window.scrollTo({ top: 0 });
  }, []);
  const go: GoFn = useCallback((id, locationId) => move({ id, locationId }, true), [move]);
  const goTop: GoFn = useCallback((id, locationId) => move({ id, locationId }, false), [move]);
  const setFilter = useCallback((f: FilterValue) => {
    setFilterState(f);
    remember("filter", isFiltered(f) ? filterToLink(f) : null);
    try { window.history.replaceState(null, "", buildHash(viewRef.current, f, rangesOf(window.location.hash))); } catch { /* see above */ }
  }, []);
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
  useEffect(() => {
    if (auth.status !== "ready" || launched.current) return;
    launched.current = true;
    if (auth.kind === "agency" && auth.locationId && !window.location.hash) {
      const only = { ...EMPTY_FILTER, accounts: [auth.locationId] };
      // Not remembered: the next time SubSync is opened from the agency menu it must show every client account again.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFilterState(only);
      try { window.history.replaceState(null, "", buildHash({ id: "today" }, only)); } catch { /* the screen still narrows */ }
    }
  }, [auth]);
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
  // Features that are switched off (flags) are not shown at all.
  // Switched off for everyone: not shown. Locked by plan: shown with a Pro note, and the page explains.
  const locked = (feature: string) => auth.locked.includes(feature);
  const off = (feature: string) => auth.features[feature] === false && !locked(feature);
  // A page that lives inside a module as a tab (People holds Contact search, Leads and Call lists) has no menu entry of its own.
  // (A page that lives inside the Clients module has no entry of its own for an agency; a business and a client's staff have no Clients module, so their Setup stays in their menu.)
  const menu = NAV.filter((n) => NAV_FOR[auth.kind].has(n.id) && !off(n.feature) && (!n.parent || (limited && n.showWhenLimited)));
  // The sidebar: the pilot menu in plain groups that scroll, and Settings, Getting started and What's new pinned underneath so they are always visible.
  const mainMenu = menu.filter((n) => n.group !== "Settings and help");
  const footMenu = menu.filter((n) => n.group === "Settings and help");
  const renderNav = (list: typeof menu) => list.map((n, i) => (
      <div key={n.id}>
        {n.group !== (list[i - 1]?.group ?? null) && (n.group && n.group !== "Settings and help" ? <p className="px-3 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/70">{n.group}</p> : <div className="my-2 border-t border-sidebar-border" />)}
        <button type="button" onClick={() => goTop(n.id)} aria-current={n.id === active ? "page" : undefined}
          className={`group relative flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left text-[0.86rem] transition-colors ${n.id === active ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"}`}>
          {n.id === active && <span aria-hidden className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-sidebar-primary" />}
          {(() => { const Icon = ICONS[n.id]; return Icon ? <Icon aria-hidden className={`size-[17px] shrink-0 ${n.id === active ? "text-sidebar-primary" : "opacity-70 group-hover:opacity-100"}`} /> : null; })()}
          <span className="flex-1">{labelFor(n)}</span>
          {locked(n.feature) && <span className="text-[10px] font-semibold uppercase tracking-wide text-sidebar-primary">Pro</span>}
        </button>
      </div>
  ));
  const labelFor = (n: (typeof NAV)[number]) => (limited && n.id === "overview" ? "My account" : n.label);
  // Pages that live inside another page highlight their parent in the menu.
  const shown: ViewId = auth.kind === "client" && view.id === "today" ? "myday" : view.id;
  const active = limited && shown === "onboarding" ? shown : PARENT[shown] ?? shown;
  const agency = auth.demo ? "Demo Company" : limited ? "Your business" : "Your company";
  const own = auth.locationId;

  // People: one module for finding contacts. Its tabs are the pages that used to be separate menu entries (nothing was removed); stage F10 grows it.
  // F10: Search and filters, Smart lists (with the built-in call lists), Going cold, Imports and sources. The old Contact search, Leads and Call lists addresses open the matching tab.
  const peopleOn = NAV_FOR[auth.kind].has("search") && !off("search");
  const callsAllowed = NAV_FOR[auth.kind].has("calls") && !off("calls") && !locked("calls");
  const peopleStart = view.id === "calls" ? 1 : view.id === "leads" ? 2 : 0;
  const pipeTabs = [{ label: "Forecast and stages", node: <><PipelineView /><DealMoves /></> }, { label: "Stale deals and hygiene", node: <DealsView /> }];
  // A business or a client's staff keep the small Setup module (their own checklist and email sending). An agency has the Clients module instead.
  const setupTabs = [{ label: "Setup checklists", node: <OnboardingView go={go} /> }, { label: "Email sender health", node: <EmailHealthView /> }];
  const clientFeatures: ClientsFeatures = { health: !off("health"), onboarding: !off("onboarding"), clients: !off("clients"), reports: !off("reports"), setupCompare: !off("setup_compare"), playbooks: !off("playbooks") };

  const content = (() => {
    // A business or a client sees its own account as the home page, never an accounts list.
    if (limited) {
      const id = view.id === "account" ? "overview" : view.id === "today" && auth.kind === "client" ? "myday" : view.id;
      if (!NAV_FOR[auth.kind].has(id)) return <Centered title="Not available" body="This page is not part of your view of SubSync." />;
      // A page that is switched off is switched off for a business too (the menu already leaves it out; this covers a typed address).
      const pageFeature = NAV.find((n) => n.id === id)?.feature;
      if (pageFeature && off(pageFeature)) return <Centered title="Not available" body="This page is switched off right now." />;
      if (id === "myday") return <MyDayView go={go} />;
      if (id === "overview") return own ? <AccountDetailView key={own} locationId={own} go={go} agency={agency} limited /> : <Centered title="Open SubSync from inside your account" body="We could not tell which account you are in." />;
    }
    const feature = NAV.find((n) => n.id === view.id)?.feature;
    if (feature && off(feature)) return <Centered title="Not available" body="This page is switched off right now." />;
    if (feature && locked(feature)) return <Centered title="Part of the paid plan" body="This page is included in the Pro plan. Ask whoever manages your SubSync plan to upgrade, and it appears here straight away." />;
    switch (view.id) {
      case "today": return <TodayView go={go} />;
      case "myday": return <MyDayView go={go} />;
      case "people": case "search": case "leads": case "calls": return peopleOn ? <PeopleModule key={"people" + peopleStart} start={peopleStart} callsAllowed={callsAllowed} /> : <Centered title="Not available" body="This page is switched off right now." />;
      case "audit": return <AuditView go={go} />;
      case "speed": return <SpeedView go={go} />;
      case "overview": return <OverviewView go={go} />;
      case "accounts": return <ClientsView key="accounts" go={go} initialTab="health" features={clientFeatures} />;
      case "account": return view.locationId ? <AccountDetailView key={view.locationId} locationId={view.locationId} go={go} agency={agency} /> : <ClientsView key="accounts" go={go} initialTab="health" features={clientFeatures} />;
      case "deals": return <ModuleTabs key="pipe" start={1} tabs={pipeTabs} />;
      case "inbox": return <InboxView go={go} />;
      case "onboarding": return limited ? <ModuleTabs key="setup" start={0} tabs={setupTabs} /> : <ClientsView key="onboarding" go={go} initialTab="onboarding" features={clientFeatures} />;
      case "email": return limited ? <ModuleTabs key="setup" start={1} tabs={setupTabs} /> : <EmailHealthView />;
      case "duplicates": return <DuplicatesView />;
      case "alerts": return <AlertsView go={go} />;
      case "settings": return <SettingsView />;
      case "connections": return <ConnectionsPage />;
      case "help": return <HelpView go={go} />;
      case "roadmap": return <RoadmapView />;
      case "pipeline": return <ModuleTabs key="pipe" start={0} tabs={pipeTabs} />;
      case "team": return <TeamView />;
      case "appointments": return <ModuleTabs key="appts" start={0} tabs={[{ label: "Appointments", node: <AppointmentsView go={go} /> }, { label: "Insights", node: <AppointmentInsights /> }]} />;
      case "meetings": return <MeetingsView />;
      case "cleanup": return <CleanupView />;
      case "clients": return <ClientsView key="clients" go={go} initialTab="health" features={clientFeatures} />;
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
  const previous = trail.length > 0 ? trail[trail.length - 1] : null;
  const backLabel = previous ? (previous.id === "account" ? "the client account" : NAV.find((n) => n.id === previous.id)?.label ?? "the last page") : null;
  const back = previous && backLabel ? { label: backLabel, go: () => window.history.back() } : null;

  return (
    <ApiProvider value={api}>
      <div className={`${theme === "dark" ? "dark " : ""}flex min-h-screen bg-background text-foreground`} data-theme={theme} style={accentStyle}>
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col self-start border-r border-sidebar-border bg-sidebar p-4 text-sidebar-foreground md:flex print:hidden">
          <div className="flex items-center gap-2.5 px-2 pt-1">
            <span aria-hidden className="flex size-8 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground"><svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h10a4 4 0 0 1 0 8H8" /><path d="M20 16H10a4 4 0 0 1 0-8h6" opacity="0.55" /></svg></span>
            <span className="text-[1.05rem] font-semibold tracking-tight text-sidebar-accent-foreground">{auth.brand.name ?? "SubSync"}</span>
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
          <nav className="flex gap-1 overflow-x-auto border-b p-2 md:hidden print:hidden" aria-label="Sections">
            {menu.map((n) => (
              <button key={n.id} type="button" onClick={() => goTop(n.id)} aria-current={n.id === active ? "page" : undefined}
                className={`shrink-0 border-b-2 px-3 py-2 text-sm transition-colors ${n.id === active ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground"}`}>{labelFor(n)}</button>
            ))}
          </nav>
          <main className="mx-auto w-full max-w-[1400px] flex-1 p-4 sm:px-10 sm:py-8">
            {fromAccount && (
              <InlineAlert className="mb-3" action={<Btn variant="ghost" onClick={() => setFilter(EMPTY_FILTER)}>See all client accounts</Btn>}>
                You opened this from inside a client account, so every page shows only that account.
              </InlineAlert>
            )}
            {auth.kind === "agency" && baseApi && !fromAccount && <ApiProvider value={baseApi}><FilterDrawer kind="agency" value={filter} onChange={setFilter} /></ApiProvider>}
            {back && <BackLink label={back.label} onClick={back.go} />}
            {NAV_FOR[auth.kind].has("search") && !off("search") && <GlobalSearch go={go} />}
            <StatusLine /><BackProvider value={back}>{content}</BackProvider>
            <FeedbackBox page={view.id} />
          </main>
        </div>
      </div>
    </ApiProvider>
  );
}

const THEME_ICON: Record<ThemePref, LucideIcon> = { dark: Moon, light: Sun, system: Monitor };
const THEME_LABEL: Record<ThemePref, string> = { dark: "Dark appearance", light: "Light appearance", system: "Match my device" };

const ICONS: Record<string, LucideIcon> = {
  today: Sun, myday: Sun, people: UsersRound, audit: ClipboardCheck, speed: Zap, overview: LayoutDashboard, inbox: Inbox, appointments: CalendarCheck, meetings: Mic, search: Search, pipeline: Kanban, leads: Target, calls: PhoneCall,
  accounts: Briefcase, clients: UserRound, team: Users, onboarding: Wrench, duplicates: Copy, cleanup: Eraser, settings: Settings, connections: Plug, help: CircleHelp, roadmap: Sparkles,
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
