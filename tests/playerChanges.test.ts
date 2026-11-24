import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeBlueprintChange } from '../lib/players/changes';
import { itemFromChange } from '../lib/players/history';
import { EMPTY_BLUEPRINT, setChoice, setCheck, variantsFor, checkpointsFor } from '../lib/players/blueprint';

const group = variantsFor('forehand')[0];
const optA = group.options[0];
const optB = group.options[1];

test('saving the same Blueprint again leaves no stamp', () => {
  assert.equal(summarizeBlueprintChange(EMPTY_BLUEPRINT, EMPTY_BLUEPRINT), null);
  assert.equal(summarizeBlueprintChange(null, {}), null);
});

test('choosing a variant is stamped with what it is, and what it was', () => {
  const a = setChoice(EMPTY_BLUEPRINT, 'forehand', group.id, { option: optA.id });
  const first = summarizeBlueprintChange(EMPTY_BLUEPRINT, a);
  assert.ok(first);
  assert.equal(first.title, 'Blueprint updated');
  assert.ok(first.body.includes(optA.label), first.body);
  const b = setChoice(a, 'forehand', group.id, { option: optB.id });
  const second = summarizeBlueprintChange(a, b);
  assert.ok(second && second.body.includes(optB.label) && second.body.includes(`was ${optA.label}`), second?.body);
});

test('marking a fundamentals check is counted per stroke', () => {
  const c = checkpointsFor('forehand')[0];
  const marked = setCheck(EMPTY_BLUEPRINT, 'forehand', c.id, c.answers[0].label, '', '2026-11-21');
  const s = summarizeBlueprintChange(EMPTY_BLUEPRINT, marked);
  assert.ok(s && /Forehand: 1 check marked or changed/.test(s.body), s?.body);
});

test('a change-log row becomes a timeline item in its section; a row without a title or section is dropped', () => {
  const it = itemFromChange({ id: 'x1', section: 'technical', title: 'Blueprint updated', body: 'Serve: 2 checks marked or changed', created_at: '2026-11-21T10:00:00Z' });
  assert.deepEqual([it?.key, it?.type, it?.section, it?.date], ['chg-x1', 'change', 'technical', '2026-11-21']);
  assert.equal(itemFromChange({ id: 'x2', section: 'bogus', title: 'T', body: '', created_at: '2026-11-21T10:00:00Z' }), null);
  assert.equal(itemFromChange({ id: 'x3', section: 'technical', title: '', body: '', created_at: '2026-11-21T10:00:00Z' }), null);
});
