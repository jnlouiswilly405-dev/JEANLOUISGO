import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { createPayment, handleWebhook, refundPayment } from './payment.service.js';
import { getStripeProvider } from './provider.js';
import { mapStripeEvent } from './stripe-provider.js';

export const paymentRouter = Router();

/**
 * Stripe (test mode) webhook. Must be mounted with express.raw() BEFORE express.json() so the exact
 * bytes Stripe signed are available. All payment fields come from the verified event, never from the client.
 */
export async function stripeWebhookHandler(req: Request, res: Response) {
  let provider;
  try { provider = getStripeProvider(); }
  catch { return res.status(503).json({ error: 'PAYMENT_PROVIDER_NOT_IMPLEMENTED: live payment processing is disabled' }); }
  const signature = req.header('stripe-signature');
  if (!signature || !Buffer.isBuffer(req.body)) return res.status(400).json({ error: 'Invalid webhook signature' });
  const rawBody = req.body.toString('utf8');
  let mapped;
  try { mapped = mapStripeEvent(provider.constructEvent(req.body, signature)); }
  catch (e) {
    const message = e instanceof Error && e.message === 'WEBHOOK_PAYMENT_ID_MISSING' ? e.message : 'Invalid webhook signature';
    return res.status(400).json({ error: message });
  }
  if (!mapped) return res.json({ ignored: true });
  try { return res.json(await handleWebhook({ provider: 'stripe', ...mapped, rawBody, signature })); }
  catch (e) { return res.status(400).json({ error: e instanceof Error ? e.message : 'Webhook rejected' }); }
}
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
  // Stripe webhooks are never accepted from client-supplied JSON fields; see stripeWebhookHandler.
  if(providerParsed.data==='stripe')return res.status(400).json({error:'Stripe webhooks require a signed raw request body'});
  const parsed=webhookSchema.safeParse(req.body); if(!parsed.success)return res.status(400).json({error:parsed.error.issues});
  try { const result=await handleWebhook({provider:providerParsed.data,...parsed.data}); return res.json(result); }
  catch(e){ return res.status(400).json({error:e instanceof Error?e.message:'Webhook rejected'}); }
});

paymentRouter.post('/:paymentId/refund', requireAuth, requireRole('ADMIN'), async (req,res) => {
  const parsed=refundSchema.safeParse(req.body); if(!parsed.success)return res.status(400).json({error:parsed.error.issues});
  try{return res.status(201).json(await refundPayment(req.params.paymentId as string,parsed.data.amountCents));}catch(e){return res.status(409).json({error:e instanceof Error?e.message:'Refund failed'});}
});
