import type { Mode } from "./runner";

export type WbDeal = { id: string; name: string | null; pipelineId: string | null; pipelineName: string | null; stageId: string | null; stageName: string | null; value: number; status: string; ownerId: string | null };
export type WbContext = {
  mode: Mode; canDelete: boolean; name: string; dnd: boolean; phone: string | null; email: string | null; hasConversation: boolean; timeZone?: string | null; crmUrl?: string; dealsUrl?: string;
  tags: string[]; fields: { firstName: string; lastName: string; email: string; phone: string }; ownerId: string | null; ownerName: string | null; locationName: string | null;
  users: Array<{ id: string; name: string }>; deals: WbDeal[]; appointments: Array<{ id: string; title: string; status: string | null; at: string | null; calendar?: string | null; assignedTo?: string | null }>;
  pipelines: Array<{ id: string; name: string; stages: Array<{ id: string; name: string }> }>; me: string | null;
  templates: Array<{ id: string; label: string; channel: string; subject: string | null; text: string }>;
};
export type WbThread = { state: "ok" | "empty" | "off" | "needs_permission" | "unavailable"; note: string | null; messages: Array<{ id: string; at: string; direction: "in" | "out"; channel: string; text: string; by: string | null; status: string | null }> };
