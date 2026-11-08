import { describe, expect, it } from "vitest";
import { validateSettlementAllocation } from "./allocation-validator.js";

describe("validateSettlementAllocation", () => {
  it("accepts balanced signed minor-unit lines", () => {
    expect(validateSettlementAllocation([
      { amountMinor: "1250", currency: "USD" },
      { amountMinor: -250, currency: "USD" },
    ], "1000", "USD")).toEqual({ totalMinor: 1000n, currency: "USD", lineCount: 2 });
  });

  it("rejects a total that does not reconcile", () => {
    expect(() => validateSettlementAllocation([
      { amountMinor: 900, currency: "USD" },
    ], 1000, "USD")).toThrow("SETTLEMENT_ALLOCATION_TOTAL_MISMATCH");
  });

  it("rejects mixed currencies", () => {
    expect(() => validateSettlementAllocation([
      { amountMinor: 500, currency: "USD" },
      { amountMinor: 500, currency: "CAD" },
    ], 1000, "USD")).toThrow("SETTLEMENT_ALLOCATION_CURRENCY_MISMATCH");
  });

  it("rejects unsafe numeric values and malformed integer strings", () => {
    expect(() => validateSettlementAllocation([
      { amountMinor: Number.MAX_SAFE_INTEGER + 1, currency: "USD" },
    ], 1, "USD")).toThrow("INVALID_MINOR_AMOUNT");
    expect(() => validateSettlementAllocation([
      { amountMinor: "1.25", currency: "USD" },
    ], 1, "USD")).toThrow("INVALID_MINOR_AMOUNT");
  });

  it("rejects empty allocations and invalid currency codes", () => {
    expect(() => validateSettlementAllocation([], 0, "USD")).toThrow("SETTLEMENT_ALLOCATION_EMPTY");
    expect(() => validateSettlementAllocation([
      { amountMinor: 0, currency: "usd" },
    ], 0, "usd")).toThrow("INVALID_SETTLEMENT_CURRENCY");
  });

  it("supports exact values beyond JavaScript's safe integer range as strings", () => {
    expect(validateSettlementAllocation([
      { amountMinor: "9007199254740993", currency: "USD" },
    ], "9007199254740993", "USD").totalMinor).toBe(9007199254740993n);
  });
});
