"use client";

import { useState } from "react";
import { filterToParams } from "@/lib/people/filters";
import { ModuleTabs, Page as PageShell } from "../ds";
import { remember } from "../ds/remember";
import { useData } from "../session";
import { FindTab } from "./people-find";
import { GoingColdTab, SourcesTab, TagsTab } from "./people-more";
import type { Options } from "./people-filters";

// The People module: find a person, or work the call lists (the first tab), and three tabs for what is in your list: Tags, Going cold and Sources. The first tab is the page.
// `start` is the old address that opened it: #people and #search open Find and call, #calls opens it too (the call lists are its main part now), #leads opens Going cold.

export { toSeed, type PersonUi } from "./people-rows";

const TABS = ["Find and call", "Tags", "Going cold", "Sources"] as const;

export function PeopleModule({ start = 0 }: { start?: number; callsAllowed?: boolean }) {
  // The old numbering: 0 search, 1 call lists, 2 leads. Both of the first two are the first tab now; 2 is Going cold.
  const [tab, setTab] = useState(start === 2 ? 2 : 0);
  // Following a tag's day to the people tagged then replaces the choices of the first tab, which is then started afresh.
  const [findKey, setFindKey] = useState(0);
  const opts = useData<Options>("people/options");
  const showAccount = !(opts.data?.singleAccount ?? false);
  const seeAll = (tag: string, day: string) => {
    remember("people-filter", JSON.stringify(Object.fromEntries(filterToParams({ tags: [tag], seenFrom: day, seenTo: day }).entries())));
    setFindKey((k) => k + 1);
    setTab(0);
    window.scrollTo({ top: 0 });
  };
  return (
    <PageShell title="Find a lead" subtitle={!opts.data ? undefined : showAccount ? "Find anyone across your client accounts, and call the people who need it most." : "Find anyone in your account, and call the people who need it most."}>
      <ModuleTabs value={tab} onChange={setTab} label="People" tabs={[
        { label: TABS[0], node: <FindTab key={findKey} /> },
        { label: TABS[1], node: <TagsTab showAccount={showAccount} onSeeAll={seeAll} /> },
        { label: TABS[2], node: <GoingColdTab showAccount={showAccount} /> },
        { label: TABS[3], node: <SourcesTab /> },
      ]} />
    </PageShell>
  );
}
