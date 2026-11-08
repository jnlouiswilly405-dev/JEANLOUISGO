# Settlement and Payout Policy — PROPOSAL (NOT APPROVED, NOT IMPLEMENTED)

Status: for owner review. **No code implements this.** Every number is deliberately left as `OWNER DECISION`; no commission rate, driver pay, tax or tip rule is invented here. It extends `SETTLEMENT_FINANCIAL_POLICY_GATE.md`; the gate stays closed until each decision below is recorded and approved in `settlement_policy_versions`.

## 1. Principles (proposed)
1. Integer minor units only; one currency per settlement; rounding rule fixed per policy version.
2. A settlement is a pure function of immutable stored inputs plus an approved, versioned policy; it is reproducible and audited (`settlement_calculations`, `settlement_allocation_lines`).
3. Every allocation set must sum exactly to the distributable amount (`allocation-validator.ts`).
4. Nothing becomes payable unless the order is `DELIVERED` and the payment is captured and reconciled.
5. `PAID` is set only from provider-confirmed transfer evidence, never by a local update.
6. Defaults fail closed; each stage has its own feature flag (calculation, eligibility, payout) defaulting to off.

## 2. Decisions required

| Topic | Options for the owner | Decision |
|---|---|---|
| Merchant commission basis | A) % of item subtotal; B) % of subtotal after merchant-funded discounts; C) flat fee per order; D) hybrid | OWNER DECISION |
| Merchant commission rate / tiers | single rate, per-merchant contract rate, volume tiers | OWNER DECISION |
| Driver earnings | A) fixed amount per delivery; B) distance/time formula; C) % of delivery fee; D) hybrid with minimum | OWNER DECISION |
| Delivery fee ownership | platform, driver, merchant, or split | OWNER DECISION |
| Tax | tax-inclusive vs added; who collects/remits; tax is excluded from commission/earnings bases unless stated | OWNER DECISION (legal/tax review) |
| Tips | 100% to driver (typical) or other; adjustable after delivery or not | OWNER DECISION |
| Discounts/promos | funded by platform, merchant, or shared per promo | OWNER DECISION |
| Bonuses | funding party, approval and reference required | OWNER DECISION |
| Rounding | per line, per order, or at final allocation; remainder to platform or largest line | OWNER DECISION |
| Currencies | list and minor-unit exponents | OWNER DECISION |

## 3. Proposed mechanics (structure, no rates)
- **Inputs stored per order** (new, immutable): item subtotal, discount and funder, delivery fee, tax, tip, captured amount, currency, policy version id. Requires a separately approved schema change.
- **Merchant settlement** = commission-basis amount − commission (per policy) ± merchant-funded adjustments.
- **Driver earning** = per-policy delivery compensation + tips + approved bonuses − any per-policy deductions.
- **Platform** = remainder; remainder must reconcile to zero against the captured amount.
- **Idempotency**: one calculation per (order, policy version); never overwrite finalized rows (the current upsert is replaced by insert-or-fail).

## 4. Refunds and chargebacks (proposed)
- A refund or chargeback creates **reversal allocation lines** referencing the original calculation and its policy version, never today's policy.
- Allocation of a partial refund (by item, delivery fee, tax, tip, or full order) is an OWNER DECISION.
- If funds were already paid out: recover by netting against future payouts, or by a negative balance — OWNER DECISION. Dispute fees and who bears them — OWNER DECISION.
- Reversals are applied only from provider-confirmed refund/dispute events.

## 5. Payout eligibility (proposed)
A settlement becomes `ELIGIBLE` only when all hold: order `DELIVERED`; payment `SUCCEEDED` and reconciled; no open refund/dispute; hold period elapsed (length OWNER DECISION); party onboarded and verified with the payout provider; calculation validated by the allocation validator.
Payout run: minimum payout threshold (OWNER DECISION), batch in `payout_batches`, dual approval for each batch, provider transfer id stored, `PAID` only after provider confirmation and reconciliation, failed transfers returned to `ELIGIBLE` with an audit record.

