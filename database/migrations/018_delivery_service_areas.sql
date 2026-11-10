CREATE TABLE IF NOT EXISTS delivery_service_areas (
  state_code VARCHAR(2) NOT NULL CHECK (state_code ~ '^[A-Z]{2}$'),
  postal_code VARCHAR(5) NOT NULL CHECK (postal_code ~ '^[0-9]{5}$'),
  city_name VARCHAR(100) NOT NULL CHECK (length(btrim(city_name)) > 0),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (state_code, postal_code)
);

INSERT INTO delivery_service_areas (state_code, postal_code, city_name)
VALUES ('NY', '10977', 'Spring Valley'), ('NY', '10954', 'Nanuet')
ON CONFLICT (state_code, postal_code) DO NOTHING;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivery_address_line1 VARCHAR(200),
  ADD COLUMN IF NOT EXISTS delivery_address_line2 VARCHAR(200),
  ADD COLUMN IF NOT EXISTS delivery_city VARCHAR(100),
  ADD COLUMN IF NOT EXISTS delivery_state_code VARCHAR(2),
  ADD COLUMN IF NOT EXISTS delivery_postal_code VARCHAR(5);

ALTER TABLE orders
  ADD CONSTRAINT orders_delivery_address_complete_check CHECK (
    (delivery_address_line1 IS NULL AND delivery_city IS NULL AND delivery_state_code IS NULL AND delivery_postal_code IS NULL)
    OR
    (delivery_address_line1 IS NOT NULL AND length(btrim(delivery_address_line1)) > 0
      AND delivery_city IS NOT NULL AND length(btrim(delivery_city)) > 0
      AND delivery_state_code IS NOT NULL AND delivery_state_code ~ '^[A-Z]{2}$'
      AND delivery_postal_code IS NOT NULL AND delivery_postal_code ~ '^[0-9]{5}$')
  );
