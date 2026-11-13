import type { Assign } from "./templates.ts";

// The hand-built version of a workflow, in plain sentences. Returned with every "automatic setup is not possible" answer so a person (or the card that shows them) can finish in a few minutes.
// Same five steps as docs/features/WORKFLOW_SETUP.md. Never names the product or the platform.
export function handSteps(tag: string, assign: Assign, folderName: string, workflowName: string): string[] {
  const who = assign.mode === "user" ? "one chosen person" : "everyone in turn (round robin)";
  return [
    `In your CRM, open Automation, then Workflows, and create a folder named "${folderName}" (or use one you already have).`,
    `Inside it, create a new workflow from scratch and name it "${workflowName}".`,
    `Add the trigger "Contact Tag", set it to "Tag added", and choose the tag "${tag}".`,
    `Add the action "Manual Action", choose "Call", and assign it to ${who} (not "contact owner": new leads have none). Then add the action "Remove Contact Tag" with the tag "${tag}".`,
    "Publish the workflow, then press Check setup.",
  ];
}
