import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development','test','production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1).optional(),
  JWT_SECRET: z.string().min(32).default('dev-only-change-this-secret-before-production-123456'),
  JWT_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  // Stripe TEST-mode key only (sk_test_... or rk_test_...). Live keys are rejected; unset keeps Stripe disabled.
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  // Comma-separated exact browser origins, e.g. https://app.example.com
  CORS_ORIGINS: z.string().optional(),
  // Off unless exactly "true". Runs the fail-closed outbox worker; it never creates financial records.
  OUTBOX_WORKER_ENABLED: z.string().optional(),
});

const parsedEnv = envSchema.parse(process.env);
const developmentJwtSecret = 'dev-only-change-this-secret-before-production-123456';
if (parsedEnv.NODE_ENV === 'production' && parsedEnv.JWT_SECRET === developmentJwtSecret) {
  throw new Error('JWT_SECRET must be explicitly configured with a strong secret in production');
}
if (parsedEnv.NODE_ENV === 'production' && !parsedEnv.DATABASE_URL) {
  throw new Error('DATABASE_URL is required in production');
}
export const env = parsedEnv;
