"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { HUB_SECTIONS, isHubSection, searchSettings, type HubSectionId } from "@/lib/settings2";
import { SETTINGS_SECTION_KEY } from "@/lib/settings-sections";
import { remember, remembered } from "../ds/remember";
import type { GoFn } from "../nav";
import { useData } from "../session";
import { Btn, Card, ErrorBox, Loading, PageHeader, inputClass } from "../ui";
import { SettingsView } from "./settings";
import { SaleBasisSettings } from "./sale-basis-settings";
import { ConnectionsSection, HelpSection, ModulesSection, PermissionsSection, PlanCard, ReadOnlyNote, SafetySection, type Home } from "./settings-hub-parts";

const KEY = "settings-hub-section";
// The older section a link asked for (other pages remember it before opening Settings) and the section that holds it now.
const FROM_OLD: Record<string, HubSectionId> = { notifications: "alerts", integrations: "connections", privacy: "data", sync: "data", advanced: "data", brand: "account", targets: "targets", team: "team" };
const phoneQuery = "(max-width: 767px)";
const usePhone = () => useSyncExternalStore((cb) => { const m = window.matchMedia(phoneQuery); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); }, () => window.matchMedia(phoneQuery).matches, () => false);

// Settings in ten plain sections: a list on the left (an accordion on a phone), a search box on top. The older form is reused for the sections that hold fields, so every
// control keeps its meaning and its checked server route; the new parts are the plan, connections, permissions, modules, safety and help.
export function SettingsHub({ go, features, openOld }: { go: GoFn; features: Record<string, boolean>; openOld?: string }) {
  const { data: home, error, loading, reload } = useData<Home>("st/home");
  const phone = usePhone();
  const [picked, setPicked] = useState<HubSectionId>(() => { const o = remembered(SETTINGS_SECTION_KEY); if (o && FROM_OLD[o]) { remember(SETTINGS_SECTION_KEY, null); remember(KEY, FROM_OLD[o]); return FROM_OLD[o]; } const r = remembered(KEY); return isHubSection(r) ? r : "account"; });
  const [q, setQ] = useState("");
  // An old address (#connections) asks for the Connections section.
  useEffect(() => { if (openOld === "integrations") { setPicked("connections"); remember(KEY, "connections"); } }, [openOld]);
  if (loading && !home) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!home) return null;
  const choose = (id: HubSectionId, then?: string) => {
    setPicked(id); remember(KEY, id); setQ("");
    if (then) setTimeout(() => document.getElementById(then)?.scrollIntoView({ block: "start", behavior: "smooth" }), 80);
  };
  const section = HUB_SECTIONS.find((s) => s.id === picked) ?? HUB_SECTIONS[0];
  const hits = searchSettings(q);
  // Sections that hold fields are for people who may change settings; everyone else reads them.
  const forms = section.old.length > 0;
  const body = (
    <div className="min-w-0 space-y-4" data-testid={`hub-${section.id}`}>
      <div><h2 className="text-lg font-semibold tracking-tight">{section.title}</h2><p className="text-sm text-muted-foreground">{section.hint}</p></div>
      {forms && !home.canManage && <ReadOnlyNote />}
      {section.id === "account" && <PlanCard home={home} />}
      {section.id === "connections" && <ConnectionsSection />}
      {section.id === "permissions" && <PermissionsSection />}
      {section.id === "modules" && <ModulesSection features={features} />}
      {section.id === "safety" && <SafetySection />}
      {section.id === "team" && <Card title="Roles"><p className="text-sm text-muted-foreground">Give each person a label (Setter, Closer, Both, Support, Manager). Labels are kept only in SubSync and are never sent to your CRM.</p><div className="mt-2"><Btn onClick={() => go("team")}>Open Team</Btn></div></Card>}
      {section.id === "data" && (
        <Card title="History">
          <p className="text-sm" data-testid="history-start">{home.since ? `SubSync has kept history for you since ${new Date(home.since).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}.` : "History starts with your first sync."}</p>
          <p className="mt-1 text-xs text-muted-foreground">History cannot be rebuilt later, so SubSync records changes from the day you connect.</p>
        </Card>
      )}
      {section.id === "help" && <HelpSection go={() => go("help")} />}
      {/* Everyone who may open Settings sees how a sale is counted; only the owner or an administrator can change it (the card says so). */}
      {section.id === "targets" && features.appt_booking_share !== false && <div id="sale-basis-card" data-testid="hub-sale-basis"><SaleBasisSettings /></div>}
      {/* One form, always mounted, drawn only for the sections that hold fields; a change in one section is kept while you look at another. */}
      <div hidden={!forms || !home.canManage}><SettingsView embedded={home.canManage ? [...section.old] : []} /></div>
    </div>
  );
  return (
    <div className="max-w-6xl">
      <PageHeader title="Settings" subtitle="Everything in ten sections. Search for a setting, or pick a section." />
      <div className="mb-5 max-w-md">
        <label htmlFor="hub-search" className="sr-only">Search settings</label>
        <input id="hub-search" type="search" className={inputClass} placeholder="Search settings, for example: Slack, quiet hours, delete" value={q} onChange={(e) => setQ(e.target.value)} data-testid="hub-search" />
        {q.trim() && (
          <ul className="mt-2 divide-y rounded-lg border bg-card text-sm" data-testid="hub-results" aria-label="Search results">
            {hits.length === 0 ? <li className="px-3 py-3 text-muted-foreground">Nothing matches. Try another word, or pick a section.</li> : hits.map((h) => (
              <li key={h.id}><button type="button" className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted" onClick={() => choose(h.section, h.id === "sale" ? "sale-basis-card" : undefined)}><span>{h.label}</span><span className="text-xs text-muted-foreground">{HUB_SECTIONS.find((s) => s.id === h.section)?.title}</span></button></li>
            ))}
          </ul>
        )}
      </div>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-[15rem_minmax(0,1fr)]">
        <nav aria-label="Settings sections" data-testid="hub-nav" className="space-y-1">
          {HUB_SECTIONS.map((s) => (
            <div key={s.id}>
              <button type="button" onClick={() => choose(s.id)} aria-current={s.id === picked ? "page" : undefined} aria-expanded={phone ? s.id === picked : undefined}
                className={`flex min-h-11 w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[0.95rem] transition-colors ${s.id === picked ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"}`}>
                <span>{s.title}</span>{phone && <span aria-hidden>{s.id === picked ? "−" : "+"}</span>}
              </button>
              {phone && s.id === picked && <div className="px-1 py-3">{body}</div>}
            </div>
          ))}
        </nav>
        {!phone && body}
      </div>
    </div>
  );
}
