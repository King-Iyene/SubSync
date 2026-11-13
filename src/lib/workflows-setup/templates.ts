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
  /** The tag a contact carries to enter it, when the person has not chosen another. */
  defaultTag: string;
  /** One plain sentence: what it does and what it never does. Shown in the library. */
  summary: string;
  /** Which step types the template needs (for the error message). */
  needs: readonly string[];
  build: (i: TemplateInput) => Record<string, unknown>;
};

export const CALL_QUEUE: Template = {
  key: "call_queue",
  name: "Call queue",
  version: 1,
  defaultTag: "call-now",
  summary: "Gives your team a call task when a contact gets the call tag. It only gives your team a task.",
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

// Two more, built from the same three steps as the call queue (a tag starts it, a person is given a call task, the tag is removed). They never send a message to a lead:
// the library only installs automations that give your own team a task. A missed call text back and an appointment reminder message customers, so the library offers a copy
// from a client that already has one, or a guide (docs/features/WORKFLOWS.md). Step config names are UNVERIFIED until the first account with the API enabled, like CALL_QUEUE.
const taskTemplate = (key: string, name: string, tag: string, summary: string): Template => ({
  key, name, version: 1, defaultTag: tag, summary, needs: CALL_QUEUE.needs,
  // Same three steps, the tag the caller passes (the library passes defaultTag), its own name.
  build: (i) => ({ ...CALL_QUEUE.build(i), name }),
});
export const NOSHOW_TASK = taskTemplate("noshow_task", "No-show follow-up call", "no-show-follow-up", "Gives your team a call task when a contact gets the no-show tag. It only gives your team a task.");
export const SPEED_TASK = taskTemplate("speed_breach_task", "Slow first reply call", "needs-first-reply", "Gives your team a call task when a lead gets the needs-first-reply tag. It only gives your team a task.");

export const TEMPLATES: readonly Template[] = [CALL_QUEUE, SPEED_TASK, NOSHOW_TASK];
export const templateByKey = (k: string): Template | undefined => TEMPLATES.find((t) => t.key === k);
