CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE TYPE user_role AS ENUM ('CUSTOMER','DRIVER','MERCHANT','ADMIN');
CREATE TYPE order_status AS ENUM ('PENDING_PAYMENT','PAID','ACCEPTED','PREPARING','READY','ASSIGNED','PICKED_UP','IN_TRANSIT','DELIVERED','CANCELLED','REFUNDED');
CREATE TABLE users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL, role user_role NOT NULL, password_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE merchants (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), owner_user_id UUID NOT NULL REFERENCES users(id), name TEXT NOT NULL, active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE drivers (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id), active BOOLEAN NOT NULL DEFAULT true, available BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE products (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), merchant_id UUID NOT NULL REFERENCES merchants(id), name TEXT NOT NULL, description TEXT, price_cents INTEGER NOT NULL CHECK(price_cents>=0), active BOOLEAN NOT NULL DEFAULT true);
CREATE TABLE orders (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), customer_id UUID NOT NULL REFERENCES users(id), merchant_id UUID NOT NULL REFERENCES merchants(id), driver_id UUID REFERENCES drivers(id), status order_status NOT NULL DEFAULT 'PENDING_PAYMENT', subtotal_cents INTEGER NOT NULL, delivery_fee_cents INTEGER NOT NULL DEFAULT 0, total_cents INTEGER NOT NULL, currency CHAR(3) NOT NULL DEFAULT 'USD', created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE order_items (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE, product_id UUID NOT NULL REFERENCES products(id), name_snapshot TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity>0), unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents>=0));
CREATE TABLE payments (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), order_id UUID NOT NULL REFERENCES orders(id), provider TEXT NOT NULL, provider_reference TEXT UNIQUE, amount_cents INTEGER NOT NULL, status TEXT NOT NULL, idempotency_key TEXT UNIQUE NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE ledger_entries (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), order_id UUID REFERENCES orders(id), account_type TEXT NOT NULL, account_id UUID, direction TEXT NOT NULL CHECK(direction IN ('DEBIT','CREDIT')), amount_cents INTEGER NOT NULL CHECK(amount_cents>=0), currency CHAR(3) NOT NULL DEFAULT 'USD', created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX idx_orders_customer ON orders(customer_id,created_at DESC);
CREATE INDEX idx_orders_merchant_status ON orders(merchant_id,status,created_at DESC);
CREATE INDEX idx_orders_driver_status ON orders(driver_id,status,created_at DESC);

CREATE INDEX IF NOT EXISTS idx_products_merchant_active ON products(merchant_id, active, name);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_order ON ledger_entries(order_id, created_at DESC);

CREATE TABLE IF NOT EXISTS payment_events (
  event_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payment_id UUID NOT NULL REFERENCES payments(id),
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider,event_id)
);
CREATE TABLE IF NOT EXISTS refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES payments(id),
  order_id UUID NOT NULL REFERENCES orders(id),
  amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
  status TEXT NOT NULL CHECK(status IN ('PENDING','SUCCEEDED','FAILED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payment_events_payment ON payment_events(payment_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_refunds_payment ON refunds(payment_id,created_at DESC);
