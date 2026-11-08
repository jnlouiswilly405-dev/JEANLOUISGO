import { useEffect, useRef, useState } from 'react';
import { loadStripe, type Stripe, type StripeElements } from '@stripe/stripe-js';
import { ErrorBanner, useSession } from '@multigo/app-shell';

type LoadStripe = (key: string) => Promise<Stripe | null>;

export const isTestPublishableKey = (key: unknown): key is string => typeof key === 'string' && key.startsWith('pk_test_');

interface Props {
  orderId: string;
  amountCents: number;
  onSubmitted(): void;
  publishableKey?: string;
  loadStripeImpl?: LoadStripe;
}

/**
 * Sandbox-only card payment. Only `pk_test_` publishable keys are accepted; anything else disables the form.
 * The order becomes PAID solely through the backend's verified webhook, never from this component.
 */
export function PaymentStep({ orderId, amountCents, onSubmitted, publishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY, loadStripeImpl = loadStripe }: Props) {
  const { client } = useSession();
  const mountRef = useRef<HTMLDivElement>(null);
  const idempotencyKey = useRef(`order-${orderId}-${crypto.randomUUID()}`);
  const [stripe, setStripe] = useState<Stripe | null>(null);
  const [elements, setElements] = useState<StripeElements | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const keyOk = isTestPublishableKey(publishableKey);

  async function start() {
    if (!keyOk) return;
    setBusy(true);
    setError(null);
    try {
      const payment = await client.payments.create({ orderId, provider: 'stripe', amountCents, idempotencyKey: idempotencyKey.current });
      if (!payment.clientSecret) throw new Error('The server did not return a payment session.');
      const s = await loadStripeImpl(publishableKey);
      if (!s) throw new Error('Could not load the payment library.');
      setStripe(s);
      setElements(s.elements({ clientSecret: payment.clientSecret }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start payment');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!elements || !mountRef.current) return;
    const el = elements.create('payment');
    el.mount(mountRef.current);
    return () => el.destroy();
  }, [elements]);

  async function confirm() {
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    try {
      const res = await stripe.confirmPayment({ elements, confirmParams: { return_url: window.location.href }, redirect: 'if_required' });
      if (res.error) setError(res.error.message ?? 'Payment failed');
      else { setSubmitted(true); onSubmitted(); }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Payment failed');
    } finally {
      setBusy(false);
    }
  }

  if (!keyOk) {
    return <p className="muted">Card payment is unavailable: a Stripe test publishable key (pk_test_…) is not configured. Live keys are refused.</p>;
  }
  if (submitted) {
    return <p role="status">Payment submitted. Waiting for the server to confirm it; the order will update automatically.</p>;
  }
  return (
    <div aria-label="Payment">
      <p className="banner">Test mode — no real money is charged.</p>
      <ErrorBanner message={error} />
      {!elements && <button onClick={start} disabled={busy}>Pay by card</button>}
      <div ref={mountRef} />
      {elements && <button onClick={confirm} disabled={busy}>Confirm payment</button>}
    </div>
  );
}
