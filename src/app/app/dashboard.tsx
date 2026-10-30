"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { NAV, type GoFn, type ViewId } from "./nav";
import { ApiProvider, makeApi, type Api } from "./session";
import { Badge } from "./ui";
import { AccountDetailView } from "./views/account-detail";
import { AccountsView } from "./views/accounts";
import { AlertsView } from "./views/alerts";
import { CallsView } from "./views/calls";
import { ClientsView } from "./views/clients";
import { DealsView } from "./views/deals";
import { DuplicatesView } from "./views/duplicates";
import { EmailHealthView } from "./views/email-health";
import { HelpView } from "./views/help";
import { FreshnessStrip } from "./views/health-card";
import { InboxView } from "./views/inbox";
import { OnboardingView } from "./views/onboarding";
import { LeadsView } from "./views/leads";
import { OverviewView } from "./views/overview";
import { PipelineView } from "./views/pipeline";
import { SearchView } from "./views/search";
import { SettingsView } from "./views/settings";

type Auth =
  | { status: "waiting" }
  | { status: "outside" }
  | { status: "error"; message: string }
  | { status: "not_installed" }
  | { status: "ready"; api: Api; demo: boolean; userName: string | null; features: Record<string, boolean> };

type SsoResponse = {
  error?: string;
  installed?: boolean;
  demo?: boolean;
  session?: string;
  user?: { userName?: string | null };
  entitlements?: { features: Record<string, boolean> };
};

async function exchange(body: unknown): Promise<{ ok: boolean; status: number; data: SsoResponse }> {
  const res = await fetch("/api/sso", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { ok: res.ok, status: res.status, data: (await res.json().catch(() => ({}))) as SsoResponse };
}

// `/app#deals` or `/app#account=<id>` opens that view first. Handy for demos and screenshots;
// the signed-in session is still required to see any data.
function viewFromHash(): { id: ViewId; locationId?: string } {
  if (typeof window === "undefined") return { id: "overview" };
  const hash = window.location.hash.slice(1);
  if (hash.startsWith("account=") && hash.length > 8) return { id: "account", locationId: decodeURIComponent(hash.slice(8)) };
  const match = NAV.find((n) => n.id === hash);
  return { id: match ? match.id : "overview" };
}

export function Dashboard() {
  const [auth, setAuth] = useState<Auth>({ status: "waiting" });
  const [view, setView] = useState<{ id: ViewId; locationId?: string }>(viewFromHash);
  // Embedded in the host page: ask the parent who the user is. Assume embedded during server
  // render so the first paint matches.
  const embedded = useSyncExternalStore(() => () => {}, () => window.parent !== window, () => true);
  const pending = useRef<((payload: string | null) => void) | null>(null);
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
        userName: r.data.user?.userName ?? null, features: r.data.entitlements?.features ?? {},
      });
      return r.data.session;
    }
    setAuth({ status: "error", message: r.data.error ?? "Could not sign you in." });
    return null;
  }, []);

  // Ask the host page for fresh encrypted user context and exchange it for a session.
  const signIn = useCallback(async (): Promise<string | null> => {
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
    if (!payload) {
      // The host did not answer. With demo mode on (never in production) show sample data
      // instead of dead-ending, which also covers previews that frame the page.
      const demo = await exchange({ demo: true }).catch(() => null);
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
      void exchange({ demo: true }).then((r) => {
        if (r.ok) apply(r);
        else setAuth({ status: "outside" });
      }).catch(() => setAuth({ status: "outside" }));
    } else {
      // signIn only sets state after awaiting the host page's reply, never synchronously.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void signIn();
    }
    return () => window.removeEventListener("message", onMessage);
  }, [embedded, apply, signIn]);

  const go: GoFn = useCallback((id, locationId) => {
    setView({ id, locationId });
    window.scrollTo({ top: 0 });
  }, []);

  // The API client asks for a fresh session through this when a request comes back 401.
  useEffect(() => {
    refreshRef.current = () => (embedded ? signIn() : exchange({ demo: true }).then(apply));
  }, [embedded, signIn, apply]);

  const api = auth.status === "ready" ? auth.api : null;

  if (auth.status === "waiting") return <Centered title="Loading SubSync" body="Checking your account..." />;
  if (auth.status === "outside") {
    return <Centered title="Open SubSync from your account menu" body="This page is built to run inside your account. Open SubSync from the left menu of one of your client accounts." />;
  }
  if (auth.status === "not_installed") {
    return <Centered title="SubSync is not set up for this agency yet" body="Install SubSync from the app marketplace for your agency, then open it again from the menu." />;
  }
  if (auth.status === "error" || !api) {
    return <Centered title="We could not sign you in" body={auth.status === "error" ? auth.message : "Please refresh."} />;
  }

  const active = view.id === "account" ? "accounts" : view.id;
  const locked = (feature: string) => auth.features[feature] === false;
  const agency = auth.demo ? "Demo Agency" : "Your agency";

  const content = (() => {
    switch (view.id) {
      case "overview": return <OverviewView go={go} />;
      case "accounts": return <AccountsView go={go} />;
      case "account": return view.locationId ? <AccountDetailView key={view.locationId} locationId={view.locationId} go={go} agency={agency} /> : <AccountsView go={go} />;
      case "search": return <SearchView />;
      case "deals": return <DealsView />;
      case "inbox": return <InboxView />;
      case "onboarding": return <OnboardingView go={go} />;
      case "email": return <EmailHealthView />;
      case "duplicates": return <DuplicatesView />;
      case "alerts": return <AlertsView go={go} />;
      case "settings": return <SettingsView />;
      case "help": return <HelpView go={go} />;
      case "pipeline": return <PipelineView />;
      case "leads": return <LeadsView />;
      case "calls": return <CallsView />;
      case "clients": return <ClientsView />;
    }
  })();

  return (
    <ApiProvider value={api}>
      <div className="flex min-h-screen bg-background text-foreground">
        <aside className="hidden w-60 shrink-0 flex-col border-r p-4 md:flex print:hidden">
          <p className="px-2 text-lg font-semibold tracking-tight">SubSync</p>
          <nav className="mt-6 flex flex-col gap-0.5" aria-label="Sections">
            {NAV.map((n) => (
              <button key={n.id} type="button" onClick={() => go(n.id)} aria-current={n.id === active ? "page" : undefined}
                className={`flex items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors ${n.id === active ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"}`}>
                {n.label}
                {locked(n.feature) && <Badge tone="info">Paid</Badge>}
              </button>
            ))}
          </nav>
          <p className="mt-auto px-2 pt-6 text-xs text-muted-foreground">{auth.userName ? `Signed in as ${auth.userName}` : "Signed in"}</p>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {auth.demo && (
            <div className="border-b bg-amber-500/10 px-4 py-2 text-center text-xs text-amber-800 dark:text-amber-200 print:hidden" role="note">
              Demo mode: this is sample data for a fictional agency, not real clients.
            </div>
          )}
          <nav className="flex gap-1 overflow-x-auto border-b p-2 md:hidden print:hidden" aria-label="Sections">
            {NAV.map((n) => (
              <button key={n.id} type="button" onClick={() => go(n.id)} aria-current={n.id === active ? "page" : undefined}
                className={`shrink-0 rounded-full px-3 py-1 text-sm ${n.id === active ? "bg-muted font-medium" : "text-muted-foreground"}`}>{n.label}</button>
            ))}
          </nav>
          <main className="flex-1 p-4 sm:p-8"><FreshnessStrip />{content}</main>
        </div>
      </div>
    </ApiProvider>
  );
}

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
