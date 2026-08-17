# 5 — Isolated Stripe test-mode QA/staging: administrator requirements

Return package item 5. Required because item 4 returned
`SUPPORTED_QA_ENTITLEMENT = NOT FOUND` for the Trial Lesson entitlement.

This is a request for administrator action. **I hold no root and no sudo on this
server, and I am not asking for any.** Everything below is either something only
an administrator can do, or something I can do once the administrator pieces are
in place — the split is marked on every line.

Two rules govern the whole design:

- **Stripe test and live credentials are never mixed inside the production
  runtime.** The QA service is a separate systemd unit with its own environment
  file. The running `eilps-api` service is not touched, restarted or
  reconfigured.
- **Production data is never written by QA.** The QA service points at its own
  database.

---

## 1. Stripe test-mode credentials

| Item | Value | Who |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | the account's **test** secret key (`sk_test_…`) | administrator |
| `STRIPE_WEBHOOK_SECRET` | signing secret of a **new test-mode** webhook endpoint (`whsec_…`) | administrator |
| `STRIPE_CURRENCY` | `usd` — same as production | — |

Publishable key: **not required.** Nothing in this backend uses one; checkout is
server-created and the learner is redirected to Stripe's hosted page.

### On the "test $3 Price ID"

Your instruction lists one, so this needs stating plainly rather than quietly
skipped: **the code does not use a Price ID for the trial.**
`POST /api/billing/trial-checkout` builds the $3 line item inline with
`price_data` (`unit_amount: 300`, `product_data.name: 'EILPS Trial Lesson'`).
There is no `STRIPE_PRICE_TRIAL` environment variable, and its absence is not a
misconfiguration.

So there are two ways forward and it is your call:

- **(a) No Price ID.** QA exercises the same inline path production uses. This
  is the truer test — it tests what actually runs — and needs nothing further.
  **Recommended.**
- **(b) Introduce a Price ID.** A real backend change to `trial-checkout`, with
  a live Price ID needed for production too. Not authorised, not built, and it
  would mean QA and production no longer take the same code path unless both
  change together.

The three subscription plans *do* use Price IDs
(`STRIPE_PRICE_PREMIUM_MONTHLY`, `STRIPE_PRICE_PREMIUM_ANNUAL`,
`STRIPE_PRICE_LIVE_MONTHLY`). If subscription checkout is also to be QA'd, three
**test-mode** Price IDs are needed. For the trial-lesson chain in your item 5,
they are not.

---

## 2. QA/staging service

| Item | Proposal | Who |
| --- | --- | --- |
| Unit | `eilps-api-qa.service`, modelled on `eilps-api.service` | administrator |
| User | `anirudhat`, as production | — |
| Port | **4310** (production uses 4300 API, 4301 web, 4302 Access Panel — 4310 is clear) | — |
| `NODE_ENV` | `production` — **deliberately.** The development fallbacks must stay closed, or QA proves nothing. | — |
| Environment file | a new root-owned `0600` file, e.g. `/home/anirudhat/eilps/.env.qa`, holding **only test-mode** Stripe values | administrator |
| Source | the same `~/eilps/backend` tree, or a copy — either is fine, the environment is what differs | either |

The production `eilps-api` unit, its environment file and its restart policy are
not to be edited. QA is additive.

---

## 3. Database / data boundary

| Item | Proposal | Who |
| --- | --- | --- |
| Cluster | the existing isolated Postgres 16 on **port 55432** | — |
| Database | a **new** database, e.g. `eilps_qa`, created by the cluster owner | administrator |
| Schema | the same migrations the production database has | I can run these against `eilps_qa` once it exists |
| `DATABASE_URL` | points at `eilps_qa` in `.env.qa`, never at the production database | administrator |

A separate database rather than a separate cluster: it is a genuine data
boundary, it costs no extra memory on a box that is already tight, and no QA
statement can reach a production table.

**Do not** point the QA service at the production database. A test-mode webhook
writing `trial_purchases` rows into production would be exactly the manufactured
entitlement your instruction forbids.

