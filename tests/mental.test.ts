import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateQuestions, validateQuestionnaire, validateAnswers, describeAnswer, scaleTrends,
  validateAssignment, nextDue, assignmentState,
} from '../lib/players/mental';

test('questions: kinds, unique ids, scale bounds, choices need two options', () => {
  const r = validateQuestions([
    { label: 'Sleep', kind: 'scale', min: 1, max: 10, better: 'higher' },
    { label: 'Sleep', kind: 'scale', min: 1, max: 5 },
    { label: 'Result', kind: 'choice', options: ['Won', 'Lost', 'Won'] },
    { label: 'Notes' },
    { label: '' },
  ]);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.value.map((q) => [q.id, q.kind]), [['sleep', 'scale'], ['sleep_2', 'scale'], ['result', 'choice'], ['notes', 'text']]);
  assert.deepEqual(r.value[2].options, ['Won', 'Lost']);
  assert.equal(validateQuestions([{ label: 'x', kind: 'choice', options: ['only'] }]).ok, false);
  assert.equal(validateQuestions([{ label: 'x', kind: 'scale', min: 5, max: 5 }]).ok, false);
  assert.equal(validateQuestions([]).ok, false);
  assert.equal(validateQuestionnaire({ title: 'Check', kind: 'weird', questions: [{ label: 'a' }] }).ok && validateQuestionnaire({ title: 'Check', kind: 'weird', questions: [{ label: 'a' }] }).value.kind, 'questionnaire');
});

test('answers are checked against the questions', () => {
  const qs = validateQuestions([
    { id: 'sleep', label: 'Sleep', kind: 'scale', min: 1, max: 10 },
    { id: 'result', label: 'Result', kind: 'choice', options: ['Won', 'Lost'] },
    { id: 'injured', label: 'Injured?', kind: 'yesno' },
    { id: 'note', label: 'Note', kind: 'text' },
  ]);
  assert.ok(qs.ok);
  if (!qs.ok) return;
  const ok = validateAnswers(qs.value, { sleep: '7', result: 'Won', injured: false, note: '  fine ', extra: 'ignored' });
  assert.deepEqual(ok, { ok: true, value: { sleep: 7, result: 'Won', injured: false, note: 'fine' } });
  assert.equal(validateAnswers(qs.value, { sleep: 11 }).ok, false);
  assert.equal(validateAnswers(qs.value, { sleep: 6.5 }).ok, false);
  assert.equal(validateAnswers(qs.value, { result: 'Draw' }).ok, false);
  assert.equal(validateAnswers(qs.value, { injured: 'yes' }).ok, false);
  assert.equal(validateAnswers(qs.value, {}).ok, false);
  assert.equal(describeAnswer(qs.value[0], 7), '7 / 10');
  assert.equal(describeAnswer(qs.value[2], true), 'Yes');
});

test('scale trends over time, with the direction that counts as better', () => {
  const qs = validateQuestions([{ id: 'stress', label: 'Stress', kind: 'scale', better: 'lower' }, { id: 'mood', label: 'Mood', kind: 'scale' }]);
  assert.ok(qs.ok);
  if (!qs.ok) return;
  const t = scaleTrends(qs.value, [
    { answered_on: '2026-11-10', answers: { stress: 8, mood: 5 } },
    { answered_on: '2026-11-03', answers: { stress: 6, mood: 6 } },
    { answered_on: '2026-11-12', answers: { stress: 1 }, status: 'needs_revision' },
  ]);
  assert.deepEqual(t[0].points.map((p) => p.value), [6, 8]);
  assert.equal(t[0].improved, false, 'stress went up: worse');
  assert.equal(t[1].improved, false, 'mood went down: worse');
});

test('assignments: validation, next due date, state', () => {
  assert.equal(validateAssignment({ title: '' }).ok, false);
  assert.equal(validateAssignment({ title: 'Stretch', recurrence: 'daily' }).ok, false, 'a repeating task needs a first date');
  const r = validateAssignment({ title: 'Stretch', due_on: '2026-11-14', recurrence: 'weekly' });
  assert.ok(r.ok && r.value.recurrence === 'weekly');
  assert.equal(nextDue('2026-11-14', 'daily'), '2026-11-15');
  assert.equal(nextDue('2026-11-14', 'weekly'), '2026-11-21');
  assert.equal(nextDue('2026-01-31', 'monthly'), '2026-02-28');
  assert.equal(nextDue('2026-11-14', 'none'), null);
  assert.equal(assignmentState({ status: 'open', due_on: '2026-11-13' }, '2026-11-14'), 'overdue');
  assert.equal(assignmentState({ status: 'open', due_on: '2026-11-14' }, '2026-11-14'), 'today');
  assert.equal(assignmentState({ status: 'open', due_on: null }, '2026-11-14'), 'no_date');
  assert.equal(assignmentState({ status: 'done', due_on: '2026-11-01' }, '2026-11-14'), 'done');
});
