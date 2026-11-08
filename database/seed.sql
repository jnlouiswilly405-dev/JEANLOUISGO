-- Development seed. Run only against a disposable development database.
INSERT INTO users (email, display_name, role, password_hash)
VALUES ('merchant.demo@multigo.local', 'Demo Merchant', 'MERCHANT', 'DEV_ONLY_SET_VIA_AUTH')
ON CONFLICT (email) DO NOTHING;
