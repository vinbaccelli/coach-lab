import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultPermissions, resolvePermissions, cleanPermissionsInput, addKindForCategory, seeSectionForCategory, ADD_KINDS } from '../lib/players/sharePermissions';

test('defaults: view sees the usual sections and adds nothing; Mental is private', () => {
  const v = defaultPermissions('view');
  assert.equal(v.see.fitness, true);
  assert.equal(v.see.mental, false);
  assert.ok(ADD_KINDS.every((k) => v.add[k] === false));
  const e = defaultPermissions('edit');
  assert.ok(ADD_KINDS.every((k) => e.add[k] === true));
});

test('stored values override defaults; a view link can never add', () => {
  const p = resolvePermissions('view', { add: { comments: true }, see: { timeline: false } });
  assert.equal(p.add.comments, false);
  assert.equal(p.see.timeline, false);
  const e = resolvePermissions('edit', { add: { meals: false } });
  assert.equal(e.add.meals, false);
  assert.equal(e.add.fitness, true);
});

test('nothing can be added into a hidden section', () => {
  const p = resolvePermissions('edit', { see: { biometrics: false, timeline: false } });
  assert.equal(p.add.biometrics, false);
  assert.equal(p.add.comments, false);
  assert.equal(p.add.pictures, false);
  assert.equal(p.add.fitness, true);
});

test('garbage in the stored value is ignored', () => {
  const p = resolvePermissions('edit', { see: { fitness: 'yes', mental: 1 }, add: 'all', extra: true });
  assert.equal(p.see.fitness, true);
  assert.equal(p.see.mental, false);
  assert.deepEqual(cleanPermissionsInput({ see: { fitness: false, nope: true }, add: { meals: 'x', videos: false } }), { see: { fitness: false }, add: { videos: false } });
  assert.equal(cleanPermissionsInput('x'), null);
});

test('tracker categories map to their permissions', () => {
  assert.equal(addKindForCategory('fitness'), 'fitness');
  assert.equal(addKindForCategory('other'), 'progress');
  assert.equal(addKindForCategory('mental'), null);
  assert.equal(seeSectionForCategory('biometrics'), 'biometrics');
});
