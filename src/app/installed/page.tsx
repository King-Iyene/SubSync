import type { Metadata } from "next";
import { SiteShell } from "@/components/legal-page";

export const metadata: Metadata = { title: "SubSync is installed" };

export default function Installed() {
  return (
    <SiteShell>
      <div className="max-w-xl space-y-4 leading-7">
        <h1 className="text-3xl font-semibold tracking-tight">SubSync is installed</h1>
        <p>
          Your agency is connected. The first sync of your client accounts runs
          in the background and usually takes a few minutes.
        </p>
        <p className="text-muted-foreground">
          You can close this tab and open SubSync from the menu inside any of
          your client accounts.
        </p>
      </div>
    </SiteShell>
  );
}
