import test from 'node:test';
import assert from 'node:assert/strict';
import { connect, errorCode, makePlayer, COACH_A, COACH_B } from './helpers';

/**
 * Regression (KNOWN_ISSUES 079): in a policy's subquery an unqualified column resolves to the
 * subquery's table first, so `t.player_id = player_id` compared the tracker with itself and an entry
 * could be filed under any player while pointing at one of the coach's trackers.
 */
test('tracker entries must belong to the same player as their tracker, and to the coach', async () => {
  const c = await connect();
  const pa = await makePlayer(c, COACH_A, 'Scoping A1');
  const pa2 = await makePlayer(c, COACH_A, 'Scoping A2');
  const pb = await makePlayer(c, COACH_B, 'Scoping B');
  const ta = (await c.query("insert into public.player_trackers (coach_id, player_id, name) values ($1, $2, 'A1 tracker') returning id", [COACH_A, pa])).rows[0].id;
  const entry = (await c.query("insert into public.player_tracker_entries (coach_id, player_id, tracker_id, entry_date) values ($1, $2, $3, '2026-01-01') returning id", [COACH_A, pa, ta])).rows[0].id;
  try {
    const insert = "insert into public.player_tracker_entries (coach_id, player_id, tracker_id, entry_date) values ($1, $2, $3, '2026-01-02')";
    assert.equal(await errorCode(c, 'authenticated', COACH_A, insert, [COACH_A, pa, ta]), null, 'the right player is accepted');
    assert.equal(await errorCode(c, 'authenticated', COACH_A, insert, [COACH_A, pa2, ta]), '42501', 'another player of the same coach is refused');
    assert.equal(await errorCode(c, 'authenticated', COACH_A, insert, [COACH_A, pb, ta]), '42501', 'another coach’s player is refused');
    assert.equal(await errorCode(c, 'authenticated', COACH_A, 'update public.player_tracker_entries set player_id = $1 where id = $2', [pa2, entry]), '42501', 'moving an entry to another player is refused');
    assert.equal(await errorCode(c, 'authenticated', COACH_A, 'update public.player_tracker_entries set player_id = $1 where id = $2', [pb, entry]), '42501', 'moving an entry to another coach’s player is refused');
  } finally {
    await c.query('delete from public.players where id = any($1)', [[pa, pa2, pb]]);
    await c.end();
  }
});
