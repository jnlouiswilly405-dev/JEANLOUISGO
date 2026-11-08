-- Preserve legacy NUMERIC amount columns while introducing exact minor-unit
-- amounts and currency for all new settlement calculations.
ALTER TABLE driver_earnings
  ADD COLUMN IF NOT EXISTS gross_amount_cents BIGINT,
  ADD COLUMN IF NOT EXISTS platform_fee_cents BIGINT,
  ADD COLUMN IF NOT EXISTS bonus_amount_cents BIGINT,
  ADD COLUMN IF NOT EXISTS net_amount_cents BIGINT,
  ADD COLUMN IF NOT EXISTS currency CHAR(3);

ALTER TABLE merchant_settlements
  ADD COLUMN IF NOT EXISTS gross_amount_cents BIGINT,
  ADD COLUMN IF NOT EXISTS commission_amount_cents BIGINT,
  ADD COLUMN IF NOT EXISTS net_amount_cents BIGINT,
  ADD COLUMN IF NOT EXISTS currency CHAR(3);

-- Backfill existing rows from legacy two-decimal NUMERIC fields.
UPDATE driver_earnings
SET gross_amount_cents = ROUND(gross_amount * 100)::BIGINT,
    platform_fee_cents = ROUND(platform_fee * 100)::BIGINT,
    bonus_amount_cents = ROUND(bonus_amount * 100)::BIGINT,
    net_amount_cents = ROUND(net_amount * 100)::BIGINT
WHERE gross_amount_cents IS NULL OR platform_fee_cents IS NULL
   OR bonus_amount_cents IS NULL OR net_amount_cents IS NULL;

UPDATE merchant_settlements
SET gross_amount_cents = ROUND(gross_amount * 100)::BIGINT,
    commission_amount_cents = ROUND(commission_amount * 100)::BIGINT,
    net_amount_cents = ROUND(net_amount * 100)::BIGINT
WHERE gross_amount_cents IS NULL OR commission_amount_cents IS NULL
   OR net_amount_cents IS NULL;

-- Currency is inherited from the referenced order; never assume USD.
UPDATE driver_earnings de SET currency = o.currency
FROM orders o WHERE de.order_id = o.id AND de.currency IS NULL;
UPDATE merchant_settlements ms SET currency = o.currency
FROM orders o WHERE ms.order_id = o.id AND ms.currency IS NULL;

ALTER TABLE driver_earnings
  ADD CONSTRAINT driver_earnings_minor_units_nonnegative
  CHECK (gross_amount_cents >= 0 AND platform_fee_cents >= 0
     AND bonus_amount_cents >= 0 AND net_amount_cents >= 0) NOT VALID;
ALTER TABLE merchant_settlements
  ADD CONSTRAINT merchant_settlements_minor_units_nonnegative
  CHECK (gross_amount_cents >= 0 AND commission_amount_cents >= 0
     AND net_amount_cents >= 0) NOT VALID;
ALTER TABLE driver_earnings VALIDATE CONSTRAINT driver_earnings_minor_units_nonnegative;
ALTER TABLE merchant_settlements VALIDATE CONSTRAINT merchant_settlements_minor_units_nonnegative;
