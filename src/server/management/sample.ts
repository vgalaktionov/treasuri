import type express from "express";

import type {
  CategoryBudgetResponse,
  RecurringResponse,
  RuleEditorRequest,
  RulesResponse,
  TransactionFilters,
  TransactionsResponse,
} from "../../shared/management.ts";

export const sampleCategories = [
  { id: 1, name: "Dog" },
  { id: 2, name: "Groceries" },
  { id: 3, name: "Unknown" },
  { id: 4, name: "Savings" },
];

export function sampleCategoryBudgets(): CategoryBudgetResponse {
  return {
    categories: [
      {
        average12m: "0.00",
        average3m: "0.00",
        average6m: "0.00",
        currentMonth: "89.95",
        excludedFromForecast: "0.00",
        id: 1,
        includedInForecast: true,
        name: "Dog",
        paceLabel: "EUR 0.05 left",
        status: "watch",
        suggestedBudget: "90.00",
      },
      {
        average12m: "0.00",
        average3m: "0.00",
        average6m: "0.00",
        currentMonth: "64.35",
        excludedFromForecast: "0.00",
        id: 2,
        includedInForecast: true,
        name: "Groceries",
        paceLabel: "EUR 5.65 left",
        status: "watch",
        suggestedBudget: "70.00",
      },
      {
        average12m: "0.00",
        average3m: "0.00",
        average6m: "0.00",
        currentMonth: "1450.00",
        excludedFromForecast: "0.00",
        id: 5,
        includedInForecast: true,
        name: "Rent / Mortgage",
        paceLabel: "on budget",
        status: "watch",
        suggestedBudget: "1450.00",
      },
      {
        average12m: "0.00",
        average3m: "0.00",
        average6m: "0.00",
        currentMonth: "0.00",
        excludedFromForecast: "42.10",
        id: 3,
        includedInForecast: false,
        name: "Unknown",
        paceLabel: "no budget yet",
        status: "empty",
        suggestedBudget: "0.00",
      },
      {
        average12m: "0.00",
        average3m: "0.00",
        average6m: "0.00",
        currentMonth: "0.00",
        excludedFromForecast: "500.00",
        id: 4,
        includedInForecast: false,
        name: "Savings",
        paceLabel: "no budget yet",
        status: "empty",
        suggestedBudget: "0.00",
      },
    ],
    totals: {
      currentMonth: "1604.30",
      excludedFromForecast: "542.10",
      includedCount: 3,
      overCount: 0,
      suggestedBudget: "1610.00",
      watchCount: 3,
    },
    yearMonth: "2026-05",
  };
}

export function sampleRulesFor(
  stores: Map<string, RulesResponse>,
  request: express.Request,
): RulesResponse {
  const existing = stores.get(request.sessionID);
  if (existing) {
    return existing;
  }
  const created = sampleRules();
  stores.set(request.sessionID, created);
  return created;
}

export function sampleRuleFromInput(
  id: number,
  rule: RuleEditorRequest,
): RulesResponse["rules"][number] {
  const category = sampleCategories.find((item) => item.id === rule.categoryId);
  return {
    alreadyCorrectCount: 0,
    categoryId: rule.categoryId,
    categoryName: category?.name ?? "Unknown",
    field: rule.field,
    flags: [
      rule.flags.setIsIncome ? "income" : null,
      rule.flags.setIsTransfer ? "transfer" : null,
      rule.flags.setIsSavings ? "savings" : null,
      rule.flags.setIsFixedCost ? "fixed" : null,
      rule.flags.setIsExcludedFromBudget ? "excluded" : null,
    ].filter((flag): flag is string => flag !== null),
    id,
    isActive: rule.isActive,
    manualOverridesSkippedCount: 0,
    matchCount: 1,
    merchantName: rule.merchantName ?? null,
    name: rule.name,
    operator: rule.operator,
    pattern: rule.pattern,
    priority: rule.priority,
    wouldChangeCount: 1,
  };
}

export function sampleRecurringFor(
  stores: Map<string, RecurringResponse>,
  request: express.Request,
): RecurringResponse {
  const existing = stores.get(request.sessionID);
  if (existing) {
    return existing;
  }
  const created = sampleRecurring();
  stores.set(request.sessionID, created);
  return created;
}

