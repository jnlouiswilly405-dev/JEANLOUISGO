CREATE TABLE IF NOT EXISTS driver_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id),
  vehicle_type TEXT NOT NULL DEFAULT 'car',
  license_plate TEXT,
  status TEXT NOT NULL DEFAULT 'OFFLINE'
    CHECK (status IN ('OFFLINE','AVAILABLE','BUSY','SUSPENDED')),
  lat NUMERIC(10,7),
  lng NUMERIC(10,7),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dispatch_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id),
  driver_id UUID NOT NULL REFERENCES driver_profiles(id),
  status TEXT NOT NULL DEFAULT 'OFFERED'
    CHECK (status IN ('OFFERED','ACCEPTED','REJECTED','CANCELLED','COMPLETED')),
  offered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  UNIQUE(order_id, driver_id)
);

CREATE INDEX IF NOT EXISTS idx_driver_status ON driver_profiles(status);
CREATE INDEX IF NOT EXISTS idx_driver_location ON driver_profiles(lat, lng);
CREATE INDEX IF NOT EXISTS idx_dispatch_order ON dispatch_assignments(order_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_driver ON dispatch_assignments(driver_id);
