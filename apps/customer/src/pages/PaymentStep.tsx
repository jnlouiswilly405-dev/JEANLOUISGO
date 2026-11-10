import { useEffect, useRef, useState } from 'react';
import { loadStripe, type Stripe, type StripeElements } from '@stripe/stripe-js';
import { ErrorBanner, useLocalization, useSession } from '@multigo/app-shell';

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
  const { t } = useLocalization();
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
      if (!payment.clientSecret) throw new Error(t('serverNoPaymentSession'));
      const s = await loadStripeImpl(publishableKey);
      if (!s) throw new Error(t('couldNotLoadPaymentLibrary'));
      setStripe(s);
      setElements(s.elements({ clientSecret: payment.clientSecret }));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('couldNotStartPayment'));
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
      if (res.error) setError(res.error.message ?? t('paymentFailed'));
      else { setSubmitted(true); onSubmitted(); }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('paymentFailed'));
    } finally {
      setBusy(false);
    }
  }

  if (!keyOk) {
    return <p className="muted">{t('paymentUnavailable')}</p>;
  }
  if (submitted) {
    return <p role="status">{t('paymentSubmitted')}</p>;
  }
  return (
    <div aria-label={t('payment')}>
      <p className="banner">{t('testModeNoCharge')}</p>
      <ErrorBanner message={error} />
      {!elements && <button onClick={start} disabled={busy}>{t('payByCard')}</button>}
      <div ref={mountRef} />
      {elements && <button onClick={confirm} disabled={busy}>{t('confirmPayment')}</button>}
    </div>
  );
}
