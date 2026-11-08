-- Final hardening: canonical dispatch driver reference.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS driver_profile_id UUID REFERENCES driver_profiles(id);
CREATE INDEX IF NOT EXISTS idx_orders_driver_profile_status
  ON orders(driver_profile_id, status, created_at DESC);
