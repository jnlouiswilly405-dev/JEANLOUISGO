-- Refuse migration if historical duplicates exist; never alter financial records.
CREATE UNIQUE INDEX idx_ledger_one_clearing_credit_per_order
  ON ledger_entries(order_id)
  WHERE order_id IS NOT NULL AND account_type='PLATFORM_CLEARING' AND direction='CREDIT';
