import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { createOrder, getOrderForActor, listOrdersForActor, transitionOrderForActor } from './order.service.js';

export const orderRouter=Router();
const deliveryAddressSchema = z.object({
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1).max(100),
  stateCode: z.string().trim().regex(/^[A-Za-z]{2}$/).transform((value) => value.toUpperCase()),
  postalCode: z.string().regex(/^[0-9]{5}$/),
});
const createSchema=z.object({customerId:z.string().uuid().optional(),merchantId:z.string().uuid(),items:z.array(z.object({productId:z.string().uuid(),quantity:z.number().int().positive()})).min(1),deliveryAddress:deliveryAddressSchema,deliveryFeeCents:z.number().int().nonnegative().optional(),promoCode:z.string().trim().min(1).max(64).optional()});
const statusSchema=z.object({status:z.enum(['PAID','ACCEPTED','PREPARING','READY','ASSIGNED','PICKED_UP','IN_TRANSIT','DELIVERED','CANCELLED','REFUNDED'])});

orderRouter.get('/', requireAuth, async (req,res)=>{ try { res.json(await listOrdersForActor(req.user!)); } catch { res.status(503).json({error:'Database unavailable'}); } });
orderRouter.get('/:id', requireAuth, async (req,res)=>{ try { const o=await getOrderForActor(req.params.id as string,req.user!); if(!o)return res.status(404).json({error:'Order not found'}); res.json(o); } catch { res.status(503).json({error:'Database unavailable'}); } });
orderRouter.post('/', requireAuth, requireRole('CUSTOMER','ADMIN'), async (req,res)=>{ const parsed=createSchema.safeParse(req.body); if(!parsed.success)return res.status(400).json({error:parsed.error.issues}); try { if(req.user!.role==='ADMIN' && !parsed.data.customerId) return res.status(400).json({error:'customerId is required for admin-created orders'}); const { customerId: requestedCustomerId, ...orderInput } = parsed.data; const order=await createOrder({customerId:req.user!.role==='ADMIN' ? requestedCustomerId! : req.user!.id, ...orderInput}); if(req.user!.role==='ADMIN') delete order.deliveryAddress; res.status(201).json(order); } catch(e){ const message=e instanceof Error?e.message:'Unable to create order'; res.status(message==='DELIVERY_AREA_UNAVAILABLE'?409:400).json({error:message}); } });
orderRouter.post('/:id/status', requireAuth, requireRole('ADMIN','MERCHANT','DRIVER'), async (req,res)=>{ const parsed=statusSchema.safeParse(req.body); if(!parsed.success)return res.status(400).json({error:parsed.error.issues}); try{return res.json(await transitionOrderForActor(req.params.id as string,parsed.data.status,req.user!));}catch(e){const forbidden=e instanceof Error && e.message==='ORDER_FORBIDDEN';return res.status(forbidden?403:409).json({error:e instanceof Error?e.message:'Invalid transition'});}});
