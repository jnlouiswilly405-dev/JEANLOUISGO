import { Router } from 'express';
import { z } from 'zod';
import { login, register } from './auth.service.js';
import { requireAuth } from '../../middleware/auth.js';

export const authRouter = Router();
const registerSchema = z.object({ email: z.string().email(), displayName: z.string().min(2).max(100), password: z.string().min(8).max(200), role: z.literal('CUSTOMER').optional() });
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(8).max(200) });

authRouter.post('/register', async (req,res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
  try { return res.status(201).json(await register(parsed.data)); }
  catch (e) { return res.status(409).json({ error: e instanceof Error ? e.message : 'Registration failed' }); }
});

authRouter.post('/login', async (req,res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
  try { return res.json(await login(parsed.data)); }
  catch { return res.status(401).json({ error: 'Invalid email or password' }); }
});

authRouter.get('/me', requireAuth, (req,res) => res.json({ user: req.user }));
