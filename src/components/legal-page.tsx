import Link from "next/link";

export function SiteShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between px-6 py-4">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            SubSync
          </Link>
          <nav className="flex gap-5 text-sm text-muted-foreground">
            <Link href="/support" className="hover:text-foreground">
              Support
            </Link>
            <Link href="/privacy" className="hover:text-foreground">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-foreground">
              Terms
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-12">
        {children}
      </main>
      <footer className="border-t">
        <div className="mx-auto w-full max-w-4xl px-6 py-6 text-sm text-muted-foreground">
          &copy; 2026 KD Squares Ltd. All rights reserved.
        </div>
      </footer>
    </div>
  );
}

export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <SiteShell>
      <article className="max-w-2xl space-y-4 leading-7 [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">Last updated: {updated}</p>
        {children}
      </article>
    </SiteShell>
  );
}
