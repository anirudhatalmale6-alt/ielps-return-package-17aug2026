# 2 — Inventory of A1–C2 vocabulary, grouped by CEFR library

Return package item 2. This is a report on what exists. Nothing was generated,
authored, edited or invented to fill it.

Files:

- `vocab-inventory.csv` — 2,880 rows, one per keyword occurrence, all
  traceability columns
- `vocab-inventory.json` — the same data plus a summary block

Both were produced by reading the platform itself: `content.deep-a1-c2.json`
for level/unit/lesson/keyword, and `lesson_engine_15.js`'s own `CEFR_STYLE`
frames for the definition and example a learner is actually shown today. The
generator script is included so the numbers can be re-derived rather than
trusted.

---

## Totals

| | |
| --- | --- |
| CEFR levels | 6 |
| Units | 48 |
| Lessons | 240 |
| Keyword occurrences | 2,880 |
| **Unique keywords** | **648** |
| **Unique keywords with a picture** | **6** |
| Keywords appearing at more than one level | 72 |

| Level | Occurrences | Unique keywords | Occurrences with a picture |
| --- | --- | --- | --- |
| A1 | 480 | 126 | 19 |
| A2 | 480 | 123 | 7 |
| B1 | 480 | 121 | 0 |
| B2 | 480 | 112 | 0 |
| C1 | 480 | 119 | 0 |
| C2 | 480 | 125 | 0 |

The six illustrated words are **book, check, help, listen, page, repeat**.
Four of them (`book`, `check`, `page`, `repeat`) are genuine curriculum
vocabulary; the other two ship in `content-assets/word-images/` but do not
appear in any lesson's vocabulary set.

**Coverage: 6 of 648 = 0.9%.** B1 through C2 have no vocabulary pictures at all.

---

## Finding 1 — there are no server-generated vocabulary images

The server has never generated a vocabulary image. `visualDefinition` and
`imageExample` are sentences describing a picture, not locations of one:

> `imageExample`: "Original IELPS image brief: book in greetings, names,
> classroom instructions; clean educational composition; no brand marks;
> culturally neutral details; accessible contrast; no answer text in the image."

There is no image-generation call, queue or stored output anywhere in the
backend. Every row in the inventory is therefore `imageState: MISSING` except
the six above, and those six are hand-supplied illustrations, not generated.

Your temporary display approval is recorded and will be honoured the moment
generation exists. Today it applies to an empty set.

Separately, and not to be confused with vocabulary images: **lesson**
illustrations *are* complete — 240 of 240 lessons have one, in
`content-assets/images/lesson-illustrations/<level>/<unit>/`, in png, webp and
svg, already partitioned by CEFR level. Those are lesson-opening scenes. They
are not vocabulary cards and cannot stand in for them.

---

## Finding 2 — the graded example sentence is a template, and it mentions the keyword rather than using it

This is the more significant of the two findings.

All 2,976 vocabulary entries in the curriculum are **plain strings** — the word
and nothing else. No definition, no example sentence, no image reference is
authored anywhere in the curriculum file. So every definition and every example
on a vocabulary card is produced at request time by a per-level template in
`CEFR_STYLE`:

```js
A1: exampleFrame: (word, context) => `I use "${word}" when I talk about ${context}.`
A2: exampleFrame: (word, context) => `I can use "${word}" to give simple information about ${context}.`
B1: exampleFrame: (word, context) => `I used "${word}" to explain what happened and what I need to do next in ${context}.`
…
```

What a learner sees today:

| Word | Level | Example sentence shown |
| --- | --- | --- |
| please | A1 | `I use "please" when I talk about greetings, names, classroom instructions.` |
| repeat | A1 | `I use "repeat" when I talk about greetings, names, classroom instructions.` |
| book | A1 | `I use "book" when I talk about greetings, names, classroom instructions.` |
| book | A2 | `I can use "book" to give simple information about past simple stories and travel memories.` |

Three problems, in order of seriousness:

1. **The keyword is quoted, not used.** Your rule requires "a clear graded
   example sentence **using that keyword in context**". `I use "please" when I
   talk about greetings` mentions the word; it never demonstrates it. A learner
   sees no model of the word in use — which is the one thing the example is for.
2. **It is generic by construction.** One carrier sentence per level, identical
   for every word at that level. Your rule explicitly says a generic sentence
   must not stand in for a lesson-specific example.
3. **The context is a comma list.** `unit.focus` is interpolated verbatim, so
   the sentence often reads as a list rather than a situation.

Your CEFR grading rule says: *use the actual lesson/curriculum example where an
approved example already exists.* **No such examples exist.** There is nothing
approved to preserve, and nothing to fall back to. Authoring is required, not
selection.

### Scale of the authoring, so the decision is informed

Sentences are needed per **keyword per level**, not per occurrence — a word
taught in four B1 lessons needs one B1 sentence. 648 unique keywords, of which
72 appear at more than one level. **Roughly 720 authored example sentences**,
plus the same number of definitions if those are to be authored too.

That is content work, at a scale that should be scoped and priced deliberately
rather than absorbed. It is also the work that has to happen **before** image
generation is worth starting: an image generated from a brief built on an
unauthored example will illustrate the template, not the word.

---

## Review states as recorded

Per your instruction, every row starts unapproved:

| State | Rows |
| --- | --- |
| `REVIEW_REQUIRED` (no image exists) | 2,854 |
| `TEMPORARY_UNREVIEWED` (an image exists, not editorially approved) | 26 |
| `APPROVED` / `PUBLISHED` | 0 |

`permanentAssetReference` is empty throughout — nothing has been promoted to a
permanent IELPS content asset, and nothing should be until it has been
reviewed.

---

## What I did not do

- I did not generate any images.
- I did not author, rewrite or "improve" any definition or example sentence.
- I did not mark anything `APPROVED`.
- I did not fill an empty image slot with stock or decorative art.
- I did not change `CEFR_STYLE`, `lesson_engine_15.js` or the curriculum file.

The templated sentences are reported exactly as the platform emits them, so the
inventory is a true picture of what a learner sees today rather than a
flattering one.
