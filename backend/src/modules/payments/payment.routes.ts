import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { createPayment, handleWebhook, refundPayment } from './payment.service.js';

export const paymentRouter = Router();
const schema = z.object({ orderId:z.string().uuid(), provider:z.enum(['mock','stripe']), amountCents:z.number().int().positive(), idempotencyKey:z.string().min(16).max(128) });
const webhookSchema = z.object({ eventId:z.string().min(8), type:z.enum(['PAYMENT_SUCCEEDED','PAYMENT_FAILED']), paymentId:z.string().uuid(), status:z.enum(['SUCCEEDED','FAILED']), amountCents:z.number().int().positive().safe(), currency:z.string().regex(/^[A-Za-z]{3}$/), providerReference:z.string().min(1).max(255), rawBody:z.string().min(2), signature:z.string().min(1) });
const refundSchema = z.object({ amountCents:z.number().int().positive() });

paymentRouter.post('/', requireAuth, requireRole('CUSTOMER','ADMIN'), async (req,res) => {
  const parsed=schema.safeParse(req.body); if(!parsed.success)return res.status(400).json({error:parsed.error.issues});
  try{return res.status(201).json(await createPayment(parsed.data, req.user!));}catch(e){const forbidden=e instanceof Error && e.message==='ORDER_FORBIDDEN';return res.status(forbidden?403:409).json({error:e instanceof Error?e.message:'Payment failed'});}
});

paymentRouter.post('/webhook/:provider', async (req,res) => {
  const providerParsed=z.enum(['mock','stripe']).safeParse(req.params.provider);
  if(!providerParsed.success)return res.status(400).json({error:'Unsupported payment provider'});
  const parsed=webhookSchema.safeParse(req.body); if(!parsed.success)return res.status(400).json({error:parsed.error.issues});
  try { const result=await handleWebhook({provider:providerParsed.data,...parsed.data}); return res.json(result); }
  catch(e){ return res.status(400).json({error:e instanceof Error?e.message:'Webhook rejected'}); }
});

paymentRouter.post('/:paymentId/refund', requireAuth, requireRole('ADMIN'), async (req,res) => {
  const parsed=refundSchema.safeParse(req.body); if(!parsed.success)return res.status(400).json({error:parsed.error.issues});
  try{return res.status(201).json(await refundPayment(req.params.paymentId as string,parsed.data.amountCents));}catch(e){return res.status(409).json({error:e instanceof Error?e.message:'Refund failed'});}
});
