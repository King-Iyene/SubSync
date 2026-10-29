import type { Metadata } from "next";
import { SiteShell } from "@/components/legal-page";

export const metadata: Metadata = { title: "Support | SubSync" };

export default function Support() {
  return (
    <SiteShell>
      <div className="max-w-2xl space-y-4 leading-7">
        <h1 className="text-3xl font-semibold tracking-tight">Support</h1>
        <p>
          Need help with SubSync? Email us and we will get back to you, usually
          within one business day.
        </p>
        <p>
          <a
            className="font-medium underline underline-offset-4"
            href="mailto:code@kdsquares.com"
          >
            code@kdsquares.com
          </a>
        </p>
        <h2 className="pt-4 text-xl font-semibold">Common questions</h2>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <strong>How long does the first sync take?</strong> A few minutes
            for most agencies. Large accounts with many contacts can take
            longer.
          </li>
          <li>
            <strong>What does SubSync access?</strong> Read-only access to your
            client accounts&apos; contacts, deals, calendars and conversations,
            only to power the features above.
          </li>
          <li>
            <strong>How do I remove SubSync?</strong> Uninstall it from your
            apps. We then stop syncing and delete your cached data and access
            tokens.
          </li>
        </ul>
      </div>
    </SiteShell>
  );
}
