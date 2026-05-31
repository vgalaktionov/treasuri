import { Home, ListChecks, MoreHorizontal, ReceiptText } from "lucide-react";
import type { MobileNavItem } from "../../shared/navigation.ts";
import { navGroups, primaryMobileNav } from "../../shared/navigation.ts";
import { DashboardPage } from "../dashboard/DashboardPage.tsx";
import { ManagementPage } from "../management/ManagementPage.tsx";
import { OperationsPage } from "../operations/OperationsPage.tsx";
import { ReviewPage } from "../review/ReviewPage.tsx";
import { MorePage } from "./MorePage.tsx";

export function App() {
  const currentPath = window.location.pathname;

  return (
    <div className="min-h-dvh pb-16 lg:grid lg:grid-cols-[15rem_1fr] lg:pb-0">
      <aside className="hidden border-treasuri-line border-r bg-white px-4 py-4 lg:block">
        <a className="mb-6 block font-semibold text-base" href="/">
          Treasuri
        </a>
        <nav aria-label="Primary" className="space-y-5">
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
                      isCurrentPath(item.href, currentPath)
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

      <main className="mx-auto w-full max-w-6xl px-4 py-4 sm:px-5 lg:px-6 lg:py-5">
        {renderPage(currentPath)}
      </main>

      <nav
        aria-label="Mobile primary"
        className="fixed inset-x-0 bottom-0 grid grid-cols-4 border-t border-treasuri-line bg-white/95 shadow-sm backdrop-blur lg:hidden"
      >
        {primaryMobileNav.map((item) => (
          <a
            className={`min-h-14 px-2 py-2 text-center font-medium text-xs ${
              isCurrentPath(item.href, currentPath) ? "text-treasuri-action" : "text-treasuri-muted"
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

function renderPage(currentPath: string) {
  if (currentPath === "/review") {
    return <ReviewPage />;
  }
  if (currentPath === "/transactions") {
    return <ManagementPage section="transactions" />;
  }
  if (currentPath === "/rules") {
    return <ManagementPage section="rules" />;
  }
  if (currentPath === "/categories") {
    return <ManagementPage section="categories" />;
  }
  if (currentPath === "/recurring") {
    return <ManagementPage section="recurring" />;
  }
  if (currentPath === "/export") {
    return <OperationsPage section="export" />;
  }
  if (currentPath === "/settings") {
    return <OperationsPage section="settings" />;
  }
  if (currentPath === "/status") {
    return <OperationsPage section="status" />;
  }
  if (currentPath === "/more") {
    return <MorePage />;
  }
  return <DashboardPage />;
}

function isCurrentPath(href: string, currentPath: string): boolean {
  if (href === "/") {
    return currentPath === "/";
  }
  return currentPath.startsWith(href);
}

function MobileNavIcon({ item }: { item: MobileNavItem }) {
  const className = "mx-auto mb-1 size-4";

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
