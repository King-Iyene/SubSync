import type { Metadata } from "next";
import { SiteShell } from "@/components/legal-page";

export const metadata: Metadata = { title: "SubSync install problem" };

export default function InstallError() {
  return (
    <SiteShell>
      <div className="max-w-xl space-y-4 leading-7">
        <h1 className="text-3xl font-semibold tracking-tight">
          We could not finish the install
        </h1>
        <p>
          Something went wrong while connecting your company. Nothing was changed
          on your accounts. Please try installing again, and if it keeps
          happening, email{" "}
          <a
            className="font-medium underline underline-offset-4"
            href="mailto:code@kdsquares.com"
          >
            code@kdsquares.com
          </a>
          .
        </p>
      </div>
    </SiteShell>
  );
}
