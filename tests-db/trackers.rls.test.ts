import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { connect, as, errorCode, makePlayer, COACH_A, COACH_B } from './helpers';

const MIGRATION = path.join(process.cwd(), 'supabase/migrations/20261114090000_player_trackers.sql');

test('player trackers: RLS and the legacy-metric copy', async (t) => {
  const c = await connect();
  const pa = await makePlayer(c, COACH_A, 'RLS A');
  const pb = await makePlayer(c, COACH_B, 'RLS B');
  const fields = JSON.stringify([{ id: 'value', label: 'Value', kind: 'number', unit: '' }]);
  const ta = (await c.query("insert into public.player_trackers (coach_id, player_id, name, fields) values ($1, $2, 'A tracker', $3) returning id", [COACH_A, pa, fields])).rows[0].id;
  const tb = (await c.query("insert into public.player_trackers (coach_id, player_id, name, fields) values ($1, $2, 'B tracker', $3) returning id", [COACH_B, pb, fields])).rows[0].id;
  await c.query("insert into public.player_tracker_entries (coach_id, player_id, tracker_id, entry_date, measurements) values ($1, $2, $3, '2026-01-01', '{\"value\": 1}')", [COACH_A, pa, ta]);

  try {
    await t.test('the owning coach reads, writes and deletes their own trackers', async () => {
      await as(c, 'authenticated', COACH_A, async (q) => {
        assert.equal((await q('select id from public.player_trackers where player_id = $1', [pa])).rowCount, 1);
        assert.equal((await q('select id from public.player_tracker_entries where tracker_id = $1', [ta])).rowCount, 1);
        await q("insert into public.player_trackers (coach_id, player_id, name, fields) values ($1, $2, 'New', $3)", [COACH_A, pa, fields]);
        await q("insert into public.player_tracker_entries (coach_id, player_id, tracker_id, entry_date, measurements) values ($1, $2, $3, '2026-01-02', '{}')", [COACH_A, pa, ta]);
        assert.equal((await q("update public.player_trackers set name = 'Renamed' where id = $1", [ta])).rowCount, 1);
        assert.equal((await q('delete from public.player_tracker_entries where tracker_id = $1', [ta])).rowCount, 2);
      });
    });

    await t.test('another coach sees nothing and changes nothing', async () => {
      await as(c, 'authenticated', COACH_B, async (q) => {
        assert.equal((await q('select id from public.player_trackers where player_id = $1', [pa])).rowCount, 0);
        assert.equal((await q('select id from public.player_tracker_entries where player_id = $1', [pa])).rowCount, 0);
        assert.equal((await q("update public.player_trackers set name = 'x' where id = $1", [ta])).rowCount, 0);
        assert.equal((await q('delete from public.player_trackers where id = $1', [ta])).rowCount, 0);
      });
    });

    await t.test('anonymous callers see nothing and cannot insert', async () => {
      await as(c, 'anon', null, async (q) => {
        assert.equal((await q('select id from public.player_trackers')).rowCount, 0);
        assert.equal((await q('select id from public.player_tracker_entries')).rowCount, 0);
      });
      assert.equal(await errorCode(c, 'anon', null, "insert into public.player_trackers (coach_id, player_id, name) values ($1, $2, 'x')", [COACH_A, pa]), '42501');
    });

    await t.test('a coach cannot attach rows to someone else’s player or tracker', async () => {
      // A tracker on B's player, even when claiming to be its coach_id = A.
      assert.equal(await errorCode(c, 'authenticated', COACH_A, "insert into public.player_trackers (coach_id, player_id, name) values ($1, $2, 'x')", [COACH_A, pb]), '42501');
      // Claiming B's coach_id.
      assert.equal(await errorCode(c, 'authenticated', COACH_A, "insert into public.player_trackers (coach_id, player_id, name) values ($1, $2, 'x')", [COACH_B, pb]), '42501');
      // An entry on B's tracker under A's own player id (mismatched tracker / player).
      assert.equal(await errorCode(c, 'authenticated', COACH_A, "insert into public.player_tracker_entries (coach_id, player_id, tracker_id, entry_date) values ($1, $2, $3, '2026-01-01')", [COACH_A, pa, tb]), '42501');
      // Moving A's tracker to B's player.
      assert.equal(await errorCode(c, 'authenticated', COACH_A, 'update public.player_trackers set player_id = $1 where id = $2', [pb, ta]), '42501');
    });

    await t.test('the database refuses malformed rows', async () => {
      assert.equal(await errorCode(c, 'authenticated', COACH_A, "insert into public.player_trackers (coach_id, player_id, name, mode) values ($1, $2, 'x', 'weird')", [COACH_A, pa]), '23514');
      assert.equal(await errorCode(c, 'authenticated', COACH_A, "insert into public.player_tracker_entries (coach_id, player_id, tracker_id, entry_date, status) values ($1, $2, $3, '2026-01-01', 'hacked')", [COACH_A, pa, ta]), '23514');
      assert.equal(await errorCode(c, 'authenticated', COACH_A, "insert into public.player_tracker_entries (coach_id, player_id, tracker_id, entry_date, measurements) values ($1, $2, $3, '2026-01-01', '[1]')", [COACH_A, pa, ta]), '23514');
    });

    await t.test('one client_ref per tracker: a retried submit cannot add a second entry', async () => {
      const ref = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f';
      const sql = "insert into public.player_tracker_entries (coach_id, player_id, tracker_id, entry_date, client_ref) values ($1, $2, $3, '2026-01-01', $4)";
      await c.query(sql, [COACH_A, pa, ta, ref]);
      assert.equal(await errorCode(c, 'authenticated', COACH_A, sql, [COACH_A, pa, ta, ref]), '23505');
    });

    await t.test('legacy progress values are copied once, unchanged, and the copy can be re-run', async () => {
      await c.query("insert into public.player_metrics (coach_id, player_id, name, unit, value, recorded_on, note, author) values ($1, $2, 'Weight', 'kg', 70.5, '2026-01-10', 'fasted', 'coach'), ($1, $2, 'weight ', 'kg', 71, '2026-02-10', null, 'link')", [COACH_A, pa]);
      const sql = fs.readFileSync(MIGRATION, 'utf8');
      await c.query(sql);
      await c.query(sql);
      const tr = await c.query("select id, name, fields from public.player_trackers where player_id = $1 and legacy_key = 'weight|kg'", [pa]);
      assert.equal(tr.rowCount, 1);
      assert.equal(tr.rows[0].fields[0].unit, 'kg');
      const en = await c.query('select entry_date::text d, measurements, note, author, status from public.player_tracker_entries where tracker_id = $1 order by entry_date', [tr.rows[0].id]);
      assert.deepEqual(en.rows.map((r: { d: string; measurements: { value: unknown }; note: string; author: string; status: string }) => [r.d, Number(r.measurements.value), r.note, r.author, r.status]), [
        ['2026-01-10', 70.5, 'fasted', 'coach', 'approved'],
        ['2026-02-10', 71, '', 'link', 'approved'],
      ]);
      assert.equal((await c.query('select count(*)::int n from public.player_metrics where player_id = $1', [pa])).rows[0].n, 2, 'player_metrics is untouched');
    });
  } finally {
    await c.query('delete from public.players where id = any($1)', [[pa, pb]]);
    await c.end();
  }
});
