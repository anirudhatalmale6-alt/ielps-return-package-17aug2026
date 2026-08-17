# 3 — Trial entitlement trace: placement result → authorised lessonId

Return package item 3. Investigation only. No billing or business logic has been
changed, and nothing in this document has been deployed.

Traced on the live platform on 17 August 2026, against the code the running
`eilps-api` service is executing.

---

## Verdict

**CANONICAL BUSINESS-RULE MISMATCH — confirmed.**

Every purchaser of the $3 Trial Lesson is authorised for exactly one lesson:

> **A1 → `a1d01` → `a1d01l1` — "Language Focus: First Words and Classroom English"**

regardless of placement, regardless of pathway, regardless of the recommended
CEFR level the learner was just shown. A C1 learner who places at C1 and pays $3
is authorised for the first A1 lesson.

It is not only a hard-coded lesson. **Three of the seven links in the chain do
not exist at all**, so this cannot be corrected by editing one condition.

---

## The chain, hop by hop

| # | Hop | Status | Where |
| --- | --- | --- | --- |
| 1 | placement result | EXISTS, **not persisted** | `assessment.js` |
| 2 | recommendation | EXISTS, **level only** | `assessment.js:67` |
| 3 | recommendedLessonId | **DOES NOT EXIST** | — |
| 4 | trial checkout | EXISTS, **carries no lesson** | `billing.js:131` |
| 5 | trial_purchases | EXISTS, **no lesson column** | `021_trial_lesson_entitlement.sql` |
| 6 | requireLessonAccess | EXISTS | `lesson_support.js:50` |
| 7 | authorised lessonId | **hard-coded** | `lesson_support.js:35` |

### 1. Placement result — exists, but nothing keeps it

`POST /api/assessment/level-check/score` scores the submitted responses and
returns `score`, `total`, `percent`, `level`, `recommendedLevel`,
`productiveSkillConfirmationRequired`, `confidence`, `perLevel`, `feedback[]`.

The handler performs **no database write**. There is no `placement_results`
table and no placement row on the user. Searching the whole backend for
`placement_results`, `placementResult` and `placement_attempts` returns nothing.

The result exists only in the HTTP response. The Access Panel renders it on
screen (`components/placement-test.tsx`), then offers "Open my course", which
navigates to the dashboard. The result is not stored on the client either.

**Consequence:** by the time a learner reaches checkout, the platform no longer
knows what they placed at.

### 2. Recommendation — a CEFR level, not a lesson

`placementEstimate()` returns `recommendedLevel` — one of A1…C2 — plus a
deliberate cap: a C1/C2 estimate is reported as `level: 'B2'` with
`productiveSkillConfirmationRequired: true` until speaking/writing evidence
confirms it. That cap is sound and I have not touched it.

But the recommendation is a **band**. It never resolves to a lesson.

### 3. recommendedLessonId — does not exist

Zero occurrences of `recommendedLessonId` or `recommendedLesson` anywhere in the
backend source.

The nearest field is `feedback[].lessonId`, which is the lesson each *placement
item* was drawn from — per-item provenance, so the learner can see where a
question came from. It is not a recommendation, and using it as one would be
inventing a business rule.

### 4. Trial checkout — carries no lesson and no level

`POST /api/billing/trial-checkout` creates a Stripe Checkout Session with:

```
mode: 'payment'
price_data: { currency: usd, unit_amount: 300,
              product_data: { name: 'EILPS Trial Lesson', … } }
metadata:   { kind: 'trial_lesson', userId, product: 'eilps_trial_lesson' }
```

There is no `lessonId`, no `level`, no placement reference in the metadata. The
$3 is charged with an inline price, not a Stripe Price ID — so there is no
`STRIPE_PRICE_TRIAL` in the environment, and its absence is not a
misconfiguration.

### 5. trial_purchases — one row per user, no lesson

```sql
CREATE TABLE trial_purchases (
  user_id           uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  stripe_session_id text,
  payment_intent_id text,
  amount_cents      integer NOT NULL DEFAULT 300,
  currency          text,
  status            text NOT NULL DEFAULT 'paid',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
```

`user_id` is the primary key — one trial per user, presence means unlocked.
**There is nowhere to record which lesson was bought.** Even if placement were
persisted and carried through checkout, the entitlement record could not hold
it.

### 6. requireLessonAccess — the gate

`lesson_support.js:50`

```js
async function requireLessonAccess(req, found) {
  const subscription = req.user ? await currentSubscription(req.user.id)
                                : { tier: 'free', status: 'active' };
  if (hasFeature(subscription, 'premium_curriculum')) return { locked: false, … };
  const trialLesson = isTrialLesson(found.level, found.unit, found.lessonIndex);
  if (trialLesson && await userTrialPurchased(req.user?.id)) return { locked: false, … };
  return { locked: true, gate: trialLesson ? 'trial' : 'premium', subscription };
}
```

Two ways through: an active premium-tier subscription, or the trial gate. The
trial gate is the second condition, and it depends entirely on `isTrialLesson`.

### 7. The authorised lesson — hard-coded

`lesson_support.js:35`

```js
function isTrialLesson(level, unit, lessonIndex) {
  const firstUnit = /(?:d|u)0?1$/i.test(String(unit.id || ''));
  return String(level).toUpperCase() === 'A1' && firstUnit && lessonIndex === 0;
}
```

Against the deployed curriculum (`content.deep-a1-c2.json`, 6 levels, 48 units,
240 lessons) this predicate is true for exactly one lesson: **`a1d01l1`**.

The user identity is never consulted. `isTrialLesson` takes no `userId`.

---

## Two further things worth knowing before this is corrected

**The rule is written twice.** The identical `isTrialLesson` and
`userTrialPurchased` pair also exists in `curriculum.js:80` and `:85`, gating
`/api/curriculum/deep-lessons/:id`. Any correction has to change both, or the
lesson player and the curriculum route will disagree about what a learner owns.
I have not merged them — that would be an unrelated backend change.

**The 402 is correct behaviour.** The `402` an unentitled QA account receives is
the entitlement gate working exactly as designed, as your instruction records.
It is not a defect and it is not evidence of a Stripe fault.

---

## What a corrected chain would need

Listed so the size of the decision is visible. **None of this has been built.**
It is business-rule work, and item 4 of your instruction says to flag rather
than change.

1. Persist the placement result (new table or a column on the user).
2. Resolve `recommendedLevel` → a specific first lesson — a business rule that
   does not exist yet, and needs your decision: the first lesson of the
   recommended level? the first lesson of the first unit of that level? the
   first lesson the learner has not completed?
3. Carry that `lessonId` through `trial-checkout` metadata.
4. Add a lesson (or level) column to `trial_purchases` — a schema change, which
   is not authorised under the 14 August remediation terms.
5. Read it in `requireLessonAccess`, in both files.
6. Decide the rule for a learner who places at C1 but is capped to B2 pending
   productive-skill confirmation: which lesson does the $3 buy then?

Point 6 in particular is a product decision, not a coding one.
