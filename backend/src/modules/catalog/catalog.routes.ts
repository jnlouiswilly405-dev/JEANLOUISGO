import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db/pool.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';

export const catalogRouter = Router();
const createSchema = z.object({ merchantId: z.string().uuid(), name: z.string().min(1).max(200), description: z.string().max(2000).optional(), priceCents: z.number().int().nonnegative() });

catalogRouter.get('/merchant/:merchantId', async (req,res) => {
  try {
    const result = await query('SELECT id,merchant_id,name,description,price_cents,active FROM products WHERE merchant_id=$1 AND active=true ORDER BY name', [req.params.merchantId]);
    return res.json(result.rows);
  } catch { return res.status(503).json({ error: 'Database unavailable' }); }
});

catalogRouter.post('/', requireAuth, requireRole('MERCHANT','ADMIN'), async (req,res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
  try {
    const ownership = req.user!.role === 'ADMIN'
      ? await query('SELECT id FROM merchants WHERE id=$1', [parsed.data.merchantId])
      : await query('SELECT id FROM merchants WHERE id=$1 AND owner_user_id=$2', [parsed.data.merchantId, req.user!.id]);
    if (!ownership.rowCount) return res.status(403).json({ error: 'Merchant access denied' });
    const result = await query('INSERT INTO products(merchant_id,name,description,price_cents) VALUES($1,$2,$3,$4) RETURNING id,merchant_id,name,description,price_cents,active', [parsed.data.merchantId,parsed.data.name,parsed.data.description ?? null,parsed.data.priceCents]);
    return res.status(201).json(result.rows[0]);
  } catch { return res.status(500).json({ error: 'Unable to create product' }); }
});
