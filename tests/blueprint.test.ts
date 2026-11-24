import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_BLUEPRINT, STROKE_KEYS, SCOPES, variantsFor, checkpointsFor, stepsFor, sheetChecks, checksForStep,
  setChoice, setCheck, sanitizeBlueprint, faults, progress, choiceOf, choiceLabel, type StrokeKey,
} from '../lib/players/blueprint';

test('the eBook pages are all there: item counts per stroke and per Blueprint table', () => {
  assert.equal(checkpointsFor('forehand').length, 20); // Part 1: C1 3, G1 2, G2 2, G3 2, G4 3, G5 2, C7 3, G6-G8 3
  assert.equal(checkpointsFor('two_handed_backhand').length, 20);
  assert.equal(checkpointsFor('one_handed_backhand').length, 20);
  assert.equal(checkpointsFor('serve').length, 8);
  assert.equal(checkpointsFor('volley').length, 5);
  assert.deepEqual(
    Object.fromEntries(SCOPES.map((s) => [s, variantsFor(s).length])),
    { general: 5, forehand: 6, two_handed_backhand: 4, one_handed_backhand: 4, serve: 8, volley: 2 },
  );
});

test('ids are unique, every step id belongs to the stroke, every item has answers', () => {
  for (const stroke of STROKE_KEYS) {
    const steps = new Set(stepsFor(stroke).map((s) => s.id));
    const ids = checkpointsFor(stroke).map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length, `${stroke} check ids unique`);
    for (const c of checkpointsFor(stroke)) {
      assert.ok(c.answers.length >= 2, `${c.id} has answers`);
      assert.ok(c.stepId === null || steps.has(c.stepId), `${c.id} step ${c.stepId} is a ${stroke} step`);
    }
  }
  for (const scope of SCOPES) {
    const ids = variantsFor(scope).map((g) => g.id);
    assert.equal(new Set(ids).size, ids.length, `${scope} variant ids unique`);
    for (const g of variantsFor(scope)) {
      const o = g.options.map((x) => x.id);
      assert.equal(new Set(o).size, o.length, `${scope}.${g.id} option ids unique`);
      assert.ok(o.length >= 2);
      if (g.stepId && scope !== 'general') assert.ok(stepsFor(scope as StrokeKey).some((s) => s.id === g.stepId), `${scope}.${g.id} step`);
    }
  }
});

test('the book marks its own faults', () => {
  const hips = checkpointsFor('forehand').find((c) => c.id === 'g4-hips')!;
  assert.deepEqual(hips.answers, [{ label: 'Yes' }, { label: 'Simultaneous', fault: true }]);
  const wrist = checkpointsFor('forehand').find((c) => c.id === 'g4-wrist')!;
  assert.deepEqual(wrist.answers.filter((a) => a.fault).map((a) => a.label), ['Rigid']);
});

test('a choice adds one "executing it correctly?" check, on the right step', () => {
  let bp = EMPTY_BLUEPRINT;
  assert.equal(sheetChecks('forehand', bp).length, 20);
  bp = setChoice(bp, 'forehand', 'drop-style', { option: 'edge-down-del-potro-approach' });
  const checks = sheetChecks('forehand', bp);
  assert.equal(checks.length, 21);
  const ex = checks.find((c) => c.kind === 'execution')!;
  assert.equal(ex.stepId, 'racket_drop');
  assert.match(ex.text, /racket drop style/i);
  assert.match(ex.text, /Edge-down/);
  assert.ok(checksForStep('forehand', bp, 'racket_drop').some((c) => c.id === ex.id));
  // the groundstroke-wide choices reach all three groundstrokes
  bp = setChoice(bp, 'general', 'pp-timing', { option: 'before-bounce-fluid-federer-djokovic' });
  assert.equal(sheetChecks('two_handed_backhand', bp).filter((c) => c.kind === 'execution').length, 1);
  assert.equal(sheetChecks('serve', bp).filter((c) => c.kind === 'execution').length, 0);
});