---

## 4. Callback URLs

`validateReturnUrl()` rejects, in production mode, any URL that is not HTTPS and
whose origin is not listed in `FRONTEND_URL`. So QA needs its own:

| Variable | Value | Who |
| --- | --- | --- |
| `FRONTEND_URL` | the QA origin, e.g. `https://qa.<host>` — comma-separated list accepted | administrator |
| `CORS_ORIGIN` | same origin (required in production mode, the service refuses to start without it) | administrator |
| Stripe success URL | `<QA origin>/learn?trial=unlocked` | — |
| Stripe cancel URL | `<QA origin>/learn` | — |
| Stripe test webhook endpoint | `<QA origin>/api/billing/webhooks/stripe` | administrator, in the Stripe dashboard |

If exposing a QA hostname publicly is unwanted, the alternative is the Stripe
CLI (`stripe listen --forward-to http://127.0.0.1:4310/…`), which needs no
public DNS and no TLS. That requires the CLI to be installed and authenticated
against the **test** account — administrator action, and my preference, because
nothing new is exposed to the internet.

---

## 5. Verification procedure

Once the above exists, this is what I run. Every assertion is a server response;
nothing is self-reported.

1. **Register a QA learner** on the QA service. Confirm `GET /api/billing/subscription` returns tier `free`.
2. **Confirm the gate is closed.** `GET /api/lesson-support/lessons/a1d01l1/engine-15` → expect **402**, `feature: trial_lesson`, `gate: trial`. Record the response.
3. **Create the checkout.** `POST /api/billing/trial-checkout` → expect a Stripe **test-mode** Checkout URL.
4. **Pay with a test card** (`4242 4242 4242 4242`). No real money moves.
5. **Webhook.** Confirm `checkout.session.completed` arrives with a valid signature and a `2xx` is returned, and that a `trial_purchases` row now exists in `eilps_qa` **written by the webhook, not by hand**.
6. **Confirm the gate is now open.** Repeat step 2 → expect **200** with the lesson engine.
7. **Engine-15 → evidence → submission.** `POST /api/activities/a1d01l1/submissions` with real learner evidence. Record the **server** `submissionId`, score, stars and results. No frontend-computed score.
8. **Smart Review.** Confirm the review evidence is the server's, not self-reported.
9. **Progress.** `POST /api/progress/lesson` → confirm persisted completion by re-reading it.
10. **Next.** `GET /api/engine/next` → confirm it advances.
11. **Idempotency.** Replay the same webhook event → expect `duplicate: true` and no second row.
12. **Malformed webhook.** Unsigned and invalid-signature requests → expect **400** (see item 6).

Every step's raw response goes into the evidence pack.

**Expected outcome to be honest about in advance:** step 6 will pass for
`a1d01l1` and **only** for `a1d01l1`. Any other lesson will still return 402
after payment, because of the hard-coded rule documented in item 3. The QA
environment does not fix that mismatch; it lets us demonstrate it without
spending real money.

---

## 6. Cleanup and rollback

| Action | Effect | Who |
| --- | --- | --- |
| `systemctl stop --now eilps-api-qa` and disable the unit | QA service gone | administrator |
| `DROP DATABASE eilps_qa` | every QA row gone; production untouched | administrator |
| Delete the test-mode webhook endpoint in the Stripe dashboard | no further test deliveries | administrator |
| Delete `/home/anirudhat/eilps/.env.qa` | test credentials gone from the box | administrator |
| Remove the QA origin from any DNS/proxy | nothing exposed | administrator |

Rollback is complete removal — nothing in production was altered to create QA,
so there is nothing in production to restore.

---

## 7. What I am not asking for

- No root or sudo for me, at any point.
- No live-key access, and no change to the live Stripe configuration.
- No production database write.
- No live $3 charge.

If a live payment smoke test is wanted later, your instruction already frames it
correctly: a separately authorised, one-off final production check — not part of
this matrix.
