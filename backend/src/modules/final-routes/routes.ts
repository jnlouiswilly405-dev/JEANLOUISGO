import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { recordDriverLocation, getOrderTracking } from '../tracking/service.js';
import { advanceDelivery } from '../delivery/service.js';
import { createNotification, listNotifications, markNotificationRead } from '../notifications/service.js';
import { sendMessage, listMessages } from '../chat/service.js';
import { createReview } from '../reviews/service.js';
import { validatePromo } from '../promos/service.js';
import { listEligibleDriverEarnings, listEligibleMerchantSettlements } from '../settlements/service.js';
import { getAdminOrderFinancialSummary, getSystemHealth, listBlockedOutboxEvents, listUnreferencedStripePayments } from '../admin/service.js';
import { pool } from '../../db/pool.js';

export const finalRouter = Router();
const requireDb = () => { if (!pool) throw new Error('DATABASE_URL is not configured'); return pool; };

finalRouter.post('/drivers/:driverId/location', requireAuth, requireRole('DRIVER','ADMIN'), async (req,res)=>{
  const s=z.object({lat:z.number().min(-90).max(90),lng:z.number().min(-180).max(180),orderId:z.string().uuid().optional(),accuracyM:z.number().nonnegative().optional()}).safeParse(req.body);
  if(!s.success)return res.status(400).json({error:s.error.issues});
  try {
    const db = requireDb();
    const profile = await db.query(`SELECT id FROM driver_profiles WHERE user_id=$1`, [req.user!.id]);
    if (req.user!.role !== 'ADMIN' && (!profile.rows[0] || profile.rows[0].id !== req.params.driverId)) return res.status(403).json({error:'Driver profile access denied'});
    res.status(201).json(await recordDriverLocation(db,req.params.driverId as string,s.data.lat,s.data.lng,s.data.orderId,s.data.accuracyM));
  } catch(e){res.status(409).json({error:e instanceof Error?e.message:'Location failed'});}
});

finalRouter.get('/orders/:orderId/tracking', requireAuth, async (req,res)=>{
  try {
    const db = requireDb();
    if (req.user!.role !== 'ADMIN') {
      const access = await db.query(`SELECT 1 FROM orders o LEFT JOIN merchants m ON m.id=o.merchant_id LEFT JOIN driver_profiles dp ON dp.id=o.driver_profile_id LEFT JOIN drivers d ON d.id=o.driver_id WHERE o.id=$1 AND (o.customer_id=$2 OR m.owner_user_id=$2 OR dp.user_id=$2 OR d.user_id=$2)`, [req.params.orderId, req.user!.id]);
      if (!access.rowCount) return res.status(404).json({error:'Order not found'});
    }
    res.json(await getOrderTracking(db,req.params.orderId as string));
  } catch(e){res.status(503).json({error:e instanceof Error?e.message:'Tracking unavailable'});}
});

finalRouter.post('/orders/:orderId/delivery', requireAuth, requireRole('DRIVER','ADMIN'), async (req,res)=>{
  const s=z.object({action:z.enum(['PICKED_UP','DELIVERED']),metadata:z.record(z.string(),z.unknown()).optional()}).safeParse(req.body);
  if(!s.success)return res.status(400).json({error:s.error.issues});
  try { res.json(await advanceDelivery(requireDb(),req.params.orderId as string,req.user!.id,s.data.action,s.data.metadata ?? {})); }
  catch(e){res.status(409).json({error:e instanceof Error?e.message:'Delivery transition failed'});}
});

finalRouter.get('/notifications', requireAuth, async (req,res)=>{
  try { res.json(await listNotifications(requireDb(),req.user!.id)); } catch(e){res.status(503).json({error:e instanceof Error?e.message:'Notifications unavailable'});}
});
finalRouter.post('/notifications/:id/read', requireAuth, async (req,res)=>{
  try { res.json(await markNotificationRead(requireDb(),req.user!.id,req.params.id as string)); } catch(e){res.status(404).json({error:e instanceof Error?e.message:'Notification not found'});}
});

finalRouter.get('/chat/:threadId/messages', requireAuth, async (req,res)=>{
  try { res.json(await listMessages(requireDb(),req.params.threadId as string,req.user!.id)); } catch(e){res.status(403).json({error:e instanceof Error?e.message:'Chat unavailable'});}
});
finalRouter.post('/chat/:threadId/messages', requireAuth, async (req,res)=>{
  const s=z.object({body:z.string().min(1).max(4000),messageType:z.string().max(30).optional()}).safeParse(req.body);
  if(!s.success)return res.status(400).json({error:s.error.issues});
  try { res.status(201).json(await sendMessage(requireDb(),req.params.threadId as string,req.user!.id,s.data.body,s.data.messageType)); } catch(e){res.status(403).json({error:e instanceof Error?e.message:'Message failed'});}
});

