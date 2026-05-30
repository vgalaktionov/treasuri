import { Home, ListChecks, MoreHorizontal, ReceiptText } from "lucide-react";
import type { MobileNavItem } from "../../shared/navigation.ts";
import { navGroups, primaryMobileNav } from "../../shared/navigation.ts";

const summaryItems = [
  ["Safe to spend", "EUR 558"],
  ["Safe per day", "EUR 93"],
  ["Projected savings", "EUR 1,087"],
  ["Needs review", "7"],
] as const;

export function App() {
  return (
    <div className="min-h-dvh pb-20 lg:grid lg:grid-cols-[17rem_1fr] lg:pb-0">
      <aside className="hidden border-treasuri-line border-r bg-white px-5 py-6 lg:block">
        <a className="mb-8 block font-semibold text-2xl" href="/">
          Treasuri
        </a>
        <nav aria-label="Primary" className="space-y-7">
          {navGroups.map((group) => (
            <section key={group.label} aria-labelledby={`nav-${group.label}`}>
              <h2
                className="mb-2 font-medium text-treasuri-muted text-xs uppercase tracking-[0.08em]"
                id={`nav-${group.label}`}
              >
                {group.label}
              </h2>
              <div className="space-y-1">
                {group.items.map((item) => (
                  <a
                    className={`block rounded-md px-3 py-2 font-medium text-sm ${
                      item.current
                        ? "bg-treasuri-action text-white"
                        : "text-treasuri-ink hover:bg-treasuri-panel"
                    }`}
                    href={item.href}
                    key={item.href}
                  >
                    {item.label}
                  </a>
                ))}
              </div>
            </section>
          ))}
        </nav>
      </aside>

      <main className="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        <header className="mb-6">
          <p className="font-medium text-sm text-treasuri-muted">May status</p>
          <h1 className="mt-1 font-semibold text-3xl">You are fine for the month.</h1>
          <p className="mt-2 max-w-2xl text-treasuri-muted">
            This v2 shell combines the daily answer and current-month explanation in one workspace.
            Numbers are deterministic sample placeholders until the data slices land.
          </p>
        </header>

        <section aria-label="Monthly summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {summaryItems.map(([label, value]) => (
            <article className="rounded-lg border border-treasuri-line bg-white p-4" key={label}>
              <p className="font-medium text-sm text-treasuri-muted">{label}</p>
              <p className="mt-3 font-semibold text-2xl">{value}</p>
            </article>
          ))}
        </section>

        <section className="mt-6 rounded-lg border border-treasuri-line bg-white p-4">
          <h2 className="font-semibold text-lg">Current-month explanation</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <SummaryPanel title="Pace" value="EUR 142 ahead" />
            <SummaryPanel title="Variance" value="Eating out +EUR 38" />
            <SummaryPanel title="Upcoming" value="EUR 620 fixed costs" />
          </div>
        </section>
      </main>

      <nav
        aria-label="Mobile primary"
        className="fixed inset-x-0 bottom-0 grid grid-cols-4 border-t border-treasuri-line bg-white/95 shadow-sm backdrop-blur lg:hidden"
      >
        {primaryMobileNav.map((item) => (
          <a
            className={`min-h-16 px-2 py-2 text-center font-medium text-xs ${
              item.current ? "text-treasuri-action" : "text-treasuri-muted"
            }`}
            href={item.href}
            key={item.href}
          >
            <MobileNavIcon item={item} />
            <span>{item.label}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}

function MobileNavIcon({ item }: { item: MobileNavItem }) {
  const className = "mx-auto mb-1 size-5";

  switch (item.icon) {
    case "home":
      return <Home aria-hidden="true" className={className} />;
    case "review":
      return <ListChecks aria-hidden="true" className={className} />;
    case "transactions":
      return <ReceiptText aria-hidden="true" className={className} />;
    case "more":
      return <MoreHorizontal aria-hidden="true" className={className} />;
  }
}

function SummaryPanel({ title, value }: { title: string; value: string }) {
  return (
    <article className="rounded-md bg-treasuri-panel p-3">
      <p className="font-medium text-sm text-treasuri-muted">{title}</p>
      <p className="mt-2 font-semibold">{value}</p>
    </article>
  );
}
