'use strict';
/**
 * Webhook malformed-request test harness.
 *
 * Runs the real stripeWebhook handler, mounted exactly as index.js mounts it
 * (express.raw + the same promise-catch bridge + the same error handler), with
 * the data layer stubbed. It never opens the production database and never
 * touches the production Stripe keys: a throwaway signing secret local to this
 * process is used so that a genuinely valid signature can be produced.
 *
 *   node run-webhook-tests.js before|after
 */
const which = process.argv[2] === 'after' ? './billing.patched.js' : './billing.original.js';

process.env.NODE_ENV = 'production';
process.env.STRIPE_SECRET_KEY = 'sk_test_harness_not_a_real_key';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_harness_local_only';

const express = require('express');
const Stripe = require('stripe');
const billing = require(which);

const app = express();
app.post('/api/billing/webhooks/stripe', express.raw({ type: 'application/json' }),
  (req, res, next) => Promise.resolve(billing.stripeWebhook(req, res)).catch(next));
app.use(require('./middleware').errorHandler);

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const payload = JSON.stringify({
  id: 'evt_harness_0001', type: 'ping', data: { object: {} },
});

function post(port, headers, body) {
  return new Promise((resolve) => {
    const req = require('http').request(
      { host: '127.0.0.1', port, path: '/api/billing/webhooks/stripe', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers } },
      (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve({ status: res.statusCode, body: d.trim() })); });
    req.end(body);
  });
}

const server = app.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  const signed = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });

  const cases = [
    ['1. unsigned request                 ', {}, payload, 400],
    ['2. invalid signature                ', { 'stripe-signature': 't=1,v1=deadbeef' }, payload, 400],
    ['3. valid signed event               ', { 'stripe-signature': signed }, payload, 200],
    ['4. same valid event repeated        ', { 'stripe-signature': signed }, payload, 200],
  ];

  console.log(`\n=== ${process.argv[2] === 'after' ? 'AFTER  (patched)' : 'BEFORE (as deployed)'} ===`);
  let pass = 0;
  for (const [label, headers, body, expected] of cases) {
    const r = await post(port, headers, body);
    const ok = r.status === expected;
    if (ok) pass++;
    console.log(`${label} expected ${expected}  got ${r.status}  ${ok ? 'PASS' : 'FAIL'}   ${r.body.slice(0, 90)}`);
  }
  console.log(`${pass}/${cases.length} pass`);
  server.close();
});
