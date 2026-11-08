import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { createOrder, getOrderForActor, listOrdersForActor, transitionOrderForActor } from './order.service.js';

export const orderRouter=Router();
const createSchema=z.object({customerId:z.string().uuid().optional(),merchantId:z.string().uuid(),items:z.array(z.object({productId:z.string().uuid(),quantity:z.number().int().positive()})).min(1),deliveryFeeCents:z.number().int().nonnegative().optional()});
const statusSchema=z.object({status:z.enum(['PAID','ACCEPTED','PREPARING','READY','ASSIGNED','PICKED_UP','IN_TRANSIT','DELIVERED','CANCELLED','REFUNDED'])});

orderRouter.get('/', requireAuth, async (req,res)=>{ try { res.json(await listOrdersForActor(req.user!)); } catch { res.status(503).json({error:'Database unavailable'}); } });
orderRouter.get('/:id', requireAuth, async (req,res)=>{ try { const o=await getOrderForActor(req.params.id,req.user!); if(!o)return res.status(404).json({error:'Order not found'}); res.json(o); } catch { res.status(503).json({error:'Database unavailable'}); } });
orderRouter.post('/', requireAuth, requireRole('CUSTOMER','ADMIN'), async (req,res)=>{ const parsed=createSchema.safeParse(req.body); if(!parsed.success)return res.status(400).json({error:parsed.error.issues}); try { if(req.user!.role==='ADMIN' && !parsed.data.customerId) return res.status(400).json({error:'customerId is required for admin-created orders'}); const { customerId: requestedCustomerId, ...orderInput } = parsed.data; const order=await createOrder({customerId:req.user!.role==='ADMIN' ? requestedCustomerId! : req.user!.id, ...orderInput}); res.status(201).json(order); } catch(e){ res.status(400).json({error:e instanceof Error?e.message:'Unable to create order'}); } });
orderRouter.post('/:id/status', requireAuth, requireRole('ADMIN','MERCHANT','DRIVER'), async (req,res)=>{ const parsed=statusSchema.safeParse(req.body); if(!parsed.success)return res.status(400).json({error:parsed.error.issues}); try{return res.json(await transitionOrderForActor(req.params.id,parsed.data.status,req.user!));}catch(e){const forbidden=e instanceof Error && e.message==='ORDER_FORBIDDEN';return res.status(forbidden?403:409).json({error:e instanceof Error?e.message:'Invalid transition'});}});
