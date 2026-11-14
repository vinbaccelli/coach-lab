import test from 'node:test';
import assert from 'node:assert/strict';
import { isMissingTable } from '../lib/db/missingTable';

test('isMissingTable recognises PostgREST and Postgres "no such table" errors only', () => {
  assert.equal(isMissingTable({ code: 'PGRST205', message: "Could not find the table 'public.x' in the schema cache" }), true);
  assert.equal(isMissingTable({ code: '42P01', message: 'relation "public.x" does not exist' }), true);
  assert.equal(isMissingTable({ code: 'PGRST202', message: 'Could not find the function' }), true);
  assert.equal(isMissingTable({ code: '42501', message: 'new row violates row-level security policy' }), false);
  assert.equal(isMissingTable({ code: '23505', message: 'duplicate key' }), false);
  assert.equal(isMissingTable(null), false);
});
