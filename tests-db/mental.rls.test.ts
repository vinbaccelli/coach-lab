import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { connect, as, errorCode, makePlayer, COACH_A, COACH_B } from './helpers';

const MIGRATION = path.join(process.cwd(), 'supabase/migrations/20261114130000_mental_assignments.sql');
const QS = JSON.stringify([{ id: 'mood', kind: 'scale', label: 'Mood', min: 1, max: 10 }]);

test('mental questionnaires, assessments and assignments: RLS, constraints, seed', async (t) => {
  const c = await connect();
  const pa = await makePlayer(c, COACH_A, 'Mental A');
  const pa2 = await makePlayer(c, COACH_A, 'Mental A2');
  const pb = await makePlayer(c, COACH_B, 'Mental B');
  const builtIn = (await c.query("select id from public.questionnaire_templates where slug = 'weekly_wellness' and coach_id is null")).rows[0]?.id as string | undefined;
  const ownA = (await c.query("insert into public.questionnaire_templates (coach_id, title, questions) values ($1, 'A private', $2) returning id", [COACH_A, QS])).rows[0].id as string;
  const qA = (await c.query("insert into public.player_questionnaires (coach_id, player_id, kind, title, questions) values ($1, $2, 'questionnaire', 'Check', $3) returning id", [COACH_A, pa, QS])).rows[0].id as string;
  const assessA = (await c.query("insert into public.player_questionnaires (coach_id, player_id, kind, title, questions) values ($1, $2, 'assessment', 'Assess', $3) returning id", [COACH_A, pa, QS])).rows[0].id as string;
  const qB = (await c.query("insert into public.player_questionnaires (coach_id, player_id, kind, title, questions) values ($1, $2, 'questionnaire', 'B check', $3) returning id", [COACH_B, pb, QS])).rows[0].id as string;

  try {
    await t.test('the built-in questionnaires are seeded once and the file can be re-run', async () => {
      assert.ok(builtIn, 'weekly_wellness is seeded');
      const before = (await c.query('select count(*)::int n from public.questionnaire_templates where coach_id is null')).rows[0].n as number;
      const sql = fs.readFileSync(MIGRATION, 'utf8');
      await c.query(sql);
      await c.query(sql);
      assert.equal((await c.query('select count(*)::int n from public.questionnaire_templates where coach_id is null')).rows[0].n, before);
      assert.equal(before, 4);
    });

    await t.test('built-in templates are shared and read-only; own templates stay private', async () => {
      await as(c, 'authenticated', COACH_B, async (q) => {
        assert.equal((await q('select id from public.questionnaire_templates where id = $1', [builtIn])).rowCount, 1);
        assert.equal((await q('select id from public.questionnaire_templates where id = $1', [ownA])).rowCount, 0);
        assert.equal((await q("update public.questionnaire_templates set title = 'x' where id = $1", [builtIn])).rowCount, 0);
        assert.equal((await q('delete from public.questionnaire_templates where id = $1', [builtIn])).rowCount, 0);
      });
      await as(c, 'anon', null, async (q) => {
        assert.equal((await q('select id from public.questionnaire_templates')).rowCount, 0);
      });
      assert.equal(await errorCode(c, 'authenticated', COACH_B, "insert into public.questionnaire_templates (coach_id, slug, title) values (null, 'fake', 'x')"), '42501');
    });

    await t.test('questionnaires, answers and assignments belong to their coach only', async () => {
      await as(c, 'authenticated', COACH_B, async (q) => {
        assert.equal((await q('select id from public.player_questionnaires where player_id = $1', [pa])).rowCount, 0);
        assert.equal((await q("update public.player_questionnaires set status = 'closed' where id = $1", [qA])).rowCount, 0);
        assert.equal((await q('delete from public.player_questionnaires where id = $1', [assessA])).rowCount, 0);
      });
      await as(c, 'authenticated', COACH_A, async (q) => {
        await q("insert into public.player_questionnaire_responses (coach_id, player_id, questionnaire_id, answers) values ($1, $2, $3, '{\"mood\": 7}')", [COACH_A, pa, qA]);
        await q("insert into public.player_assignments (coach_id, player_id, title, questionnaire_id) values ($1, $2, 'Answer it', $3)", [COACH_A, pa, qA]);
        assert.equal((await q('select id from public.player_questionnaire_responses where player_id = $1', [pa])).rowCount, 1);
      });
      await as(c, 'anon', null, async (q) => {
        assert.equal((await q('select id from public.player_questionnaires')).rowCount, 0);
        assert.equal((await q('select id from public.player_questionnaire_responses')).rowCount, 0);
        assert.equal((await q('select id from public.player_assignments')).rowCount, 0);
      });
    });

    await t.test('rows must match: answers to the questionnaire’s player, tasks to a questionnaire (not an assessment) of the same player', async () => {
      const ans = "insert into public.player_questionnaire_responses (coach_id, player_id, questionnaire_id, answers) values ($1, $2, $3, '{}')";
      assert.equal(await errorCode(c, 'authenticated', COACH_A, ans, [COACH_A, pa2, qA]), '42501', 'answers filed under another of my players');
      assert.equal(await errorCode(c, 'authenticated', COACH_A, ans, [COACH_A, pb, qA]), '42501', 'answers filed under another coach’s player');
      assert.equal(await errorCode(c, 'authenticated', COACH_A, ans, [COACH_A, pa, qB]), '42501', 'answers to another coach’s questionnaire');
      const task = "insert into public.player_assignments (coach_id, player_id, title, questionnaire_id) values ($1, $2, 'x', $3)";
      assert.equal(await errorCode(c, 'authenticated', COACH_A, task, [COACH_A, pa2, qA]), '42501', 'a task pointing at another player’s questionnaire');
      assert.equal(await errorCode(c, 'authenticated', COACH_A, task, [COACH_A, pa, assessA]), '42501', 'a task asking the player to answer an assessment');
      assert.equal(await errorCode(c, 'authenticated', COACH_A, "insert into public.player_questionnaires (coach_id, player_id, kind, title, questions) values ($1, $2, 'questionnaire', 'x', $3)", [COACH_A, pb, QS]), '42501');
      // Templates of another coach cannot be the source of a questionnaire.
      const ownB = (await c.query("insert into public.questionnaire_templates (coach_id, title, questions) values ($1, 'B private', $2) returning id", [COACH_B, QS])).rows[0].id as string;
      assert.equal(await errorCode(c, 'authenticated', COACH_A, "insert into public.player_questionnaires (coach_id, player_id, template_id, kind, title, questions) values ($1, $2, $3, 'questionnaire', 'x', $4)", [COACH_A, pa, ownB, QS]), '42501');
      await c.query('delete from public.questionnaire_templates where id = $1', [ownB]);
    });

    await t.test('the database refuses malformed rows', async () => {
      const bad = async (sql: string, params: unknown[]) => assert.equal(await errorCode(c, 'authenticated', COACH_A, sql, params), '23514', sql);
      await bad("insert into public.player_questionnaires (coach_id, player_id, kind, title, questions) values ($1, $2, 'survey', 'x', $3)", [COACH_A, pa, QS]);
      await bad("insert into public.player_questionnaires (coach_id, player_id, kind, title, questions) values ($1, $2, 'questionnaire', 'x', '[]')", [COACH_A, pa]);
      await bad("insert into public.player_assignments (coach_id, player_id, title, recurrence) values ($1, $2, 'x', 'weekly')", [COACH_A, pa]);
      await bad("insert into public.player_assignments (coach_id, player_id, title, recurrence, due_on) values ($1, $2, 'x', 'hourly', '2026-11-14')", [COACH_A, pa]);
      await bad("insert into public.player_assignments (coach_id, player_id, title, status) values ($1, $2, 'x', 'hacked')", [COACH_A, pa]);
      await bad("insert into public.player_questionnaire_responses (coach_id, player_id, questionnaire_id, answers) values ($1, $2, $3, '[1]')", [COACH_A, pa, qA]);
      await bad("insert into public.player_questionnaire_responses (coach_id, player_id, questionnaire_id, status) values ($1, $2, $3, 'hacked')", [COACH_A, pa, qA]);
    });

    await t.test('deleting a questionnaire removes its answers and frees its tasks; deleting the player removes everything', async () => {
      const q2 = (await c.query("insert into public.player_questionnaires (coach_id, player_id, kind, title, questions) values ($1, $2, 'questionnaire', 'Temp', $3) returning id", [COACH_A, pa, QS])).rows[0].id as string;
      await c.query("insert into public.player_questionnaire_responses (coach_id, player_id, questionnaire_id) values ($1, $2, $3)", [COACH_A, pa, q2]);
      const task = (await c.query("insert into public.player_assignments (coach_id, player_id, title, questionnaire_id) values ($1, $2, 'Answer temp', $3) returning id", [COACH_A, pa, q2])).rows[0].id as string;
      await c.query('delete from public.player_questionnaires where id = $1', [q2]);
      assert.equal((await c.query('select count(*)::int n from public.player_questionnaire_responses where questionnaire_id = $1', [q2])).rows[0].n, 0);
      assert.equal((await c.query('select questionnaire_id from public.player_assignments where id = $1', [task])).rows[0].questionnaire_id, null);
      const px = await makePlayer(c, COACH_A, 'Mental X');
      await c.query("insert into public.player_questionnaires (coach_id, player_id, kind, title, questions) values ($1, $2, 'questionnaire', 'x', $3)", [COACH_A, px, QS]);
      await c.query("insert into public.player_assignments (coach_id, player_id, title) values ($1, $2, 'x')", [COACH_A, px]);
      await c.query('delete from public.players where id = $1', [px]);
      assert.equal((await c.query('select count(*)::int n from public.player_questionnaires where player_id = $1', [px])).rows[0].n, 0);
      assert.equal((await c.query('select count(*)::int n from public.player_assignments where player_id = $1', [px])).rows[0].n, 0);
    });
  } finally {
    await c.query('delete from public.players where id = any($1)', [[pa, pa2, pb]]);
    await c.query('delete from public.questionnaire_templates where id = $1', [ownA]);
    await c.end();
  }
});
