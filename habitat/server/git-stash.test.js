import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStashList, stashList, stashPush, stashApply, stashDrop } from './git-stash.js';

test('parseStashList extrae índice y mensaje', () => {
  const out = 'stash@{0}\x1fWIP on link: abc mensaje\nstash@{1}\x1fOn main: otro\n';
  assert.deepEqual(parseStashList(out), [
    { index: 0, message: 'WIP on link: abc mensaje' },
    { index: 1, message: 'On main: otro' },
  ]);
});

test('parseStashList tolera lista vacía', () => {
  assert.deepEqual(parseStashList(''), []);
});

test('stashList usa el formato con separador', async () => {
  let got;
  const exec = async (file, args) => { got = args.join(' '); return 'stash@{0}\x1fWIP\n'; };
  const r = await stashList('/proj', exec);
  assert.deepEqual(r, [{ index: 0, message: 'WIP' }]);
  assert.ok(got.includes('stash list'));
});

test('stashPush con y sin mensaje', async () => {
  const calls = [];
  const exec = async (file, args) => { calls.push(args.join(' ')); return ''; };
  assert.equal((await stashPush('/proj', 'wip api', exec)).ok, true);
  assert.equal(calls[0], '-C /proj stash push -m wip api');
  assert.equal((await stashPush('/proj', '', exec)).ok, true);
  assert.equal(calls[1], '-C /proj stash push');
});

test('stashApply usa pop con stash@{N}', async () => {
  let got;
  const exec = async (file, args) => { got = args.join(' '); return ''; };
  assert.equal((await stashApply('/proj', 2, exec)).ok, true);
  assert.equal(got, '-C /proj stash pop stash@{2}');
});

test('stashDrop usa drop con stash@{N}', async () => {
  let got;
  const exec = async (file, args) => { got = args.join(' '); return ''; };
  assert.equal((await stashDrop('/proj', 0, exec)).ok, true);
  assert.equal(got, '-C /proj stash drop stash@{0}');
});

test('índices no enteros o negativos se rechazan sin invocar git', async () => {
  let called = false;
  const exec = async () => { called = true; return ''; };
  assert.equal((await stashApply('/proj', -1, exec)).ok, false);
  assert.equal((await stashApply('/proj', 1.5, exec)).ok, false);
  assert.equal((await stashDrop('/proj', 'x', exec)).ok, false);
  assert.equal(called, false);
});
