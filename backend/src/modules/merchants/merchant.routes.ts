import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db/pool.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';

export const merchantRouter = Router();
const createSchema = z.object({ name: z.string().min(2).max(160) });

merchantRouter.get('/', async (_req, res) => {
  try {
    const result = await query('SELECT id,name,owner_user_id,active,created_at FROM merchants WHERE active=true ORDER BY name');
    return res.json(result.rows);
  } catch { return res.status(503).json({ error: 'Database unavailable' }); }
});

merchantRouter.post('/', requireAuth, requireRole('MERCHANT','ADMIN'), async (req,res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
  try {
    const result = await query('INSERT INTO merchants(owner_user_id,name) VALUES($1,$2) RETURNING id,name,owner_user_id,active,created_at', [req.user!.id, parsed.data.name]);
    return res.status(201).json(result.rows[0]);
  } catch { return res.status(500).json({ error: 'Unable to create merchant' }); }
});
