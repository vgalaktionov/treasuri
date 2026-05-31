export type ForecastInputs = {
  currentLiquidBalance: string;
  daysLeftInMonth: number;
  expectedIncomeRemaining: string;
  fixedCostsUpcoming: string;
  predictedVariableRemaining: string;
  safetyBuffer: string;
  targetSavingsRemaining: string;
};

export type ForecastResult = {
  explanation: Record<string, string>;
  safePerDay: string;
  safeToSpend: string;
};

export type VariableSpendInputs = {
  baseline3m: string;
  baseline6m: string;
  currentSpend: string;
  daysInMonth: number;
  elapsedDays: number;
};

export type VariableSpendPrediction = {
  paceProjection: string;
  predictedMonthEnd: string;
  predictedRemaining: string;
};

export function calculateSafeToSpend(inputs: ForecastInputs): ForecastResult {
  if (inputs.daysLeftInMonth < 1) {
    throw new Error("daysLeftInMonth must be at least 1");
  }

  const safeToSpend = roundMoney(
    money(inputs.currentLiquidBalance) +
      money(inputs.expectedIncomeRemaining) -
      money(inputs.fixedCostsUpcoming) -
      money(inputs.predictedVariableRemaining) -
      money(inputs.targetSavingsRemaining) -
      money(inputs.safetyBuffer),
  );
  const safePerDay = roundMoney(safeToSpend / inputs.daysLeftInMonth);

  return {
    explanation: {
      days_left_in_month: String(inputs.daysLeftInMonth),
      expected_income_remaining: formatMoney(inputs.expectedIncomeRemaining),
      fixed_costs_upcoming: formatMoney(inputs.fixedCostsUpcoming),
      formula:
        "synced_current_liquid_balance + expected_income_remaining - fixed_costs_upcoming - predicted_variable_remaining - target_savings_remaining - safety_buffer",
      predicted_variable_remaining: formatMoney(inputs.predictedVariableRemaining),
      safety_buffer: formatMoney(inputs.safetyBuffer),
      synced_current_liquid_balance: formatMoney(inputs.currentLiquidBalance),
      target_savings_remaining: formatMoney(inputs.targetSavingsRemaining),
    },
    safePerDay: formatMoney(safePerDay),
    safeToSpend: formatMoney(safeToSpend),
  };
}

export function predictVariableSpend(inputs: VariableSpendInputs): VariableSpendPrediction {
  if (inputs.elapsedDays < 1) {
    throw new Error("elapsedDays must be at least 1");
  }
  if (inputs.daysInMonth < inputs.elapsedDays) {
    throw new Error("daysInMonth must be greater than or equal to elapsedDays");
  }

  const currentSpend = money(inputs.currentSpend);
  const paceProjection = roundMoney((currentSpend / inputs.elapsedDays) * inputs.daysInMonth);
  const predictedMonthEnd = roundMoney(
    Math.max(money(inputs.baseline3m), money(inputs.baseline6m), paceProjection),
  );
  const predictedRemaining = roundMoney(Math.max(0, predictedMonthEnd - currentSpend));

  return {
    paceProjection: formatMoney(paceProjection),
    predictedMonthEnd: formatMoney(predictedMonthEnd),
    predictedRemaining: formatMoney(predictedRemaining),
  };
}

export function daysLeftInMonth(asOf: Date): number {
  const year = asOf.getUTCFullYear();
  const month = asOf.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Math.max(1, lastDay - asOf.getUTCDate() + 1);
}

export function daysInMonth(asOf: Date): number {
  return new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() + 1, 0)).getUTCDate();
}

export function formatMoney(value: string | number): string {
  return roundMoney(money(value)).toFixed(2);
}

function money(value: string | number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid money value: ${value}`);
  }
  return parsed;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
