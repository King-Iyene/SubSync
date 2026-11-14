import type { Mode } from "./runner";

export type WbDeal = { id: string; name: string | null; pipelineId: string | null; pipelineName: string | null; stageId: string | null; stageName: string | null; value: number; status: string; ownerId: string | null };
export type WbDealExtra = { source: string | null; lostReason: string | null; createdAt: string | null; stageSince: string | null; statusSince: string | null; lastActivityAt: string | null; usualP75Days: number | null; stays: number };
export type WbContext = {
  mode: Mode; canDelete: boolean; name: string; dnd: boolean; phone: string | null; email: string | null; hasConversation: boolean; timeZone?: string | null; crmUrl?: string; dealsUrl?: string;
  tags: string[]; fields: { firstName: string; lastName: string; email: string; phone: string }; ownerId: string | null; ownerName: string | null; usersNeedPermission?: boolean; locationName: string | null;
  users: Array<{ id: string; name: string }>; deals: WbDeal[]; dealExtra?: Record<string, WbDealExtra>; lastConversation?: { at: string; channel: string | null; by: "you" | "them" | null } | null; appointments: Array<{ id: string; title: string; status: string | null; at: string | null; calendar?: string | null; assignedTo?: string | null }>;
  pipelines: Array<{ id: string; name: string; stages: Array<{ id: string; name: string }> }>; /** Deals per pipeline in this account, to pick the usual one for a new deal. */ pipelineUse?: Record<string, number>; me: string | null;
  templates: Array<{ id: string; label: string; channel: string; subject: string | null; text: string }>;
  /** Sending rules for this account (null before the server answers). */
  send?: { enabled: boolean; killed: boolean; paused: boolean; needsPermission: boolean; roleOk: boolean; agencyOff: boolean; optedIn: boolean; masterOn: boolean; canTurnOn: boolean; /** Why the box is locked (lock) or that it works up to the preview only (previewOnly). Decided by the server. */ state: { lock: { id: "feature_off" | "permission" | "role" | "paused" | "killed"; text: string } | null; previewOnly: { id: "account" | "switch"; text: string } | null }; footerEnabled: boolean; footerText: string; quiet: { start: number; end: number }; caps: { personHour: number; personDay: number; accountDay: number }; bulkCap: number; templates: Array<{ id: string; label: string; channel: string; subject: string | null; text: string; mine: boolean }> };
};
export type WbThread = { state: "ok" | "empty" | "off" | "needs_permission" | "unavailable"; note: string | null; messages: Array<{ id: string; at: string; direction: "in" | "out"; channel: string; text: string; by: string | null; status: string | null }> };
