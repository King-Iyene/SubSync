import Link from "next/link";
import { SiteShell } from "@/components/legal-page";
import { buttonVariants } from "@/components/ui/button";

const features = [
  {
    title: "Search every client account at once",
    body: "Find any contact by name, email or phone across all of your client accounts from a single search box.",
  },
  {
    title: "See data health per account",
    body: "Spot missing emails, missing phones, untagged and inactive contacts, account by account.",
  },
  {
    title: "Catch stale deals early",
    body: "Surface open deals that have not moved in 30, 60 or 90 days across every pipeline.",
  },
  {
    title: "Track onboarding progress",
    body: "See how far each new client account has come, with a simple completion score.",
  },
];

export default function Home() {
  return (
    <SiteShell>
      <section className="space-y-6 py-8">
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
          One dashboard for all your client accounts
        </h1>
        <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
          SubSync gives teams that manage many client accounts one place to
          search contacts across every account, spot stale deals, check data
          quality, and track onboarding progress.
        </p>
        <div className="flex gap-3">
          <Link href="/support" className={buttonVariants({ size: "lg" })}>
            Get support
          </Link>
        </div>
      </section>
      <section className="mt-12 grid gap-6 sm:grid-cols-2">
        {features.map((f) => (
          <div key={f.title} className="rounded-xl border p-6">
            <h2 className="font-semibold">{f.title}</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {f.body}
            </p>
          </div>
        ))}
      </section>
    </SiteShell>
  );
}
