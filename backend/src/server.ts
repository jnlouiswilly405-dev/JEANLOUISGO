import express from 'express';
import cors from 'cors';
import { z } from 'zod';
import { orderRouter } from './modules/orders/order.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { merchantRouter } from './modules/merchants/merchant.routes.js';
import { catalogRouter } from './modules/catalog/catalog.routes.js';
import { paymentRouter } from './modules/payments/payment.routes.js';
import { finalRouter } from './modules/final-routes/routes.js';
import { pool } from './db/pool.js';
import { env } from './config/env.js';

const app = express();
const allowedOrigins = (env.CORS_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

// In production, browser origins must be explicitly allow-listed. Requests without
// an Origin header (health checks and server-to-server calls) remain supported.
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || env.NODE_ENV !== 'production') return callback(null, true);
    return callback(null, allowedOrigins.includes(origin));
  },
}));
app.use(express.json());

// Liveness: confirms the HTTP process is running; it does not imply database readiness.
app.get('/health', (_req, res) => res.json({ service: 'jeanlouisgo-api', status: 'alive' }));
app.get('/health/live', (_req, res) => res.json({ service: 'jeanlouisgo-api', status: 'alive' }));

// Readiness: only report ready when the database connection is usable.
app.get('/health/ready', async (_req, res) => {
  if (!pool) {
    return res.status(503).json({ service: 'jeanlouisgo-api', status: 'not_ready', dependency: 'database' });
  }
  try {
    await pool.query('SELECT 1');
    return res.json({ service: 'jeanlouisgo-api', status: 'ready', dependencies: { database: 'ok' } });
  } catch {
    return res.status(503).json({ service: 'jeanlouisgo-api', status: 'not_ready', dependency: 'database' });
  }
});
app.use('/api/auth', authRouter);
app.use('/api/orders', orderRouter);
app.use('/api/merchants', merchantRouter);
app.use('/api/catalog', catalogRouter);
app.use('/api/payments', paymentRouter);
app.use('/api', finalRouter);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // Do not expose SQL, provider, filesystem, or stack details to production clients.
  if (env.NODE_ENV !== 'production') {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return res.status(500).json({ error: message });
  }
  return res.status(500).json({ error: 'Internal server error' });
});

const port = Number(process.env.PORT ?? 4000);
if (process.env.NODE_ENV !== 'test') app.listen(port, () => console.log(`MULTIGO API listening on :${port}`));

export { app, z };
