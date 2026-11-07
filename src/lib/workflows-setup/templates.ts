import type { Resolved } from "./steps.ts";

// The registry of workflow templates SubSync can set up in a client account. One template is built today ("Call queue"). The registry is the only place to add another.
// Planned, NOT built (docs/features/WORKFLOW_SETUP.md): missed_call_textback, noshow_recovery, speed_breach_alert.
// The definition follows the platform's Create Workflow documentation (name, source, folderName, createFolderIfMissing, triggers, actions, edges). The exact field names of a step's
// config are UNVERIFIED until the first account with the API enabled; the platform's own validate call is made before anything is created, and a rejection falls back to the guide.
export type Assign = { mode: "round_robin" } | { mode: "user"; userId: string };
export type TemplateInput = { folderName: string; tag: string; assign: Assign; steps: Extract<Resolved, { ok: true }> };
export type Template = {
  key: string;
  /** The plain name the customer sees. Never a vendor word. */
  name: string;
  version: number;
  /** Which step types the template needs (for the error message). */
  needs: readonly string[];
  build: (i: TemplateInput) => Record<string, unknown>;
};

export const CALL_QUEUE: Template = {
  key: "call_queue",
  name: "Call queue",
  version: 1,
  needs: ["Contact tagged", "Manual Action: Call", "Remove tag"],
  build: ({ folderName, tag, assign, steps }) => ({
    name: "Call queue",
    source: { system: "app" },
    folderName,
    createFolderIfMissing: true,
    triggers: [{ id: "t1", type: steps.trigger.id, name: "Contact tagged", config: { tags: [tag] } }],
    actions: [
      // Never "contact owner": a new lead has none. Assigned to one chosen user, or shared round robin.
      { id: "a1", type: steps.manualCall.id, name: "Call", config: { actionType: "call", assignTo: assign.mode === "user" ? { type: "user", userId: assign.userId } : { type: "round_robin" } } },
      { id: "a2", type: steps.removeTag.id, name: "Remove tag", config: { tags: [tag] } },
    ],
    edges: [{ source: "t1", target: "a1" }, { source: "a1", target: "a2" }],
  }),
};

export const TEMPLATES: readonly Template[] = [CALL_QUEUE];
export const templateByKey = (k: string): Template | undefined => TEMPLATES.find((t) => t.key === k);
