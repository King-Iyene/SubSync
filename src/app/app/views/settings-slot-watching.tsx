"use client";

import { WatchingPanel } from "./watching-panel";

// "What SubSync watches" (Watching and Not yet columns, N5), built by stage F5. It sits at the top of Settings, Sync status, above the sync panel.
export function WatchingSlot() {
  return <WatchingPanel />;
}