test('invalid choices are refused, "Other" keeps the coach\'s words, null clears', () => {
  let bp = setChoice(EMPTY_BLUEPRINT, 'forehand', 'grip', { option: 'nope' });
  assert.equal(choiceOf(bp, 'forehand', 'grip'), undefined);
  bp = setChoice(bp, 'forehand', 'nope', { option: 'eastern-bevel-3' });
  assert.deepEqual(bp.choices, {});
  bp = setChoice(bp, 'forehand', 'grip', { other: '  between 3 and 4  ' });
  assert.equal(choiceLabel('forehand', 'grip', choiceOf(bp, 'forehand', 'grip')), 'between 3 and 4');
  bp = setChoice(bp, 'forehand', 'grip', null);
  assert.equal(choiceOf(bp, 'forehand', 'grip'), undefined);
});

test('marking: only the item\'s own answers and a real date are accepted; empty clears', () => {
  let bp = setCheck(EMPTY_BLUEPRINT, 'forehand', 'g4-wrist', 'Rigid', ' too stiff ', '2026-11-19');
  assert.deepEqual(bp.checks.forehand!['g4-wrist'], { answer: 'Rigid', note: 'too stiff', date: '2026-11-19' });
  assert.equal(setCheck(bp, 'forehand', 'g4-wrist', 'Maybe', '', '2026-11-19'), bp);
  assert.equal(setCheck(bp, 'forehand', 'g4-wrist', 'Loose', '', '19/11/2026'), bp);
  assert.equal(setCheck(bp, 'forehand', 'no-such-check', 'Yes', '', '2026-11-19'), bp);
  assert.deepEqual(faults('forehand', bp).map((f) => f.check.id), ['g4-wrist']);
  assert.deepEqual(progress('forehand', bp), { done: 1, total: 20 });
  bp = setCheck(bp, 'forehand', 'g4-wrist', '', '', '2026-11-19');
  assert.deepEqual(progress('forehand', bp), { done: 0, total: 20 });
});

test('an execution mark remembers the option it was made against, after the choice changes', () => {
  let bp = setChoice(EMPTY_BLUEPRINT, 'forehand', 'drop-style', { option: 'edge-down-del-potro-approach' });
  const id = sheetChecks('forehand', bp).find((c) => c.kind === 'execution')!.id;
  bp = setCheck(bp, 'forehand', id, 'Partly', '', '2026-11-19');
  assert.equal(bp.checks.forehand![id].against, 'edge-down-del-potro-approach');
  assert.deepEqual(faults('forehand', bp).map((f) => f.check.id), [id]);
  // round trip through the sanitizer (what the database returns) keeps it
  const back = sanitizeBlueprint(JSON.parse(JSON.stringify(bp)));
  assert.equal(back.checks.forehand![id].against, 'edge-down-del-potro-approach');
  // changing the choice does not rewrite the old mark
  const changed = setChoice(bp, 'forehand', 'drop-style', { option: 'face-down-federer-approach' });
  assert.equal(changed.checks.forehand![id].against, 'edge-down-del-potro-approach');
});

test('sanitize: junk in, a clean blueprint out; marks for a choice that is gone are dropped', () => {
  assert.deepEqual(sanitizeBlueprint(null), EMPTY_BLUEPRINT);
  assert.deepEqual(sanitizeBlueprint('x'), EMPTY_BLUEPRINT);
  const dirty = {
    v: 'whatever',
    choices: { forehand: { grip: { option: 'eastern-bevel-3' }, bogus: { option: 'a' }, arm: { option: 'zzz' } }, nope: { a: 1 } },
    checks: { forehand: { 'g1-postserve': { answer: 'Yes', note: 'x'.repeat(5000), date: '2026-11-19' }, 'exec.forehand.drop-style': { answer: 'Yes', date: '2026-11-19' }, bad: 5 } },
  };
  const clean = sanitizeBlueprint(dirty);
  assert.deepEqual(clean.choices, { forehand: { grip: { option: 'eastern-bevel-3' } } });
  assert.deepEqual(Object.keys(clean.checks.forehand!), ['g1-postserve']);
  assert.equal(clean.checks.forehand!['g1-postserve'].note.length, 1000);
});
