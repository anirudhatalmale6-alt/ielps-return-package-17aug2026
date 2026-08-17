'use strict';
// Isolated harness stub. The production database is never opened by this test.
// It simulates only what the webhook path needs: an idempotent insert into
// billing_events (ON CONFLICT DO NOTHING) and no-op updates.
const seenEvents = new Set();
async function query(sql, params = []) {
  if (/INSERT INTO billing_events/i.test(sql)) {
    const id = params[0];
    if (seenEvents.has(id)) return { rowCount: 0, rows: [] };
    seenEvents.add(id);
    return { rowCount: 1, rows: [{ stripe_event_id: id }] };
  }
  return { rowCount: 0, rows: [] };
}
async function tx(fn) { return fn({ query }); }
module.exports = { query, tx };
