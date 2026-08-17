# 7 — Correction: Stripe is CONFIGURED and LIVE

Return package item 7. This corrects a finding of mine that was wrong.

---

## Corrected status

| | |
| --- | --- |
| Stripe provider | **CONFIGURED** |
| Stripe operating mode | **LIVE** |
| Currency | **USD** |
| Trial checkout | **PRESENT** |
| Stripe webhook | **PRESENT** |
| 402 from an unentitled QA account | **EXPECTED ENTITLEMENT GATE** — not a defect |

Verified on the running `eilps-api` service on 17 August 2026:

- `STRIPE_SECRET_KEY` present, prefix `sk_live_` — **live mode, not test**
- `STRIPE_WEBHOOK_SECRET` present, prefix `whsec_`
- `STRIPE_CURRENCY=usd`
- `STRIPE_PRICE_PREMIUM_MONTHLY`, `STRIPE_PRICE_PREMIUM_ANNUAL`,
  `STRIPE_PRICE_LIVE_MONTHLY` all present
- `NODE_ENV=production`, API on port 4300

No secret value is recorded here or anywhere in this package — only whether a
variable is set and which mode its prefix indicates.

---

## Why my earlier finding was wrong

I want this on the record properly, because a correction is only useful if the
method that produced the error is fixed too.

The Stripe values are **not** in `backend/.env`. They come from
`/home/anirudhat/eilps/.env.production`, loaded by the systemd unit:

```
EnvironmentFile=/home/anirudhat/eilps/backend/.env
EnvironmentFile=/home/anirudhat/eilps/.env.production
```

That second file is `root:root 0600`. I cannot read it — I have no root and no
sudo, and I am not asking for any. When I audited billing configuration I read
the environment files I *could* read, found no Stripe keys, and concluded the
provider was not configured. The file that mattered was invisible to me and I
reported an absence I had not actually established.

The reliable method, which I have now used, is to read the **running process's**
environment (`/proc/<pid>/environ` for a process I own) and check which variable
names are set. That reflects what the service actually received, regardless of
which file supplied it or who owns that file.

I have not touched either environment file.

---

## Documents to correct

### `IELPS-CANONICAL-MANIFEST.pdf`

**Row 6 — "$3 first-lesson learning plan"**

- Was: `⚠️ PROVIDER NOT CONFIGURED — no Stripe keys or price IDs in the backend
  environment; checkout fails closed by design`
- Now: `✅ PROVIDER CONFIGURED — Stripe LIVE, USD. Trial checkout present
  (POST /api/billing/trial-checkout, $3 inline price_data, TRIAL_PRICE_CENTS =
  300). Webhook present. ⚠️ Entitlement mapping is a canonical business-rule
  mismatch — see item 3: every trial purchase authorises A1 → a1d01 → a1d01l1
  regardless of placement.`

**Row 27 — "Payments / entitlements"**

- Was: `⚠️ PROVIDER NOT CONFIGURED — plans and subscription read fine; no
  checkout possible`
- Now: `✅ PROVIDER CONFIGURED — Stripe LIVE, USD; secret key, webhook secret
  and all three subscription price IDs present. Checkout is possible. Not yet
  exercised end to end: no supported QA entitlement mechanism exists, and a
  live $3 charge is deliberately not being created — see items 4 and 5.`

### `IELPS-Consolidated-Integration-Matrix-15-Aug-2026.pdf` and `INTEGRATION-MATRIX-panel-r5.md`

Neither carries a "Stripe not configured" verdict — their billing rows record
per-route status (`GET /api/billing/plans` → 200, `GET /api/billing/subscription`
→ 401 signed out), and those are all still correct. Two additions rather than
corrections:

- A trial-lesson row: `POST /api/billing/trial-checkout` — provider CONFIGURED,
  mode LIVE, **not exercised end to end**, reason: no supported QA entitlement
  mechanism (item 4).
- A webhook row: `POST /api/billing/webhooks/stripe` — present; malformed and
  unsigned requests currently return 500 and should return 400; patch prepared
  and proven, not deployed (item 6).

### `IELPS-Root-Implementation-Pack-AccessPanel-r7.pdf`

Any statement that Stripe configuration is a prerequisite still to be supplied
should be struck. It is supplied. What r7 should say instead is that the
outstanding billing prerequisite is an **isolated test-mode QA environment**,
specified in item 5.

---

## Three things the corrected status should not be read as saying

1. **Configured is not verified.** Stripe is correctly configured and a
   checkout session can be created. No payment has been completed end to end,
   because doing so on the live account means a real charge. That is item 5.
2. **The $3 product is configured, but its entitlement mapping is wrong.**
   Item 3 documents it. Recording Stripe as green must not carry the trial
   entitlement to green with it.
3. **The webhook is present but not fully correct.** It verifies signatures and
   is idempotent; it answers 500 where it should answer 400. Item 6.

---

I have not edited the manifest or the matrix PDFs — they are your documents. The
replacement text above is written so it can be pasted straight in. If you would
rather I produce corrected versions, say so and I will.
