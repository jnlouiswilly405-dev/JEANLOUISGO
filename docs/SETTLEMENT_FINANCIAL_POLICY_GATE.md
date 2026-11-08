# JEANLOUISGO — Settlement Financial Policy Gate

**Status: BLOCKED — business rules require owner approval.**

This document records the fields currently present in the recovered source and the decisions required before any settlement worker may create payable balances. It deliberately does not invent fee rates or decide who owns taxes, tips, discounts, or refunds.

## 1. What the current source supports

The base `orders` table currently stores:
- `subtotal_cents`
- `delivery_fee_cents`
- `total_cents`
- `currency`

The current settlement service accepts these values from its caller:
- `grossAmountCents`
- `driverPlatformFeeCents`
- `merchantCommissionCents`
- `bonusAmountCents`

It verifies `grossAmountCents` equals `orders.total_cents`, then calculates:
- Driver net = gross − driver platform fee + bonus
- Merchant net = gross − merchant commission

That is a technical formula in the current code, **not an approved business policy**. Applying both parties' deductions to the entire order total may allocate delivery fees, taxes, discounts, tips, or other amounts incorrectly.

## 2. Required decisions before enabling settlement creation

| Policy item | Required owner decision | Current state |
|---|---|---|
| Merchant commission basis | Items subtotal? Subtotal after discount? Exclude tax/tip? | NOT DEFINED |
| Driver compensation basis | Fixed delivery amount, distance/time, percentage, or other? | NOT DEFINED |
| Delivery fee ownership | Platform, driver, merchant, shared, or another rule? | NOT DEFINED |
| Tax collection/remittance | Tax included in total? Which party holds/remits it? | NOT DEFINED |
| Tips | Who receives tips and can tips be adjusted after delivery? | NOT DEFINED |
| Discounts/promotions | Who funds each discount: platform, merchant, or shared? | NOT DEFINED |
| Refunds/chargebacks | Allocation by item, delivery fee, tax, tip, or full order? | NOT DEFINED |
| Bonuses | Who funds bonuses and what approval/reference is required? | NOT DEFINED |
| Currency precision | Which currencies and minor-unit precision are supported? | NOT DEFINED |
| Rounding | Per line, per order, or at final allocation? | NOT DEFINED |

## 3. Minimum data model needed

Before implementing the final formula, confirm whether each amount must be stored separately and immutably on the order/payment ledger:
- item subtotal before discount
- item discount and funding party
- delivery fee and funding/beneficiary party
- tax amount and tax liability owner
- tip amount and recipient
- promotion/credit amount and funding party
- captured amount, refunded amount, chargeback amount
- currency and currency exponent
- policy version used to calculate each settlement

The order total must reconcile to captured payment amount, and every allocation must reconcile to the ledger. A settlement must be reproducible from stored source amounts and a versioned policy.

## 4. Required invariants

1. No payable settlement is created unless the order is delivered and payment is captured/settled.
2. Every currency amount is an integer in the currency's supported minor unit.
3. Sum of allocations equals the distributable amount; no amount is allocated twice.
4. Refunds/chargebacks reverse the original allocation using the same policy version, not today's policy.
5. Reprocessing an outbox event cannot create duplicate earning/settlement rows.
6. `PAID` requires verified provider transfer evidence and reconciliation; a local DB update alone is insufficient.
7. Policy version and calculation inputs are retained for audit.

## 5. Release gate

Until the owner decisions above are recorded and approved:
- keep the outbox event durable;
- do not attach an automatic financial calculator to it;
- do not create payable balances from `orders.total_cents` alone;
- keep payout status changes fail-closed;
- do not enable live payouts.

This is an explicit control against silently inventing financial terms.


## 6. Audit data foundation added in migration 016

Migration `016_financial_policy_audit.sql` adds structure only:
- versioned policy records with DRAFT / APPROVED / RETIRED lifecycle;
- a single approved policy version per policy key;
- per-order calculation snapshots linked to the exact policy version;
- allocation lines with beneficiary, funding party, component, amount in minor units, currency, and unique line keys.

No rates, ownership decisions, settlement formulas, or payout execution are supplied by this migration. No existing worker consumes these tables. A policy must be explicitly reviewed and approved before any future calculation service may use it. The database migration itself has not yet been executed against PostgreSQL.

## 7. Arithmetic reconciliation guard added in recovery v27

`backend/src/modules/settlements/allocation-validator.ts` adds a pure validator for a future approved calculation pipeline. It checks that allocation lines are non-empty, use one three-letter uppercase currency code, contain exact integer minor-unit amounts, and sum exactly to the declared total. Signed convention: positive amounts are credits and negative amounts are debits. It uses `bigint` internally so PostgreSQL `BIGINT` values can be validated without JavaScript precision loss.

This helper does **not** select beneficiaries, create payable balances, apply fees, choose tax/tip ownership, or connect to the outbox worker. It is an arithmetic guard only and must be called by a future policy-approved calculation service.
