'use strict';
const express = require('express');
const { query } = require('./db');
const { asyncHandler, authRequired } = require('./middleware');
const { currentSubscription, upsertSubscription, publicEntitlementMatrix, hasFeature } = require('./entitlements');

const router = express.Router();

const PLANS = [
  { id: 'free', name: 'Free Preview', price: '$0', monthlyCents: 0, interval: null, description: 'Placement and progress dashboard. Unlock your first lesson for a one-time $3.' },
  { id: 'premium', name: 'Premium Monthly', price: '$19.99/mo', monthlyCents: 1999, interval: 'month', description: 'Full A1-C2 curriculum, adaptive practice, writing/speaking tasks, review tools, and certificates.' },
  { id: 'annual', name: 'Premium Annual', price: '$159/yr', monthlyCents: 1325, interval: 'year', description: 'Full Premium access with annual savings for committed learners.' },
  { id: 'live', name: 'Premium + Live', price: '$59.99/mo', monthlyCents: 5999, interval: 'month', description: 'Premium learning plus monthly live conversation credits and tutor booking access.' },
];

const PLAN_BASE_CENTS = { premium: 1999, annual: 15900, live: 5999 };
const PLAN_PRICE_ENV = {
  premium: 'STRIPE_PRICE_PREMIUM_MONTHLY',
  annual: 'STRIPE_PRICE_PREMIUM_ANNUAL',
  live: 'STRIPE_PRICE_LIVE_MONTHLY',
};

// One-time price to unlock the Trial Lesson (the first lesson). Pay once, keep it forever.
const TRIAL_PRICE_CENTS = 300;

