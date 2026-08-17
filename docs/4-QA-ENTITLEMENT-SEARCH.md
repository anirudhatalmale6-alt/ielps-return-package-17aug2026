# 4 — SUPPORTED_QA_ENTITLEMENT search result

Return package item 4. Search and report only. Nothing was granted, inserted,
charged or changed.

---

## Result

```
SUPPORTED_QA_ENTITLEMENT = NOT FOUND   (for the $3 Trial Lesson entitlement)
```

with one important qualification, below.

There is **no supported QA, admin, test or complimentary mechanism that can
produce a Trial Lesson entitlement.** The only two code paths that ever write a
`trial_purchases` row are:

1. the Stripe webhook, on a real `checkout.session.completed` event with
   `metadata.kind === 'trial_lesson'` — i.e. a real payment; and
2. a development fallback inside `POST /api/billing/trial-checkout`, which is
   explicitly disabled when `NODE_ENV=production`. Production is
   `NODE_ENV=production`, so this path throws `503 billing_not_configured`
   rather than granting anything.

There is no third way, and no administrator route writes that table.

## The qualification — there *is* a supported admin grant, but it proves the wrong thing

`PATCH /api/admin/users/:id` (admin role required, enforced against
`users.role` in the database) accepts `plan` and `subscription_status` and
writes a subscription row marked `stripe_subscription_id = manual-<userId>`.
That is a genuine, first-class, non-Stripe entitlement grant, and it is clearly
marked as manual.

**It must not be used to green the trial acceptance matrix.** Granting `premium`
satisfies the *first* condition in `requireLessonAccess`:

```js
if (hasFeature(subscription, 'premium_curriculum')) return { locked: false, … };
```

The request then returns 200 **without the trial gate ever being evaluated**.
The matrix would go green while the thing under test — the $3 Trial Lesson
entitlement — was never exercised at all. That is a false pass, and reporting it
as a pass would breach the integrity rules this project runs on.

So the honest split is:

| Entitlement under test | Supported QA mechanism |
| --- | --- |
| Premium subscription features | **FOUND** — `PATCH /api/admin/users/:id` |
| **$3 Trial Lesson entitlement** | **NOT FOUND** |

The trial gate is the one your acceptance matrix needs, and it is the one with
no supported test path.

## What was searched

The whole backend source tree (`~/eilps/backend/src`, editor backups excluded),
for:

- `qa_`, `_qa`, `IELPS_QA`, `QA_ENTITLEMENT`
- `testMode`, `test_mode`
- `comp_entitlement`, `complimentary`
- `grantEntitlement`, `grant_access`, `override_entitlement`, `bypassBilling`
- `SEED_`
- every caller of `upsertSubscription`
- every statement touching `trial_purchases`
- every route in `admin.js` and `operations.js`

No result other than the two paths above.

## Consequence

Because no supported mechanism exists, item 5 of your instruction applies: an
isolated Stripe **test-mode** QA/staging environment is required. Those
requirements are set out in `5-STRIPE-TEST-MODE-QA-REQUIREMENTS.md`.

I have not created a live $3 charge and I have not inserted a
`trial_purchases` row by hand. Both remain off the table unless you authorise
them explicitly and in writing.
