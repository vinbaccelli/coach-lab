import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { connect, as, errorCode, makePlayer, COACH_A, COACH_B } from './helpers';

const MIGRATION = path.join(process.cwd(), 'supabase/migrations/20261114110000_player_nutrition.sql');

test('nutrition plans and meal logs: RLS, constraints, idempotent migration', async (t) => {
  const c = await connect();
  const pa = await makePlayer(c, COACH_A, 'Nutrition A');
  const pb = await makePlayer(c, COACH_B, 'Nutrition B');
  const planA = (await c.query("insert into public.player_nutrition_plans (coach_id, player_id, title, starts_on, targets) values ($1, $2, 'January', '2026-01-01', '{\"calories\": 2500}') returning id", [COACH_A, pa])).rows[0].id;
  const mealA = (await c.query("insert into public.player_meal_logs (coach_id, player_id, eaten_on, category, description, calories, author, status) values ($1, $2, '2026-01-02', 'lunch', 'Rice', 600, 'link', 'submitted') returning id", [COACH_A, pa])).rows[0].id;

  try {
    await t.test('the migration can be run again without changing anything', async () => {
      const sql = fs.readFileSync(MIGRATION, 'utf8');
      await c.query(sql);
      await c.query(sql);
      assert.equal((await c.query('select count(*)::int n from public.player_nutrition_plans where player_id = $1', [pa])).rows[0].n, 1);
      assert.equal((await c.query('select status from public.player_meal_logs where id = $1', [mealA])).rows[0].status, 'submitted');
    });

    await t.test('the owning coach reads, writes, versions and deletes', async () => {
      await as(c, 'authenticated', COACH_A, async (q) => {
        assert.equal((await q('select id from public.player_nutrition_plans where player_id = $1', [pa])).rowCount, 1);
        assert.equal((await q('select id from public.player_meal_logs where player_id = $1', [pa])).rowCount, 1);
        const v2 = await q("insert into public.player_nutrition_plans (coach_id, player_id, title, starts_on, previous_id) values ($1, $2, 'February', '2026-02-01', $3) returning id", [COACH_A, pa, planA]);
        assert.equal(v2.rowCount, 1);
        assert.equal((await q("update public.player_nutrition_plans set ends_on = '2026-01-31' where id = $1", [planA])).rowCount, 1);
        assert.equal((await q("update public.player_meal_logs set status = 'approved', reviewed_at = now() where id = $1", [mealA])).rowCount, 1);
        await q("insert into public.player_meal_logs (coach_id, player_id, eaten_on, description) values ($1, $2, '2026-01-03', 'Pasta')", [COACH_A, pa]);
        // Deleting the first version keeps the second: its link is cleared, not the row.
        assert.equal((await q('delete from public.player_nutrition_plans where id = $1', [planA])).rowCount, 1);
        assert.equal((await q('select previous_id from public.player_nutrition_plans where id = $1', [v2.rows[0].id])).rows[0].previous_id, null);
      });
    });

    await t.test('another coach sees nothing and changes nothing', async () => {
      await as(c, 'authenticated', COACH_B, async (q) => {
        assert.equal((await q('select id from public.player_nutrition_plans where player_id = $1', [pa])).rowCount, 0);
        assert.equal((await q('select id from public.player_meal_logs where player_id = $1', [pa])).rowCount, 0);
        assert.equal((await q("update public.player_nutrition_plans set title = 'x' where id = $1", [planA])).rowCount, 0);
        assert.equal((await q("update public.player_meal_logs set status = 'approved' where id = $1", [mealA])).rowCount, 0);
        assert.equal((await q('delete from public.player_meal_logs where id = $1', [mealA])).rowCount, 0);
        assert.equal((await q('delete from public.player_nutrition_plans where id = $1', [planA])).rowCount, 0);
      });
    });

    await t.test('anonymous callers see nothing and cannot insert', async () => {
      await as(c, 'anon', null, async (q) => {
        assert.equal((await q('select id from public.player_nutrition_plans')).rowCount, 0);
        assert.equal((await q('select id from public.player_meal_logs')).rowCount, 0);
      });
      assert.equal(await errorCode(c, 'anon', null, "insert into public.player_meal_logs (coach_id, player_id, eaten_on) values ($1, $2, '2026-01-01')", [COACH_A, pa]), '42501');
      assert.equal(await errorCode(c, 'anon', null, "insert into public.player_nutrition_plans (coach_id, player_id, title, starts_on) values ($1, $2, 'x', '2026-01-01')", [COACH_A, pa]), '42501');
    });

    await t.test('a coach cannot attach rows to someone else’s player', async () => {
      assert.equal(await errorCode(c, 'authenticated', COACH_A, "insert into public.player_nutrition_plans (coach_id, player_id, title, starts_on) values ($1, $2, 'x', '2026-01-01')", [COACH_A, pb]), '42501');
      assert.equal(await errorCode(c, 'authenticated', COACH_A, "insert into public.player_meal_logs (coach_id, player_id, eaten_on) values ($1, $2, '2026-01-01')", [COACH_B, pb]), '42501');
      assert.equal(await errorCode(c, 'authenticated', COACH_A, 'update public.player_meal_logs set player_id = $1 where id = $2', [pb, mealA]), '42501');
      assert.equal(await errorCode(c, 'authenticated', COACH_A, 'update public.player_nutrition_plans set player_id = $1 where id = $2', [pb, planA]), '42501');
    });

    await t.test('the database refuses malformed rows', async () => {
      const bad = async (sql: string, params: unknown[]) => assert.equal(await errorCode(c, 'authenticated', COACH_A, sql, params), '23514', sql);
      await bad("insert into public.player_nutrition_plans (coach_id, player_id, title, starts_on, ends_on) values ($1, $2, 'x', '2026-02-01', '2026-01-01')", [COACH_A, pa]);
      await bad("insert into public.player_nutrition_plans (coach_id, player_id, title, starts_on, status) values ($1, $2, 'x', '2026-02-01', 'live')", [COACH_A, pa]);
      await bad("insert into public.player_nutrition_plans (coach_id, player_id, title, starts_on, targets) values ($1, $2, 'x', '2026-02-01', '[1]')", [COACH_A, pa]);
      await bad("insert into public.player_nutrition_plans (coach_id, player_id, title, starts_on) values ($1, $2, '   ', '2026-02-01')", [COACH_A, pa]);
      await bad("insert into public.player_meal_logs (coach_id, player_id, eaten_on, calories) values ($1, $2, '2026-01-01', -1)", [COACH_A, pa]);
      await bad("insert into public.player_meal_logs (coach_id, player_id, eaten_on, protein_g) values ($1, $2, '2026-01-01', 5000)", [COACH_A, pa]);
      await bad("insert into public.player_meal_logs (coach_id, player_id, eaten_on, category) values ($1, $2, '2026-01-01', 'brunch')", [COACH_A, pa]);
      await bad("insert into public.player_meal_logs (coach_id, player_id, eaten_on, status) values ($1, $2, '2026-01-01', 'hacked')", [COACH_A, pa]);
      await bad("insert into public.player_meal_logs (coach_id, player_id, eaten_on, author) values ($1, $2, '2026-01-01', 'admin')", [COACH_A, pa]);
      await bad("insert into public.player_meal_logs (coach_id, player_id, eaten_on, extras) values ($1, $2, '2026-01-01', '[]')", [COACH_A, pa]);
    });

    await t.test('one client_ref per player: a retried meal cannot be logged twice', async () => {
      const ref = '0e0e0e0e-0e0e-4e0e-8e0e-0e0e0e0e0e0e';
      const sql = "insert into public.player_meal_logs (coach_id, player_id, eaten_on, client_ref) values ($1, $2, '2026-01-01', $3)";
      await c.query(sql, [COACH_A, pa, ref]);
      assert.equal(await errorCode(c, 'authenticated', COACH_A, sql, [COACH_A, pa, ref]), '23505');
    });

    await t.test('deleting a player removes their plans and meals', async () => {
      const px = await makePlayer(c, COACH_A, 'Nutrition X');
      await c.query("insert into public.player_nutrition_plans (coach_id, player_id, title, starts_on) values ($1, $2, 'x', '2026-01-01')", [COACH_A, px]);
      await c.query("insert into public.player_meal_logs (coach_id, player_id, eaten_on) values ($1, $2, '2026-01-01')", [COACH_A, px]);
      await c.query('delete from public.players where id = $1', [px]);
      assert.equal((await c.query('select count(*)::int n from public.player_nutrition_plans where player_id = $1', [px])).rows[0].n, 0);
      assert.equal((await c.query('select count(*)::int n from public.player_meal_logs where player_id = $1', [px])).rows[0].n, 0);
    });
  } finally {
    await c.query('delete from public.players where id = any($1)', [[pa, pb]]);
    await c.end();
  }
});
