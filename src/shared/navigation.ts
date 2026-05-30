export type NavItem = {
  href: string;
  label: string;
  current?: boolean;
};

export type MobileNavItem = NavItem & {
  icon: "home" | "review" | "transactions" | "more";
};

export const navGroups: ReadonlyArray<{ label: string; items: readonly NavItem[] }> = [
  {
    label: "Overview",
    items: [{ href: "/", label: "Dashboard", current: true }],
  },
  {
    label: "Work",
    items: [
      { href: "/review", label: "Review" },
      { href: "/transactions", label: "Transactions" },
    ],
  },
  {
    label: "Planning",
    items: [
      { href: "/categories", label: "Categories" },
      { href: "/rules", label: "Rules" },
      { href: "/recurring", label: "Recurring" },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/export", label: "Export" },
      { href: "/settings", label: "Settings" },
      { href: "/status", label: "Status" },
    ],
  },
] as const;

export const primaryMobileNav: readonly MobileNavItem[] = [
  { href: "/", label: "Home", icon: "home", current: true },
  { href: "/review", label: "Review", icon: "review" },
  { href: "/transactions", label: "Txns", icon: "transactions" },
  { href: "/more", label: "More", icon: "more" },
] as const;
