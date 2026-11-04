"use client";

import { IntegrationsContent } from "./connections";

// "My connections" and "Team connections" (a person's own Fathom, what the team has connected, Slack and the rules), drawn at the top of Settings, Integrations,
// above the permissions list. Before 4 Nov 2026 they had a menu entry of their own (Connections); the screens are the same, only their home moved.
export function ConnectionsSlot() {
  return <IntegrationsContent nested />;
}
