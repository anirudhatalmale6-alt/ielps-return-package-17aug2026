# IELPS — return package, 17 August 2026

Answering the developer instruction *Vocabulary Images, CEFR-Graded Examples,
Stripe QA and Webhook Handling*.

**Nothing in this package has been deployed.** No production change was made, no
charge was created, no entitlement was manufactured, no database row was
written, no image was generated, and no learner-facing copy was authored or
altered.

---

## The seven items

| # | Deliverable | Where | Status |
| --- | --- | --- | --- |
| 1 | A1–C2 vocabulary image pipeline | `docs/1-VOCABULARY-IMAGE-PIPELINE.md` | Specified |
| 2 | Inventory of server-generated vocabulary images, grouped A1–C2 | `inventory/` | Done — see finding below |
| 3 | Trial entitlement trace | `docs/3-TRIAL-ENTITLEMENT-TRACE.md` | Done |
| 4 | `SUPPORTED_QA_ENTITLEMENT` search result | `docs/4-QA-ENTITLEMENT-SEARCH.md` | **NOT FOUND** |
| 5 | Isolated Stripe test-mode QA requirements | `docs/5-STRIPE-TEST-MODE-QA-REQUIREMENTS.md` | Specified |
| 6 | Webhook 400 patch and test evidence | `patch/` | Patched, proven, **not deployed** |
| 7 | Manifest and matrix correction | `docs/7-MANIFEST-AND-MATRIX-CORRECTION.md` | Replacement text supplied |

---

## Four findings you will want first

**The server does not generate vocabulary images.** `visualDefinition` and
`imageExample` are *briefs* — sentences describing a picture — not image
locations. There is no image-generation call anywhere in the backend. Your
temporary display approval is recorded and will be honoured, but today it
applies to an empty set. **6 of 648 unique A1–C2 keywords have a picture; 642
have none.** B1 to C2 have none at all. (Lesson-opening illustrations are a
separate thing and are complete: 240 of 240.)

**The CEFR-graded example sentence does not exist as authored content.** All
2,976 vocabulary entries in the curriculum are plain strings — the word alone.
Every definition and example is generated at request time from one template per
level, and the template *quotes* the keyword rather than *using* it:
`I use "please" when I talk about greetings, names, classroom instructions.`
Your rule requires a sentence using the keyword in context. Roughly 720 example
sentences need authoring — that is content work, and it should happen before
image generation, because a picture generated from a brief built on a template
illustrates the template.

**The $3 trial entitlement is a canonical business-rule mismatch — confirmed,
and larger than a hard-code.** Every purchaser is authorised for exactly
`a1d01l1`, regardless of placement. Three of the seven links in your chain do
not exist at all: the placement result is never persisted, there is no
`recommendedLessonId` anywhere in the backend, and `trial_purchases` has no
lesson column. Flagged, not changed, as your item 4 instructs.

**Stripe is CONFIGURED and LIVE — my earlier "not configured" finding was
wrong.** The keys are in a root-owned `0600` environment file loaded by systemd,
which I cannot read; I reported an absence I had not established. Reading the
running process's environment shows `sk_live_`, `whsec_`, USD and all three
subscription price IDs present. Item 7 corrects the manifest and explains the
method change so the error is not repeated.

---

## What I deliberately did not do

- No live $3 charge on any account.
- No hand-inserted `trial_purchases` row.
- No use of the admin premium grant to green the matrix — it would satisfy the
  *premium* branch of `requireLessonAccess` and never exercise the trial gate at
  all. A green matrix that never tested the thing under test is a false pass.
- No authored, rewritten or "improved" definitions or example sentences.
- No stock or decorative image used to fill an empty slot.
- No backend change beyond the single webhook guard in item 6, and that is not
  deployed.
- No production restart, no SSH or service reconfiguration.

---

## Waiting on you

1. **Deploy the webhook patch?** One file, one guard, proven 4/4. Needs an
   `eilps-api` restart, which I will not do unprompted.
2. **Authorise the isolated test-mode QA environment?** Item 5 lists exactly
   what an administrator needs to create. Until it exists there is no honest way
   to complete the end-to-end payment chain.
3. **The example-sentence authoring decision.** ~720 sentences. Scope and
   priced, or a narrower first pass — for example A1 only, to prove the pipeline
   end to end before committing to all six levels.
4. **The trial entitlement business rule.** Which lesson should $3 actually buy
   after placement — and what happens to a learner who places at C1 but is
   capped to B2 pending speaking/writing evidence?

Items 3 and 4 are product decisions rather than engineering ones, which is why
they are flagged rather than answered.
