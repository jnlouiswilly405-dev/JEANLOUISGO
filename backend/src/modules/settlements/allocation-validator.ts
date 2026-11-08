/**
 * Pure reconciliation guard for settlement allocation snapshots.
 * Amounts are signed integer minor units: credits are positive and debits
 * are negative. This validates arithmetic only; it does not define policy.
 */
export type AllocationAmount = bigint | number | string;

export interface AllocationLineInput {
  amountMinor: AllocationAmount;
  currency: string;
}

function parseMinorAmount(value: AllocationAmount, label: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error(`INVALID_MINOR_AMOUNT:${label}`);
    return BigInt(value);
  }
  if (typeof value === "string" && /^-?(0|[1-9]\d*)$/.test(value)) {
    return BigInt(value);
  }
  throw new Error(`INVALID_MINOR_AMOUNT:${label}`);
}

export function validateSettlementAllocation(
  lines: AllocationLineInput[],
  expectedTotalMinor: AllocationAmount,
  expectedCurrency: string,
): { totalMinor: bigint; currency: string; lineCount: number } {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error("SETTLEMENT_ALLOCATION_EMPTY");
  }
  if (!/^[A-Z]{3}$/.test(expectedCurrency)) {
    throw new Error("INVALID_SETTLEMENT_CURRENCY");
  }

  const expected = parseMinorAmount(expectedTotalMinor, "expectedTotalMinor");
  let total = 0n;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line || line.currency !== expectedCurrency) {
      throw new Error("SETTLEMENT_ALLOCATION_CURRENCY_MISMATCH");
    }
    total += parseMinorAmount(line.amountMinor, `line[${index}]`);
  }
  if (total !== expected) {
    throw new Error("SETTLEMENT_ALLOCATION_TOTAL_MISMATCH");
  }
  return { totalMinor: total, currency: expectedCurrency, lineCount: lines.length };
}