let stripe = null;
function isProduction() { return process.env.NODE_ENV === 'production'; }
function stripeClient() {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  if (!stripe) {
    const Stripe = require('stripe');
    stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return stripe;
}

function priceIdForPlan(planId) {
  const envKey = PLAN_PRICE_ENV[planId];
  return envKey ? process.env[envKey] : null;
}

function billingReadiness(planId = null) {
  const missing = [];
  if (!process.env.STRIPE_SECRET_KEY) missing.push('STRIPE_SECRET_KEY');
  if (!process.env.STRIPE_WEBHOOK_SECRET) missing.push('STRIPE_WEBHOOK_SECRET');
  const planIds = planId ? [planId] : ['premium', 'annual', 'live'];
  for (const id of planIds) {
    if (id !== 'free' && !priceIdForPlan(id)) missing.push(PLAN_PRICE_ENV[id]);
  }
  return { ready: missing.length === 0, missing };
}

function assertBillingReady(planId) {
  const readiness = billingReadiness(planId);
  if (!readiness.ready) {
    const err = new Error(`Billing is not configured: ${readiness.missing.join(', ')}`);
    err.status = isProduction() ? 503 : 422;
    err.code = 'billing_not_configured';
    err.missing = readiness.missing;
    throw err;
  }
}

function validateReturnUrl(value, fallback) {
  const raw = value || fallback;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (isProduction() && url.protocol !== 'https:') return null;
    const allowed = (process.env.FRONTEND_URL || '').split(',').map((v) => v.trim()).filter(Boolean);
    if (isProduction() && allowed.length) {
      const allowedOrigins = allowed.map((item) => new URL(item).origin);
      if (!allowedOrigins.includes(url.origin)) return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

router.get('/plans', asyncHandler(async (req, res) => {
  const readiness = billingReadiness();
  res.json({
    plans: PLANS,
    entitlements: publicEntitlementMatrix(),
    mode: stripeClient() && readiness.ready ? 'stripe' : 'not_configured',
    productionReady: readiness.ready,
    missing: readiness.missing,
  });
}));

router.use(authRequired);

router.get('/subscription', asyncHandler(async (req, res) => {
  res.json({ subscription: await currentSubscription(req.user.id), entitlements: publicEntitlementMatrix() });
}));

router.post('/checkout', asyncHandler(async (req, res) => {
  const plan = PLANS.find((p) => p.id === req.body?.plan && p.id !== 'free');
  if (!plan) return res.status(422).json({ error: 'invalid_plan' });

  const stripe = stripeClient();
  if (!stripe || !billingReadiness(plan.id).ready) {
    if (isProduction()) assertBillingReady(plan.id);
    const sub = await upsertSubscription({ userId: req.user.id, tier: plan.id, status: 'active', source: 'development' });
    await creditReferral(req.user.id, PLAN_BASE_CENTS[plan.id] || 1999, `Development ${plan.name} checkout`);
    return res.json({ developmentMode: true, subscription: sub, warning: 'Development-only subscription grant. Production checkout fails closed until Stripe and price IDs are configured.' });
  }

  const successUrl = validateReturnUrl(req.body.successUrl, `${process.env.FRONTEND_URL || 'http://localhost:5173'}/billing/success`);
  const cancelUrl = validateReturnUrl(req.body.cancelUrl, `${process.env.FRONTEND_URL || 'http://localhost:5173'}/billing/cancel`);
  if (!successUrl || !cancelUrl) return res.status(422).json({ error: 'invalid_return_url' });

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: priceIdForPlan(plan.id), quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: req.user.id,
    customer_email: req.user.email,
    // Managed Payments is on by default on this account and requires a product
    // tax code; disable it per-session so checkout completes (merchant handles tax).
    managed_payments: { enabled: false },
    metadata: { tier: plan.id, userId: req.user.id, product: 'eilps_subscription' },
  });
  res.json({ url: session.url, checkoutSessionId: session.id });
}));

// One-time $3 checkout that unlocks the Trial Lesson (the first lesson) for good.
// Premium subscribers never need this; a prior trial purchase short-circuits it.
router.post('/trial-checkout', asyncHandler(async (req, res) => {
  const sub = await currentSubscription(req.user.id);
  if (hasFeature(sub, 'premium_curriculum')) return res.json({ alreadyEntitled: true, reason: 'premium' });
  const existing = await query("SELECT 1 FROM trial_purchases WHERE user_id=$1 AND status='paid' LIMIT 1", [req.user.id]);
  if (existing.rows[0]) return res.json({ alreadyEntitled: true, reason: 'trial' });

  const stripe = stripeClient();
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
    if (isProduction()) {
      const err = new Error('Billing is not configured for the trial lesson.');
      err.status = 503; err.code = 'billing_not_configured';
      throw err;
    }
    await query(
      `INSERT INTO trial_purchases (user_id, amount_cents, status)
       VALUES ($1,$2,'paid')
       ON CONFLICT (user_id) DO UPDATE SET status='paid', updated_at=now()`,
      [req.user.id, TRIAL_PRICE_CENTS]
    );
    return res.json({ developmentMode: true, unlocked: true });
  }

  const successUrl = validateReturnUrl(req.body.successUrl, `${process.env.FRONTEND_URL || 'http://localhost:5173'}/learn?trial=unlocked`);
  const cancelUrl = validateReturnUrl(req.body.cancelUrl, `${process.env.FRONTEND_URL || 'http://localhost:5173'}/learn`);
  if (!successUrl || !cancelUrl) return res.status(422).json({ error: 'invalid_return_url' });

  const currency = (process.env.STRIPE_CURRENCY || 'usd').toLowerCase();
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      price_data: {
        currency,
        unit_amount: TRIAL_PRICE_CENTS,
        product_data: { name: 'EILPS Trial Lesson', description: 'One-time unlock of your first English lesson.' },
      },
      quantity: 1,
    }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: req.user.id,
    customer_email: req.user.email,
    managed_payments: { enabled: false },
    metadata: { kind: 'trial_lesson', userId: req.user.id, product: 'eilps_trial_lesson' },
  });
  res.json({ url: session.url, checkoutSessionId: session.id });
}));

