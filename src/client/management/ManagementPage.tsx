import { useQuery } from "@tanstack/react-query";

import { fetchCategories } from "../lib/api.ts";
import { RecurringWorkspace } from "./RecurringWorkspace.tsx";
import { RulesWorkspace } from "./RulesWorkspace.tsx";
import { TransactionWorkspace } from "./TransactionWorkspace.tsx";

export function ManagementPage({
  section,
}: {
  section: "categories" | "recurring" | "rules" | "transactions";
}) {
  if (section === "rules") {
    return <RulesWorkspace />;
  }
  if (section === "transactions") {
    return <TransactionWorkspace />;
  }
  if (section === "categories") {
    return <CategoriesPage />;
  }
  if (section === "recurring") {
    return <RecurringWorkspace />;
  }
  return (
    <section>
      <p className="font-medium text-sm text-treasuri-muted">Management</p>
      <h1 className="mt-1 font-semibold text-xl">{title(section)}</h1>
      <p className="mt-2 text-sm text-treasuri-muted">
        This workspace is backed by the same API used by transactions and rules.
      </p>
    </section>
  );
}

function CategoriesPage() {
  const categories = useQuery({ queryFn: fetchCategories, queryKey: ["categories"] });
  return (
    <section>
      <p className="font-medium text-sm text-treasuri-muted">Taxonomy</p>
      <h1 className="mt-1 font-semibold text-xl">Categories</h1>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {categories.data?.map((category) => (
          <article
            className="rounded-md border border-treasuri-line bg-white p-3"
            key={category.id}
          >
            {category.name}
          </article>
        ))}
      </div>
    </section>
  );
}

function title(section: string): string {
  return `${section.slice(0, 1).toUpperCase()}${section.slice(1)}`;
}