export function sampleTransactions(filters: TransactionFilters): TransactionsResponse {
  const needle = (filters.query ?? "").toLowerCase();
  const transactions = [
    {
      amount: "-89.95",
      bookingDate: "2026-05-20",
      categoryId: 1,
      categoryName: "Dog",
      classificationMethod: "sample",
      description: "Dog food sample",
      flags: [],
      id: 1,
      merchant: "Sample Pet Care",
      needsReview: false,
    },
    {
      amount: "-64.35",
      bookingDate: "2026-05-26",
      categoryId: 2,
      categoryName: "Groceries",
      classificationMethod: "sample",
      description: "Groceries sample",
      flags: [],
      id: 2,
      merchant: "Sample Supermarket",
      needsReview: false,
    },
    {
      amount: "-500.00",
      bookingDate: "2026-05-16",
      categoryId: 3,
      categoryName: "Unknown",
      classificationMethod: "sample",
      description: "Savings transfer sample",
      flags: ["transfer", "savings"],
      id: 3,
      merchant: "Sample Own Savings",
      needsReview: false,
    },
    {
      amount: "-42.10",
      bookingDate: "2026-05-27",
      categoryId: 3,
      categoryName: "Unknown",
      classificationMethod: "uncategorized",
      description: "Needs review sample",
      flags: [],
      id: 4,
      merchant: "Unknown Sample Merchant",
      needsReview: true,
    },
  ].filter((transaction) => {
    const matchesSearch = needle
      ? `${transaction.description} ${transaction.merchant}`.toLowerCase().includes(needle)
      : true;
    const matchesCategory = filters.category ? transaction.categoryName === filters.category : true;
    const matchesMerchant = filters.merchant ? transaction.merchant === filters.merchant : true;
    const matchesReview = filters.needsReview ? transaction.needsReview : true;
    const matchesKind = filters.kind ? transaction.flags.includes(filters.kind) : true;
    return matchesSearch && matchesCategory && matchesMerchant && matchesReview && matchesKind;
  });
  return {
    categories: sampleCategories,
    merchants: [...new Set(transactions.map((transaction) => transaction.merchant))],
    transactions,
  };
}

export function sampleRawDetails(id: number) {
  const transaction = sampleTransactions({}).transactions.find((item) => item.id === id);
  if (!transaction) {
    throw new Error("Transaction not found");
  }
  return {
    amount: transaction.amount,
    bookingDate: transaction.bookingDate,
    categoryName: transaction.categoryName,
    description: transaction.description,
    details: [
      { label: "Account", value: "Sample current account" },
      { label: "IBAN", value: "NL00FAKE0123456789" },
      { label: "Provider", value: "fake" },
      { label: "Currency", value: "EUR" },
    ],
    id: transaction.id,
    merchant: transaction.merchant,
    payloadJson: JSON.stringify({ source: "sample" }, null, 2),
  };
}

function sampleRules(): RulesResponse {
  return {
    categories: sampleCategories,
    fields: [
      "description",
      "counterparty_name",
      "merchant",
      "amount",
      "account_id",
      "counterparty_iban",
    ],
    operators: ["contains", "exact", "starts_with", "ends_with", "regex", "amount_between"],
    rules: [
      {
        alreadyCorrectCount: 0,
        categoryId: 2,
        categoryName: "Groceries",
        field: "description",
        flags: [],
        id: 1,
        isActive: true,
        manualOverridesSkippedCount: 0,
        matchCount: 1,
        merchantName: "Sample Supermarket",
        name: "Sample groceries",
        operator: "contains",
        pattern: "Groceries",
        priority: 100,
        wouldChangeCount: 1,
      },
    ],
  };
}

function sampleRecurring(): RecurringResponse {
  return {
    series: [
      {
        amount: "1450.00",
        amountTolerance: "0.00",
        categoryName: "Rent / Mortgage",
        cadence: "monthly",
        confidence: "1.00",
        expectedDayOfMonth: 1,
        id: 1,
        isConfirmed: true,
        lastBookingDate: "2026-05-01",
        maxAmount: "1450.00",
        minAmount: "1450.00",
        name: "Sample Rent",
        nextExpectedDate: "2026-06-01",
        warnings: [],
      },
      {
        amount: "14.99",
        amountTolerance: "2.50",
        categoryName: "Subscriptions",
        cadence: "monthly",
        confidence: "0.80",
        expectedDayOfMonth: 15,
        id: 2,
        isConfirmed: false,
        lastBookingDate: "2026-05-15",
        maxAmount: "14.99",
        minAmount: "14.99",
        name: "Sample Streaming",
        nextExpectedDate: "2026-06-15",
        warnings: ["New recurring payment detected"],
      },
    ],
  };
}