finalRouter.post('/reviews', requireAuth, requireRole('CUSTOMER','ADMIN'), async (req,res)=>{
  const s=z.object({orderId:z.string().uuid(),rating:z.number().int().min(1).max(5),body:z.string().max(5000).optional(),subjectUserId:z.string().uuid().optional(),merchantId:z.string().uuid().optional()}).safeParse(req.body);
  if(!s.success)return res.status(400).json({error:s.error.issues});
  try { res.status(201).json(await createReview(requireDb(),s.data.orderId,req.user!.id,s.data.rating,s.data.body,s.data.subjectUserId,s.data.merchantId)); } catch(e){const m=e instanceof Error?e.message:'Review failed';const code=m==='ORDER_NOT_FOUND'?404:m==='REVIEW_FORBIDDEN'?403:m==='INVALID_RATING'?400:409;res.status(code).json({error:m});}
});

finalRouter.post('/promos/validate', requireAuth, async (req,res)=>{
  const s=z.object({code:z.string().min(1).max(64),orderTotal:z.number().nonnegative()}).safeParse(req.body);
  if(!s.success)return res.status(400).json({error:s.error.issues});
  try { res.json(await validatePromo(requireDb(),s.data.code,req.user!.id,s.data.orderTotal)); } catch(e){res.status(409).json({error:e instanceof Error?e.message:'Promo invalid'});}
});

finalRouter.get('/drivers/:driverId/earnings', requireAuth, requireRole('DRIVER','ADMIN'), async (req,res)=>{
  try {
    const db = requireDb();
    if (req.user!.role !== 'ADMIN') {
      const ownership = await db.query(
        `SELECT 1 FROM driver_profiles WHERE id=$1 AND user_id=$2`,
        [req.params.driverId, req.user!.id]
      );
      if (!ownership.rowCount) return res.status(403).json({error:'Driver earnings access denied'});
    }
    res.json(await listEligibleDriverEarnings(db,req.params.driverId as string));
  } catch(e){res.status(503).json({error:e instanceof Error?e.message:'Earnings unavailable'});}
});
finalRouter.get('/merchants/:merchantId/settlements', requireAuth, requireRole('MERCHANT','ADMIN'), async (req,res)=>{
  try {
    const db = requireDb();
    if (req.user!.role !== 'ADMIN') {
      const ownership = await db.query(`SELECT 1 FROM merchants WHERE id=$1 AND owner_user_id=$2`, [req.params.merchantId, req.user!.id]);
      if (!ownership.rowCount) return res.status(403).json({error:'Merchant access denied'});
    }
    res.json(await listEligibleMerchantSettlements(db,req.params.merchantId as string));
  } catch(e){res.status(503).json({error:e instanceof Error?e.message:'Settlements unavailable'});}
});

finalRouter.get('/admin/financial-summary', requireAuth, requireRole('ADMIN'), async (_req,res)=>{
  try { res.json(await getAdminOrderFinancialSummary(requireDb())); } catch(e){res.status(503).json({error:e instanceof Error?e.message:'Summary unavailable'});}
});
finalRouter.get('/admin/health', requireAuth, requireRole('ADMIN'), async (_req,res)=>{
  try { res.json(await getSystemHealth(requireDb())); } catch(e){res.status(503).json({error:e instanceof Error?e.message:'Database unavailable'});}
});
finalRouter.get('/admin/outbox/blocked', requireAuth, requireRole('ADMIN'), async (req,res)=>{
  const q=z.object({eventType:z.string().min(1).max(100).optional(),aggregateId:z.string().uuid().optional(),limit:z.coerce.number().int().min(1).max(100).default(50),offset:z.coerce.number().int().min(0).default(0)}).safeParse(req.query);
  if(!q.success)return res.status(400).json({error:q.error.issues});
  try { res.json(await listBlockedOutboxEvents(requireDb(), q.data)); } catch(e){res.status(503).json({error:'Outbox events unavailable'});}
});
finalRouter.get('/admin/payments/unreferenced', requireAuth, requireRole('ADMIN'), async (req,res)=>{
  const q=z.object({olderThanMinutes:z.coerce.number().int().min(0).max(10080).default(15),limit:z.coerce.number().int().min(1).max(100).default(50),offset:z.coerce.number().int().min(0).default(0)}).safeParse(req.query);
  if(!q.success)return res.status(400).json({error:q.error.issues});
  try { res.json(await listUnreferencedStripePayments(requireDb(), q.data)); } catch(e){res.status(503).json({error:'Payment report unavailable'});}
});
