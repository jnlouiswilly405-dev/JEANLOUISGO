# Settlement policy — recommended defaults (PROPOSAL, NOT APPROVED, NOT IMPLEMENTED)

Companion to `SETTLEMENT_POLICY_PROPOSAL.md`. Nothing here is active. Settlement creation, earnings, Connect,
refunds and payouts remain disabled. Numeric rates are deliberately left blank: they are owner inputs.

| Topic | Recommended default | Owner decision |
|---|---|---|
| Platform commission | Percentage of the merchant item subtotal only (not tax, delivery fee or tip) | Rate: ____ % |
| Merchant settlement | Item subtotal minus commission, tax per owner's tax model | Tax ownership: ____ |
| Driver earnings | Delivery fee minus platform share, plus 100 % of the tip | Platform share: ____ |
| Platform fee | Disclosed separately; never deducted from tips | Amount/rate: ____ |
| Payout eligibility | Order DELIVERED, payment SUCCEEDED and amount-reconciled, no open dispute | Hold period: ____ days |
| Payout timing | Scheduled batch (e.g. weekly), never per order, after the hold period | Cadence: ____ |
| Failed payments | No earnings or settlement rows are ever created | — |
| Refunds | Pre-payout: cancel the pending rows. Post-payout: recover through a negative balance on the next batch | Approve ledger-reversal rules |
| Chargebacks | Freeze the related rows until resolved; loss borne by the platform unless the owner decides otherwise | Liability: ____ |
| Reconciliation | Daily report comparing payments, ledger and provider; discrepancies block payout | Approve report |
| Approval | Payout batches need explicit admin approval at first | Automation later |

Constraints already in code (`191501e`): settlement rows are never overwritten, and a SUCCEEDED payment
equal to the order total is required. The fee basis and rates passed by the caller are still open, so
this policy must be approved before any caller is wired.
