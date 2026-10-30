import type { Metadata } from "next";
import { SiteShell } from "@/components/legal-page";

export const metadata: Metadata = { title: "SubSync is installed" };

const STEPS = [
  "Open any one of your client accounts.",
  "In the left menu, click SubSync (it has a chart icon).",
  "The first sync runs in the background and usually takes a few minutes. Numbers appear as it finishes.",
  "Click Getting started inside SubSync for a short tour.",
];

export default function Installed() {
  return (
    <SiteShell>
      <div className="max-w-xl space-y-5 leading-7">
        <h1 className="text-3xl font-semibold tracking-tight">SubSync is installed</h1>
        <p>Your agency is connected. You can close this tab. Here is how to open it:</p>
        <ol className="list-decimal space-y-2 pl-5">
          {STEPS.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <p className="text-sm text-muted-foreground">
          SubSync only reads your data. It never changes contacts, deals or settings. Questions? Email code@kdsquares.com.
        </p>
      </div>
    </SiteShell>
  );
}
