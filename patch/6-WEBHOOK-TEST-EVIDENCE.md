# 6 — Stripe webhook malformed-request handling: patch and test evidence

Return package item 6. **Not deployed.** The patch is prepared, proven and
waiting for your word.

---

## The defect, confirmed on the live endpoint

`stripeWebhook` calls `stripe.webhooks.constructEvent(...)` without a guard. On
a missing or invalid signature that throws a `StripeSignatureVerificationError`,
which carries no HTTP status, so the global error handler defaults it to **500**.

Probed against the running production service. These requests are
side-effect-free by definition — an unverified event is never read or stored:

```
POST /api/billing/webhooks/stripe   (no stripe-signature header)
  → 500  {"error":"server_error","message":"Something went wrong."}

POST /api/billing/webhooks/stripe   (stripe-signature: t=1,v1=deadbeef)
  → 500  {"error":"server_error","message":"Something went wrong."}
```

Why it matters beyond the status code: a 500 tells Stripe the endpoint is
broken, so Stripe retries — repeatedly, for an event this endpoint will never
accept. A 400 tells Stripe the request was malformed and stops the retries.

---

## Required behaviour, and where each case is handled

| Case | Required | Handled by |
| --- | --- | --- |
| Missing Stripe signature | 400 | the patch |
| Invalid Stripe signature | 400 | the patch |
| Valid processed Stripe event | 2xx | existing code, unchanged |
| Genuine internal processing failure | 5xx | existing error handler, unchanged |

The fourth case is the reason the guard wraps only `constructEvent` and not the
whole handler. A database failure *after* verification is a real server fault
and must stay 5xx.

---

## The patch

One file, `backend/src/billing.js`, one site. Full diff in `webhook-400.patch`.

```diff
   const sig = req.headers['stripe-signature'];
-  const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
+  let event;
+  try {
+    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
+  } catch {
+    return res.status(400).json({
+      error: 'invalid_signature',
+      message: sig ? 'Stripe signature verification failed.' : 'Missing Stripe-Signature header.',
+    });
+  }
```

(The deployed version also carries a comment explaining why; omitted here for
readability.)

### Preserved, deliberately and verifiably

- **Raw request-body signature verification** — `express.raw` mounting and the
  `req.body` Buffer are untouched.
- **Signing-secret validation** — the same `STRIPE_WEBHOOK_SECRET`, the same
  call, the same library.
- **Webhook idempotency** — the `INSERT … ON CONFLICT DO NOTHING` into
  `billing_events` and the `duplicate: true` short-circuit are untouched, and
  proven still working below.
- **Existing checkout logic, entitlement semantics and prices** — no branch
  below the guard is modified. `trial_lesson`, `live_booking`, subscription,
  `invoice.paid`, `checkout.session.expired`, `invoice.payment_failed` and
  `charge.refunded` are byte-for-byte as they were.
- **Production secrets** — none read, printed, moved or changed.

### Not combined with anything else

No billing change, no entitlement change, no schema change, no route added or
renamed. One `try`/`catch` around one call.

---

## Test evidence

Run with an isolated harness (`run-webhook-tests.js`) that mounts the **real**
handler exactly as `index.js` mounts it — `express.raw`, the same
promise-catch bridge, the same error handler — with the data layer stubbed.

It never opens the production database and never touches the production Stripe
credentials: a throwaway signing secret local to the test process is used, so a
genuinely valid signature can be produced and the 2xx and idempotency cases are
real rather than asserted.

```
=== BEFORE (as deployed) ===
1. unsigned request            expected 400  got 500  FAIL   {"error":"server_error","message":"Something went wrong."}
2. invalid signature           expected 400  got 500  FAIL   {"error":"server_error","message":"Something went wrong."}
3. valid signed event          expected 200  got 200  PASS   {"received":true}
4. same valid event repeated   expected 200  got 200  PASS   {"received":true,"duplicate":true}
2/4 pass

=== AFTER  (patched) ===
1. unsigned request            expected 400  got 400  PASS   {"error":"invalid_signature","message":"Missing Stripe-Signature header."}
2. invalid signature           expected 400  got 400  PASS   {"error":"invalid_signature","message":"Stripe signature verification failed."}
3. valid signed event          expected 200  got 200  PASS   {"received":true}
4. same valid event repeated   expected 200  got 200  PASS   {"received":true,"duplicate":true}
4/4 pass
```

The BEFORE column reproduces the live 500s exactly, which is the cross-check
that the harness is testing the same code the server runs.

Case 4 returning `duplicate: true` is the idempotency proof: the second
delivery of the same event id is recognised and not processed twice.

---

## Files

| File | What it is |
| --- | --- |
| `webhook-400.patch` | unified diff against the deployed `billing.js` |
| `billing.original.js` | the deployed file, fetched 17 Aug 2026 |
| `billing.patched.js` | the same file with the patch applied |
| `run-webhook-tests.js` | the harness |
| `db.js`, `middleware.js`, `entitlements.js` | harness stubs — **test only, never deployed** |

---

## To deploy, when you approve

Applying it is a file edit and a service restart of `eilps-api`. I will not do
either without your explicit word, and I would rather do it at a quiet hour: a
restart is a brief interruption to the live platform, and after the last two
days I am not restarting anything on my own initiative.
