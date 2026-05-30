export const sampleYearMonth = "2026-05";
export const sampleAccountIban = "NL00FAKE0123456789";
export const sampleAccountBalance = "3478.45";

export type SampleTransaction = {
  amount: string;
  bookingDate: string;
  category: string;
  classificationConfidence: string;
  classificationMethod: string;
  counterpartyName: string;
  description: string;
  isExcludedFromBudget?: boolean;
  isFixedCost?: boolean;
  isIncome?: boolean;
  isOneOff?: boolean;
  isSavings?: boolean;
  isTransfer?: boolean;
  isVariableCost?: boolean;
  merchant: string;
  needsReview?: boolean;
  sourceHash: string;
};

export const sampleTransactions: readonly SampleTransaction[] = [
  {
    amount: "5258.00",
    bookingDate: "2026-05-24",
    category: "Income",
    classificationConfidence: "1",
    classificationMethod: "sample",
    counterpartyName: "Sample Employer",
    description: "Monthly salary sample",
    isIncome: true,
    isVariableCost: false,
    merchant: "Sample Employer",
    sourceHash: "sample-salary-2026-05",
  },
  {
    amount: "-1450.00",
    bookingDate: "2026-05-01",
    category: "Rent / Mortgage",
    classificationConfidence: "1",
    classificationMethod: "sample",
    counterpartyName: "Sample Housing",
    description: "Monthly rent sample",
    isFixedCost: true,
    isVariableCost: false,
    merchant: "Sample Housing",
    sourceHash: "sample-rent-2026-05",
  },
  {
    amount: "-64.35",
    bookingDate: "2026-05-26",
    category: "Groceries",
    classificationConfidence: "1",
    classificationMethod: "sample",
    counterpartyName: "Sample Supermarket",
    description: "Groceries sample",
    merchant: "Sample Supermarket",
    sourceHash: "sample-groceries-2026-05",
  },
  {
    amount: "-89.95",
    bookingDate: "2026-05-20",
    category: "Dog",
    classificationConfidence: "1",
    classificationMethod: "sample",
    counterpartyName: "Sample Pet Care",
    description: "Dog food sample",
    merchant: "Sample Pet Care",
    sourceHash: "sample-dog-2026-05",
  },
  {
    amount: "-320.00",
    bookingDate: "2026-05-18",
    category: "One-off / Large purchase",
    classificationConfidence: "1",
    classificationMethod: "sample",
    counterpartyName: "Sample Furniture",
    description: "Large one-off sample purchase",
    isExcludedFromBudget: true,
    isOneOff: true,
    merchant: "Sample Furniture",
    sourceHash: "sample-oneoff-2026-05",
  },
  {
    amount: "-500.00",
    bookingDate: "2026-05-16",
    category: "Savings",
    classificationConfidence: "1",
    classificationMethod: "sample",
    counterpartyName: "Sample Own Savings",
    description: "Savings transfer sample",
    isSavings: true,
    isTransfer: true,
    isVariableCost: false,
    merchant: "Sample Own Savings",
    sourceHash: "sample-transfer-2026-05",
  },
  {
    amount: "-42.10",
    bookingDate: "2026-05-27",
    category: "Unknown",
    classificationConfidence: "0",
    classificationMethod: "uncategorized",
    counterpartyName: "Unknown Sample Merchant",
    description: "Needs review sample",
    merchant: "Unknown Sample Merchant",
    needsReview: true,
    sourceHash: "sample-review-2026-05",
  },
] as const;
