"use client";

// SLOT for stage F5: "What SubSync watches" (Watching and Not yet columns, N5). Stage F5 builds `watching-panel.tsx` and replaces the body of this function with
// `return <WatchingPanel />;` (import it from "./watching-panel"). It sits at the top of Settings, Sync status, above the sync panel. Until then it draws nothing,
// so the page does not claim anything that is not built.
export function WatchingSlot() {
  return null;
}
