'use strict';
// Builds the A1-C2 vocabulary inventory required by the 17 Aug developer
// instruction, item 7.2. Every field is read from the platform itself:
// the curriculum file for level/unit/lesson/keyword, and lesson_engine_15's
// own CEFR_STYLE frames for the definition and example that a learner is
// actually shown today. Nothing here is authored by hand.
const fs = require('fs');
const path = require('path');

const DATA = '/home/anirudhat/eilps/backend/data/content.deep-a1-c2.json';
const ENGINE = '/home/anirudhat/eilps/backend/src/lesson_engine_15.js';
const ASSETS = '/home/anirudhat/eilps/content-assets';

// Pull CEFR_STYLE and the brief text out of the engine source without booting
// the whole backend: the module has no side effects but does require db-bound
// siblings, so evaluate it in isolation.
const src = fs.readFileSync(ENGINE, 'utf8');
const styleSrc = src.slice(src.indexOf('const CEFR_STYLE'), src.indexOf('const STEP_BLUEPRINTS'));
const CEFR_STYLE = eval(styleSrc + '; CEFR_STYLE');

const visualDefinition = (word, context) =>
  `Show ${word} clearly in a ${context} situation, with the object, action, or idea easy to identify without reading extra text.`;
const imageExample = (word, context) =>
  `Original IELPS image brief: ${word} in ${context}; clean educational composition; no brand marks; culturally neutral details; accessible contrast; no answer text in the image.`;

// Vocabulary pictures that genuinely exist today, keyed by the word they depict.
const panelIllustrations = new Set(['book', 'pen', 'listen', 'help', 'repeat']);
const wordImageDir = path.join(ASSETS, 'word-images');
const serverWordImages = new Map();
for (const f of fs.existsSync(wordImageDir) ? fs.readdirSync(wordImageDir) : []) {
  serverWordImages.set(path.parse(f).name.toLowerCase(), `content-assets/word-images/${f}`);
}

const doc = JSON.parse(fs.readFileSync(DATA, 'utf8'));
const rows = [];
for (const level of doc.levels || []) {
  const lv = String(level.level || '').toUpperCase();
  const style = CEFR_STYLE[lv] || CEFR_STYLE.B1;
  for (const unit of level.units || []) {
    for (const lesson of unit.lessons || []) {
      const context = String(unit.focus || lesson.title || 'this lesson').toLowerCase();
      const words = [...new Set((lesson.vocabularySet || [])
        .map((i) => (typeof i === 'string' ? i : i?.word || i?.term || ''))
        .map((w) => String(w).trim()).filter(Boolean))].slice(0, 12);
      for (const word of words) {
        const key = word.toLowerCase();
        const asset = serverWordImages.get(key) || (panelIllustrations.has(key) ? `panel:/keywords/${key}.jpg` : '');
        rows.push({
          cefrLevel: lv,
          unitId: unit.id || '',
          unitFocus: unit.focus || '',
          lessonId: lesson.id || '',
          lessonTitle: lesson.title || '',
          keyword: word,
          definition: style.definitionFrame(word, context),
          definitionSource: 'TEMPLATE_CEFR_STYLE',
          gradedExampleSentence: style.exampleFrame(word, context),
          exampleSource: 'TEMPLATE_CEFR_STYLE',
          imageBrief: visualDefinition(word, context),
          generationBrief: imageExample(word, context),
          generatedImage: asset,
          imageState: asset ? 'PRESENT' : 'MISSING',
          reviewStatus: asset ? 'TEMPORARY_UNREVIEWED' : 'REVIEW_REQUIRED',
          permanentAssetReference: '',
        });
      }
    }
  }
}

const uniqueWords = new Map();
for (const r of rows) {
  const k = r.keyword.toLowerCase();
  if (!uniqueWords.has(k)) uniqueWords.set(k, { keyword: r.keyword, levels: new Set(), lessons: [], image: r.generatedImage });
  const u = uniqueWords.get(k);
  u.levels.add(r.cefrLevel);
  u.lessons.push(r.lessonId);
}

const perLevel = {};
for (const r of rows) {
  perLevel[r.cefrLevel] = perLevel[r.cefrLevel] || { occurrences: 0, uniqueWords: new Set(), withImage: 0 };
  perLevel[r.cefrLevel].occurrences++;
  perLevel[r.cefrLevel].uniqueWords.add(r.keyword.toLowerCase());
  if (r.generatedImage) perLevel[r.cefrLevel].withImage++;
}

const summary = {
  generated: process.env.STAMP || '',
  source: { curriculum: DATA, engine: ENGINE, assets: ASSETS },
  totals: {
    levels: Object.keys(perLevel).length,
    lessons: new Set(rows.map((r) => r.lessonId)).size,
    keywordOccurrences: rows.length,
    uniqueKeywords: uniqueWords.size,
    uniqueKeywordsWithAnImage: [...uniqueWords.values()].filter((u) => u.image).length,
  },
  perLevel: Object.fromEntries(Object.entries(perLevel).map(([k, v]) => [k, {
    keywordOccurrences: v.occurrences, uniqueKeywords: v.uniqueWords.size, occurrencesWithAnImage: v.withImage,
  }])),
};

fs.writeFileSync('/tmp/vocab-inventory.json', JSON.stringify({ summary, items: rows }, null, 2));
const cols = Object.keys(rows[0]);
const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
fs.writeFileSync('/tmp/vocab-inventory.csv', [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n'));
console.log(JSON.stringify(summary, null, 2));
