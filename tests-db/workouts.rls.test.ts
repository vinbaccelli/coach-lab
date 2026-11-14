import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { connect, as, errorCode, makePlayer, COACH_A, COACH_B } from './helpers';

const MIGRATION = path.join(process.cwd(), 'supabase/migrations/20261114120000_workouts.sql');

test('workouts: library, templates, planned workouts and logs — RLS, constraints, seed', async (t) => {
  const c = await connect();
  const pa = await makePlayer(c, COACH_A, 'Workouts A');
  const pb = await makePlayer(c, COACH_B, 'Workouts B');
  const global = (await c.query("select id from public.exercise_library where slug = 'push_up' and coach_id is null")).rows[0]?.id;
  const ownA = (await c.query("insert into public.exercise_library (coach_id, name) values ($1, 'A secret drill') returning id", [COACH_A])).rows[0].id;
  const tplA = (await c.query("insert into public.workout_templates (coach_id, title, items) values ($1, 'Legs', '[]') returning id", [COACH_A])).rows[0].id;
  const tplB = (await c.query("insert into public.workout_templates (coach_id, title) values ($1, 'B legs') returning id", [COACH_B])).rows[0].id;
  const wA = (await c.query("insert into public.player_workouts (coach_id, player_id, template_id, title, scheduled_on) values ($1, $2, $3, 'Legs', '2026-11-16') returning id", [COACH_A, pa, tplA])).rows[0].id;
  const wB = (await c.query("insert into public.player_workouts (coach_id, player_id, title, scheduled_on) values ($1, $2, 'B', '2026-11-16') returning id", [COACH_B, pb])).rows[0].id;

  try {
    await t.test('the migration seeds the global library once and can be re-run', async () => {
      assert.ok(global, 'push_up is seeded');
      const before = (await c.query('select count(*)::int n from public.exercise_library where coach_id is null')).rows[0].n;
      const sql = fs.readFileSync(MIGRATION, 'utf8');
      await c.query(sql);
      await c.query(sql);
      assert.equal((await c.query('select count(*)::int n from public.exercise_library where coach_id is null')).rows[0].n, before);
      assert.ok(before >= 30);
    });

    await t.test('global exercises: every coach reads them, nobody changes them; own exercises stay private', async () => {
      await as(c, 'authenticated', COACH_B, async (q) => {
        assert.equal((await q('select id from public.exercise_library where id = $1', [global])).rowCount, 1);
        assert.equal((await q('select id from public.exercise_library where id = $1', [ownA])).rowCount, 0, 'B cannot see A’s exercise');
        assert.equal((await q("update public.exercise_library set name = 'hacked' where id = $1", [global])).rowCount, 0);
        assert.equal((await q('delete from public.exercise_library where id = $1', [global])).rowCount, 0);
        assert.equal((await q("update public.exercise_library set name = 'hacked' where id = $1", [ownA])).rowCount, 0);
      });
      assert.equal(await errorCode(c, 'authenticated', COACH_B, "insert into public.exercise_library (coach_id, slug, name) values (null, 'fake_global', 'Fake')"), '42501');
      assert.equal(await errorCode(c, 'authenticated', COACH_B, "insert into public.exercise_library (coach_id, name) values ($1, 'x')", [COACH_A]), '42501');
      await as(c, 'anon', null, async (q) => {
        assert.equal((await q('select id from public.exercise_library')).rowCount, 0, 'anonymous callers read nothing');
      });
      await as(c, 'authenticated', COACH_A, async (q) => {
        assert.equal((await q("update public.exercise_library set name = 'Renamed' where id = $1", [ownA])).rowCount, 1);
      });
    });

    await t.test('templates, planned workouts and logs belong to their coach only', async () => {
      await as(c, 'authenticated', COACH_B, async (q) => {
        assert.equal((await q('select id from public.workout_templates where id = $1', [tplA])).rowCount, 0);
        assert.equal((await q('select id from public.player_workouts where id = $1', [wA])).rowCount, 0);
        assert.equal((await q("update public.player_workouts set title = 'x' where id = $1", [wA])).rowCount, 0);
        assert.equal((await q('delete from public.workout_templates where id = $1', [tplA])).rowCount, 0);
      });
      await as(c, 'authenticated', COACH_A, async (q) => {
        await q("insert into public.player_workout_logs (coach_id, player_id, workout_id, performed_on, title, items) values ($1, $2, $3, '2026-11-16', 'Legs', '[]')", [COACH_A, pa, wA]);
        assert.equal((await q('select id from public.player_workout_logs where player_id = $1', [pa])).rowCount, 1);
      });
      await as(c, 'anon', null, async (q) => {
        assert.equal((await q('select id from public.player_workouts')).rowCount, 0);
        assert.equal((await q('select id from public.player_workout_logs')).rowCount, 0);
      });
    });

    await t.test('a coach cannot plan from someone else’s template or attach rows to someone else’s player or workout', async () => {
      assert.equal(await errorCode(c, 'authenticated', COACH_A, "insert into public.player_workouts (coach_id, player_id, template_id, title, scheduled_on) values ($1, $2, $3, 'x', '2026-11-16')", [COACH_A, pa, tplB]), '42501');
      assert.equal(await errorCode(c, 'authenticated', COACH_A, "insert into public.player_workouts (coach_id, player_id, title, scheduled_on) values ($1, $2, 'x', '2026-11-16')", [COACH_A, pb]), '42501');
      assert.equal(await errorCode(c, 'authenticated', COACH_A, "insert into public.player_workout_logs (coach_id, player_id, workout_id, performed_on, title) values ($1, $2, $3, '2026-11-16', 'x')", [COACH_A, pa, wB]), '42501');
      // A log on A's own workout but filed under another of A's players: the workout must match the player.
      const pa2 = await makePlayer(c, COACH_A, 'Workouts A2');
      assert.equal(await errorCode(c, 'authenticated', COACH_A, "insert into public.player_workout_logs (coach_id, player_id, workout_id, performed_on, title) values ($1, $2, $3, '2026-11-16', 'x')", [COACH_A, pa2, wA]), '42501');
      await c.query('delete from public.players where id = $1', [pa2]);
    });

    await t.test('one log per planned workout; one client_ref per player', async () => {
      await c.query("insert into public.player_workout_logs (coach_id, player_id, workout_id, performed_on, title) values ($1, $2, $3, '2026-11-16', 'first')", [COACH_A, pa, wA]);
      assert.equal(await errorCode(c, 'authenticated', COACH_A, "insert into public.player_workout_logs (coach_id, player_id, workout_id, performed_on, title) values ($1, $2, $3, '2026-11-16', 'second')", [COACH_A, pa, wA]), '23505');
      const ref = '0d0d0d0d-0d0d-4d0d-8d0d-0d0d0d0d0d0d';
      await c.query("insert into public.player_workout_logs (coach_id, player_id, performed_on, title, client_ref) values ($1, $2, '2026-11-16', 'x', $3)", [COACH_A, pa, ref]);
      assert.equal(await errorCode(c, 'authenticated', COACH_A, "insert into public.player_workout_logs (coach_id, player_id, performed_on, title, client_ref) values ($1, $2, '2026-11-16', 'y', $3)", [COACH_A, pa, ref]), '23505');
    });

    await t.test('the database refuses malformed rows', async () => {
      const bad = async (sql: string, params: unknown[]) => assert.equal(await errorCode(c, 'authenticated', COACH_A, sql, params), '23514', sql);
      await bad("insert into public.exercise_library (coach_id, name, category) values ($1, 'x', 'yoga-ish')", [COACH_A]);
      await bad("insert into public.exercise_library (coach_id, name, log_fields) values ($1, 'x', '{reps,height}')", [COACH_A]);
      await bad("insert into public.exercise_library (coach_id, name, video_url) values ($1, 'x', 'javascript:alert(1)')", [COACH_A]);
      await bad("insert into public.exercise_library (coach_id, slug, name) values ($1, 'mine', 'x')", [COACH_A]);
      await bad("insert into public.workout_templates (coach_id, title, items) values ($1, 'x', '{}')", [COACH_A]);
      await bad("insert into public.player_workouts (coach_id, player_id, title, scheduled_on, status) values ($1, $2, 'x', '2026-11-16', 'done')", [COACH_A, pa]);
      await bad("insert into public.player_workout_logs (coach_id, player_id, performed_on, title, rpe) values ($1, $2, '2026-11-16', 'x', 11)", [COACH_A, pa]);
      await bad("insert into public.player_workout_logs (coach_id, player_id, performed_on, title, status) values ($1, $2, '2026-11-16', 'x', 'hacked')", [COACH_A, pa]);
    });

    await t.test('deleting a planned workout keeps its log; deleting the player removes everything of theirs', async () => {
      const w2 = (await c.query("insert into public.player_workouts (coach_id, player_id, title, scheduled_on) values ($1, $2, 'Upper', '2026-11-18') returning id", [COACH_A, pa])).rows[0].id;
      const l2 = (await c.query("insert into public.player_workout_logs (coach_id, player_id, workout_id, performed_on, title) values ($1, $2, $3, '2026-11-18', 'Upper') returning id", [COACH_A, pa, w2])).rows[0].id;
      await c.query('delete from public.player_workouts where id = $1', [w2]);
      assert.equal((await c.query('select workout_id from public.player_workout_logs where id = $1', [l2])).rows[0].workout_id, null);
      const px = await makePlayer(c, COACH_A, 'Workouts X');
      await c.query("insert into public.player_workouts (coach_id, player_id, title, scheduled_on) values ($1, $2, 'x', '2026-11-16')", [COACH_A, px]);
      await c.query("insert into public.player_workout_logs (coach_id, player_id, performed_on, title) values ($1, $2, '2026-11-16', 'x')", [COACH_A, px]);
      await c.query('delete from public.players where id = $1', [px]);
      assert.equal((await c.query('select count(*)::int n from public.player_workouts where player_id = $1', [px])).rows[0].n, 0);
      assert.equal((await c.query('select count(*)::int n from public.player_workout_logs where player_id = $1', [px])).rows[0].n, 0);
    });
  } finally {
    await c.query('delete from public.players where id = any($1)', [[pa, pb]]);
    await c.query('delete from public.workout_templates where id = any($1)', [[tplA, tplB]]);
    await c.query('delete from public.exercise_library where id = $1', [ownA]);
    await c.end();
  }
});