async function creditReferral(userId, baseCents, note, sourceRef = null, metadata = {}) {
  const { rows } = await query(
    `SELECT * FROM referral_attributions
     WHERE user_id=$1 AND converted_at IS NULL AND expires_at > now()
     ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );
  const attr = rows[0];
  if (!attr || !attr.partner_user_id || attr.partner_user_id === userId) return null;
  const amount = Math.round(baseCents * 0.4);
  const inserted = await query(
    `INSERT INTO partner_ledger (user_id, kind, amount_cents, status, note, source_ref, metadata)
     VALUES ($1,'commission',$2,'pending',$3,$4,$5) RETURNING id`,
    [attr.partner_user_id, amount, note || 'Subscription commission', sourceRef, JSON.stringify({ attributionId: attr.id, linkId: attr.link_id, ...metadata })]
  );
  await query('UPDATE referral_attributions SET converted_at=now() WHERE id=$1', [attr.id]);
  await query('UPDATE partner_links SET conversions=conversions+1 WHERE id=$1', [attr.link_id]);
  return { partnerUserId: attr.partner_user_id, amountCents: amount, ledgerId: inserted.rows[0]?.id, sourceRef };
}

router.post('/portal', asyncHandler(async (req, res) => {
  const stripe = stripeClient();
  if (!stripe) {
    if (isProduction()) assertBillingReady();
    return res.json({ developmentMode: true, url: null });
  }
  const { rows } = await query('SELECT stripe_customer_id FROM billing_customers WHERE user_id=$1', [req.user.id]);
  if (!rows[0]?.stripe_customer_id) return res.status(404).json({ error: 'no_customer' });
  const returnUrl = validateReturnUrl(req.body.returnUrl, process.env.FRONTEND_URL);
  if (!returnUrl) return res.status(422).json({ error: 'invalid_return_url' });
  const session = await stripe.billingPortal.sessions.create({ customer: rows[0].stripe_customer_id, return_url: returnUrl });
  res.json({ url: session.url });
}));

router.post('/connect/onboard', asyncHandler(async (req, res) => {
  const stripe = stripeClient();
  if (!stripe) {
    if (isProduction()) assertBillingReady();
    await query(
      `INSERT INTO connect_accounts (user_id, status, payouts_enabled)
       VALUES ($1,'development',false)
       ON CONFLICT (user_id) DO UPDATE SET status='development', payouts_enabled=false`,
      [req.user.id]
    );
    return res.json({ connected: false, developmentMode: true, message: 'Stripe Connect is not configured in this environment.' });
  }
  const refreshUrl = validateReturnUrl(req.body.refreshUrl, process.env.FRONTEND_URL);
  const returnUrl = validateReturnUrl(req.body.returnUrl, process.env.FRONTEND_URL);
  if (!refreshUrl || !returnUrl) return res.status(422).json({ error: 'invalid_return_url' });
  const account = await stripe.accounts.create({ type: 'express', email: req.user.email, metadata: { userId: req.user.id } });
  await query(
    `INSERT INTO connect_accounts (user_id, stripe_account_id, status)
     VALUES ($1,$2,'created')
     ON CONFLICT (user_id) DO UPDATE SET stripe_account_id=$2, status='created', payouts_enabled=false, updated_at=now()`,
    [req.user.id, account.id]
  );
  const link = await stripe.accountLinks.create({ account: account.id, refresh_url: refreshUrl, return_url: returnUrl, type: 'account_onboarding' });
  res.json({ url: link.url });
}));

router.get('/connect/status', asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT status, payouts_enabled FROM connect_accounts WHERE user_id=$1', [req.user.id]);
  res.json({ connected: Boolean(rows[0]?.payouts_enabled), status: rows[0]?.status || 'not_started' });
}));

router.get('/connect/payouts', asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT kind, amount_cents, status, created_at FROM payout_items WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50', [req.user.id]);
  res.json({ payouts: rows });
}));

function stripeTs(seconds) {
  return seconds ? new Date(seconds * 1000).toISOString() : null;
}

async function handleSubscriptionEvent(sub) {
  const { rows } = await query('SELECT user_id FROM billing_customers WHERE stripe_customer_id=$1', [sub.customer]);
  const userId = rows[0]?.user_id || sub.metadata?.userId;
  if (!userId) return;
  await upsertSubscription({
    userId,
    customerId: sub.customer,
    subscriptionId: sub.id,
    tier: sub.metadata?.tier || sub.items?.data?.[0]?.price?.metadata?.tier || 'premium',
    status: sub.status,
    currentPeriodEnd: stripeTs(sub.current_period_end),
  });
}

async function stripeWebhook(req, res) {
  const stripe = stripeClient();
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
    if (isProduction()) return res.status(503).json({ error: 'stripe_webhook_not_configured' });
    return res.json({ received: true, developmentMode: true });
  }
  const sig = req.headers['stripe-signature'];
  const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  const recorded = await query(
    'INSERT INTO billing_events (stripe_event_id, type, payload) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING stripe_event_id',
    [event.id, event.type, JSON.stringify(event)]
  );
  if (!recorded.rowCount) return res.json({ received: true, duplicate: true });

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    if (session.metadata?.kind === 'live_booking') {
      await query(
        `UPDATE bookings SET status='confirmed', payment_status='paid', payment_ref=$2, checkout_session_id=$2, confirmed_at=now()
         WHERE id=$1 AND learner_id=$3`,
        [session.metadata.bookingId, session.id, session.metadata.userId]
      );
      await query(
        `UPDATE booking_payments SET status='paid', provider_ref=$2, updated_at=now(), metadata=metadata || $3::jsonb
         WHERE booking_id=$1`,
        [session.metadata.bookingId, session.id, JSON.stringify({ stripeSession: session.id, paidAt: new Date().toISOString() })]
      );
    } else if (session.metadata?.kind === 'trial_lesson') {
      await query(
        `INSERT INTO trial_purchases (user_id, stripe_session_id, payment_intent_id, amount_cents, currency, status)
         VALUES ($1,$2,$3,$4,$5,'paid')
         ON CONFLICT (user_id) DO UPDATE SET status='paid', stripe_session_id=EXCLUDED.stripe_session_id, payment_intent_id=EXCLUDED.payment_intent_id, updated_at=now()`,
        [session.client_reference_id || session.metadata?.userId, session.id, session.payment_intent || null, session.amount_total || TRIAL_PRICE_CENTS, session.currency || null]
      );
    } else {
      await query(
        `INSERT INTO billing_customers (user_id, stripe_customer_id)
         VALUES ($1,$2)
         ON CONFLICT (user_id) DO UPDATE SET stripe_customer_id=EXCLUDED.stripe_customer_id`,
        [session.client_reference_id || session.metadata?.userId, session.customer]
      );
      await upsertSubscription({
        userId: session.client_reference_id || session.metadata?.userId,
        customerId: session.customer,
        subscriptionId: session.subscription,
        tier: session.metadata?.tier || 'premium',
        status: 'active',
      });
      const referral = await creditReferral(
        session.client_reference_id || session.metadata?.userId,
        PLAN_BASE_CENTS[session.metadata?.tier || 'premium'] || 1999,
        `Stripe ${session.metadata?.tier || 'premium'} checkout`,
        session.id,
        { checkoutSessionId: session.id, subscriptionId: session.subscription, customerId: session.customer }
      );
      await query(
        `INSERT INTO billing_revenue_links (user_id, checkout_session_id, subscription_id, payment_intent_id, partner_ledger_id, amount_cents, currency, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [session.client_reference_id || session.metadata?.userId, session.id, session.subscription || null, session.payment_intent || null, referral?.ledgerId || null, session.amount_total || null, session.currency || null, JSON.stringify({ product: session.metadata?.product || 'eilps_subscription' })]
      );
    }
  }

  if (['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'].includes(event.type)) {
    await handleSubscriptionEvent(event.data.object);
  }

  if (event.type === 'invoice.paid') {
    const invoice = event.data.object;
    if (invoice.subscription) await query(`UPDATE subscriptions SET status='active', updated_at=now() WHERE stripe_subscription_id=$1`, [invoice.subscription]);
    await query(
      `UPDATE billing_revenue_links SET invoice_id=$2, charge_id=COALESCE($3,charge_id), payment_intent_id=COALESCE($4,payment_intent_id), status='paid', updated_at=now()
       WHERE subscription_id=$1 AND (invoice_id IS NULL OR invoice_id=$2)`,
      [invoice.subscription || null, invoice.id, typeof invoice.charge === 'string' ? invoice.charge : invoice.charge?.id || null, typeof invoice.payment_intent === 'string' ? invoice.payment_intent : invoice.payment_intent?.id || null]
    );
  }

  if (event.type === 'checkout.session.expired') {
    const session = event.data.object;
    if (session.metadata?.kind === 'live_booking') {
      await query(`UPDATE bookings SET status='payment_expired', payment_status='expired' WHERE id=$1 AND payment_status='unpaid'`, [session.metadata.bookingId]);
      await query(`UPDATE booking_payments SET status='expired', updated_at=now() WHERE booking_id=$1 AND status='created'`, [session.metadata.bookingId]);
    }
  }

  if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object;
    if (invoice.subscription) {
      await query(`UPDATE subscriptions SET status='past_due', updated_at=now() WHERE stripe_subscription_id=$1`, [invoice.subscription]);
    }
  }

  if (event.type === 'charge.refunded') {
    const charge = event.data.object;
    const link = await query(
      `SELECT brl.*, pl.user_id partner_user_id, pl.amount_cents commission_cents, pl.status commission_status
       FROM billing_revenue_links brl
       LEFT JOIN partner_ledger pl ON pl.id=brl.partner_ledger_id
       WHERE brl.charge_id=$1 OR brl.payment_intent_id=$2
       ORDER BY brl.created_at DESC LIMIT 1`,
      [charge.id, typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id || null]
    );
    const row = link.rows[0];
    if (row?.partner_ledger_id && row.partner_user_id) {
      const refundable = Math.abs(Number(row.commission_cents || 0));
      const originalAmount = Math.max(1, Number(charge.amount || charge.amount_refunded || 1));
      const refundRatio = Math.min(1, Number(charge.amount_refunded || originalAmount) / originalAmount);
      const reversal = -Math.round(refundable * refundRatio);
      await query(
        `INSERT INTO partner_ledger (user_id,kind,amount_cents,status,note,source_ref,metadata)
         SELECT $1,'refund_reversal',$2,'pending',$3,$4,$5
         WHERE NOT EXISTS (SELECT 1 FROM partner_ledger WHERE kind='refund_reversal' AND source_ref=$4)`,
        [row.partner_user_id, reversal, `Charge-specific commission reversal for ${charge.id}`, `refund:${charge.id}:${charge.amount_refunded}`, JSON.stringify({ chargeId: charge.id, originalLedgerId: row.partner_ledger_id, refundRatio })]
      );
      await query(`UPDATE billing_revenue_links SET status='refunded', metadata=metadata || $2::jsonb, updated_at=now() WHERE id=$1`, [row.id, JSON.stringify({ amountRefunded: charge.amount_refunded, refundEventId: event.id })]);
    } else {
      await query(`UPDATE billing_events SET processing_error=$2 WHERE stripe_event_id=$1`, [event.id, 'refund_reconciliation_required:no_charge_specific_revenue_link']);
    }
  }

  await query('UPDATE billing_events SET processed_at=now() WHERE stripe_event_id=$1', [event.id]);
  res.json({ received: true });
}

module.exports = { router, stripeWebhook, PLANS, PLAN_PRICE_ENV, billingReadiness, creditReferral };