## 6. Rollout (each step separately approved)
1. Record the decisions and approve a policy version (legal/tax review first).
2. Add the immutable input fields (schema change).
3. Shadow mode: calculate and store results only; compare with finance for a trial period.
4. Enable settlement creation behind its own flag.
5. Provider payout integration (Stripe Connect or other) in sandbox, then limited live pilot after written approval.
Until step 1 is complete, the outbox settlement handler remains `blockedSettlementHandler`.

## 7. Owner decision record (to be completed by the owner; nothing is assumed)
| # | Decision | Value | Approved by / date |
|---|---|---|---|
| 1 | Merchant commission basis and rate | _blank_ | |
| 2 | Driver compensation model | _blank_ | |
| 3 | Delivery fee ownership | _blank_ | |
| 4 | Tax ownership and remittance | _blank_ (legal/tax review) | |
| 5 | Tip allocation | _blank_ | |
| 6 | Discount/promo funding | _blank_ | |
| 7 | Rounding rule | _blank_ | |
| 8 | Hold period before eligibility | _blank_ | |
| 9 | Minimum payout threshold | _blank_ | |
| 10 | Refund/chargeback allocation and recovery after payout | _blank_ | |
| 11 | Payout provider (Stripe Connect or other) and supported countries | _blank_ | |

## 8. Known defects in the unattached settlement code (fix before any activation, under separate approval)
`createSettlementForDeliveredOrder` (in `backend/src/modules/settlements/`) currently: applies fees to the whole order total; takes fee rates from its caller; overwrites existing `ELIGIBLE` rows via upsert; and does not check payment capture. It is not wired to any route or worker; the outbox handler is `blockedSettlementHandler`, `OUTBOX_WORKER_ENABLED` defaults to false, and no endpoint creates earnings, ledger entries or payouts.
Application refunds (`refundPayment`) still throw `REFUND_PROVIDER_NOT_IMPLEMENTED`; they stay disabled until section 4 is decided.

## 9. Additional decision proposal: fees, failed payments, timing, reconciliation (OWNER DECISION; nothing implemented)
**Platform fees.** Options: (A) platform fee = merchant commission + driver-side fee, each on its own base; (B) a single service fee charged to the customer; (C) hybrid. Whatever is chosen, fees are taken only from the base the policy names (the current code wrongly applies them to the whole order total and takes rates from its caller; rates must come only from an approved `settlement_policy_versions` row).
**Failed or abandoned payments.** Proposed: no settlement, earning or ledger entry exists for an order without a SUCCEEDED payment (now enforced in code by `PAYMENT_NOT_CAPTURED`). A FAILED attempt leaves the order `PENDING_PAYMENT` and retryable. Orders unpaid after a window (length OWNER DECISION) are cancelled, never settled.
**Payout timing.** Options: weekly batch, daily batch, or on-demand above a threshold; hold period after delivery (to cover the refund/dispute window) is OWNER DECISION. Proposed default for the owner to accept or change: batch-based with dual approval, never per-order instant payout.
**Reconciliation.** Daily, read-only, report-first: (1) every SUCCEEDED payment has exactly one PLATFORM_CLEARING credit; (2) captured amount = merchant net + driver net + platform remainder + refunds, per order; (3) Stripe balance transactions match local payments (needs the Stripe reporting integration); (4) unreferenced PENDING stripe payments (`GET /api/admin/payments/unreferenced`); (5) blocked outbox events. Discrepancies create alerts, never automatic adjustments.
**Refund timing and effect.** A refund before payout reduces the open settlement lines; after payout it follows the section 4 recovery choice.

Cannot be decided by engineering: every rate, rule and window above. Section 7 stays blank until the owner fills it in.

## 10. Status of the section 8 defects
Corrected (isolated, cannot enable settlement; the function is still unreachable from any route, worker or runner): existing rows are no longer overwritten (identical request returns stored rows, different request fails `SETTLEMENT_ALREADY_EXISTS`); settlement now requires a captured payment (`PAYMENT_NOT_CAPTURED`). Regression tests: `backend/integration/settlement-safety.int.ts`.
Still open (policy-dependent, intentionally not changed): fee basis applied to the whole total; fee rates supplied by the caller.
