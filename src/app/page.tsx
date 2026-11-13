import Link from "next/link";
import { LeadCostCalculator } from "@/components/lead-cost-calculator";
import { ProfitCalculator } from "@/components/profit-calculator";

const outcomes = [
  { title: "Speed to lead", body: "See how long every new lead waits for a first reply from a person, per client account and per team member. Get an alert the moment leads start going cold." },
  { title: "True show rate", body: "Find every appointment nobody marked as showed or no-show, so your reports stop lying. Get a list of no-shows still waiting to be rebooked." },
  { title: "Setter performance", body: "Compare first-reply time, show rate and deals won across your team and across every client account, in one place." },
];

const trust = [
  "Read-only by default. The one thing SubSync writes on its own is a meeting note on a matched contact, and you can switch that off. Every other change needs a preview, a typed confirmation and an undo.",
  "A client account can only ever see its own data. Another agency's data is never reachable, and this is tested on every release.",
  "A small, clearly listed set of permissions, not hundreds.",
  "Your data is deleted when you uninstall.",
];

const faq = [
  ["How much does it cost?", "Try it free for 14 days, then $11.50 per client account per month. You can resell it to your clients at your own price."],
  ["Does it work under my own brand?", "Yes. Add your agency name and colour in Settings and SubSync shows as yours."],
  ["Will it message my clients' customers?", "No. SubSync never sends messages to contacts. It reads, alerts you, and tells you what to do."],
  ["How fast do I see something useful?", "The audit runs as soon as your accounts finish their first read, usually within minutes."],
];

export default function Home() {
  return (
    <div className="dark min-h-screen bg-[oklch(0.15_0.025_220)] text-white">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <span className="text-lg font-semibold tracking-tight">SubSync</span>
        <nav className="flex gap-5 text-sm text-white/60">
          <Link href="/support" className="hover:text-white">Support</Link>
          <Link href="/privacy" className="hover:text-white">Privacy</Link>
          <Link href="/terms" className="hover:text-white">Terms</Link>
        </nav>
      </header>

      <main className="mx-auto max-w-5xl space-y-24 px-6 pb-24 pt-12">
        <section className="space-y-6">
          <p className="text-sm font-medium uppercase tracking-widest text-teal-300">For agencies that book appointments</p>
          <h1 className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">Know what is happening in every client account before your client does.</h1>
          <p className="max-w-2xl text-lg leading-8 text-white/70">SubSync watches every account for slow replies, unmarked appointments and stale deals, puts a dollar figure on what is being lost, and tells you what to do first. It runs inside your CRM and you can resell it under your own name.</p>
          <div className="flex flex-wrap gap-3">
            <Link href="/support" className="rounded-xl bg-teal-400 px-6 py-3 font-semibold text-slate-950 hover:bg-teal-300">Run your free audit</Link>
            <a href="#calculator" className="rounded-xl border border-white/20 px-6 py-3 font-medium hover:bg-white/5">See what you could earn</a>
          </div>
        </section>

        <section className="grid gap-5 sm:grid-cols-3">
          {outcomes.map((o) => (
            <div key={o.title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
              <h2 className="text-lg font-semibold">{o.title}</h2>
              <p className="mt-2 text-sm leading-6 text-white/70">{o.body}</p>
            </div>
          ))}
        </section>

        <section id="lead-cost" className="space-y-5">
          <h2 className="text-3xl font-semibold tracking-tight">What slow replies cost you</h2>
          <p className="max-w-2xl text-white/70">A lead that waits cools fast. Put in your own numbers.</p>
          <LeadCostCalculator />
        </section>

        <section id="calculator" className="space-y-5">
          <h2 className="text-3xl font-semibold tracking-tight">What it earns you</h2>
          <p className="max-w-2xl text-white/70">One price per client account. Add your own markup and keep the difference.</p>
          <ProfitCalculator />
        </section>

        <section className="space-y-5">
          <h2 className="text-3xl font-semibold tracking-tight">Built to be trusted with client data</h2>
          <ul className="grid gap-4 sm:grid-cols-2">
            {trust.map((t) => <li key={t} className="rounded-xl border border-white/10 p-5 text-sm leading-6 text-white/80">{t}</li>)}
          </ul>
        </section>

        <section className="space-y-5">
          <h2 className="text-3xl font-semibold tracking-tight">Questions</h2>
          <dl className="space-y-5">
            {faq.map(([q, a]) => <div key={q}><dt className="font-medium">{q}</dt><dd className="mt-1 text-sm leading-6 text-white/70">{a}</dd></div>)}
          </dl>
        </section>
      </main>

      <footer className="border-t border-white/10">
        <div className="mx-auto max-w-5xl px-6 py-6 text-sm text-white/50">&copy; 2026 KD Squares Ltd. All rights reserved.</div>
      </footer>
    </div>
  );
}
