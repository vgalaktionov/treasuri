import {
  Activity,
  Archive,
  CalendarClock,
  FolderTree,
  ListChecks,
  ReceiptText,
  Settings,
  SlidersHorizontal,
} from "lucide-react";

const moreGroups = [
  {
    items: [
      {
        description: "Transactions that can change the forecast",
        href: "/review",
        icon: ListChecks,
        label: "Review",
      },
      {
        description: "Search, filter, correct, and inspect raw bank data",
        href: "/transactions",
        icon: ReceiptText,
        label: "Transactions",
      },
    ],
    label: "Work",
  },
  {
    items: [
      {
        description: "Budget averages, pace, and forecast inclusion",
        href: "/categories",
        icon: FolderTree,
        label: "Categories",
      },
      {
        description: "Deterministic categorization and historical backfills",
        href: "/rules",
        icon: SlidersHorizontal,
        label: "Rules",
      },
      {
        description: "Subscriptions and fixed commitments",
        href: "/recurring",
        icon: CalendarClock,
        label: "Recurring",
      },
    ],
    label: "Planning",
  },
  {
    items: [
      {
        description: "Budget workbook generation and downloads",
        href: "/export",
        icon: Archive,
        label: "Export",
      },
      {
        description: "Forecast, sync, and classifier assumptions",
        href: "/settings",
        icon: Settings,
        label: "Settings",
      },
      {
        description: "Runtime, worker, sync, and export health",
        href: "/status",
        icon: Activity,
        label: "Status",
      },
    ],
    label: "System",
  },
] as const;

export function MorePage() {
  return (
    <section aria-labelledby="more-heading">
      <header className="mb-4">
        <p className="font-medium text-treasuri-muted text-xs sm:text-sm">Navigation</p>
        <h1 className="mt-1 font-semibold text-lg sm:text-xl" id="more-heading">
          More
        </h1>
      </header>

      <div className="grid gap-3">
        {moreGroups.map((group) => (
          <section
            aria-labelledby={`more-${group.label}`}
            className="rounded-md border border-treasuri-line bg-white"
            key={group.label}
          >
            <h2
              className="border-treasuri-line border-b bg-treasuri-panel px-3 py-2 font-semibold text-treasuri-muted text-xs uppercase tracking-[0.08em]"
              id={`more-${group.label}`}
            >
              {group.label}
            </h2>
            <div className="divide-y divide-treasuri-line">
              {group.items.map((item) => (
                <a
                  className="grid min-h-14 grid-cols-[2rem_minmax(0,1fr)] items-center gap-2 px-3 py-2 hover:bg-treasuri-panel"
                  href={item.href}
                  key={item.href}
                >
                  <item.icon aria-hidden="true" className="size-4 text-treasuri-muted" />
                  <span>
                    <span className="block font-semibold text-sm">{item.label}</span>
                    <span className="block text-treasuri-muted text-xs">{item.description}</span>
                  </span>
                </a>
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}
