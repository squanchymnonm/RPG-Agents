import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBranchList, parseRemoteList, listBranches, checkout, createBranch } from './git-branches.js';

test('parseBranchList separa libres de ocupadas y marca la actual', () => {
  const out = [
    'link\t/wt/link\t*',
    'main\t\t ',
    'dante\t/wt/dante\t ',
  ].join('\n');
  assert.deepEqual(parseBranchList(out), [
    { name: 'link', worktree: '/wt/link', current: true },
    { name: 'main', worktree: '', current: false },
    { name: 'dante', worktree: '/wt/dante', current: false },
  ]);
});

test('parseRemoteList filtra el HEAD del remoto', () => {
  const out = ['origin/main', 'origin', 'origin/shepard'].join('\n');
  assert.deepEqual(parseRemoteList(out), ['origin/main', 'origin/shepard']);
});

test('listBranches junta locales, remotas, actual y default', async () => {
  const exec = async (file, args) => {
    const a = args.join(' ');
    if (a.includes('symbolic-ref')) return 'origin/main\n';
    if (a.includes('--abbrev-ref HEAD')) return 'link\n';
    if (a.includes('branch -r')) return 'origin/main\norigin\n';
    if (a.includes('branch --list')) return 'link\t/wt/link\t*\nmain\t\t \n';
    return '';
  };
  const r = await listBranches('/proj', exec);
  assert.equal(r.current, 'link');
  assert.equal(r.default, 'origin/main');
  assert.deepEqual(r.local.map((b) => b.name), ['link', 'main']);
  assert.deepEqual(r.remote, ['origin/main']);
});

test('checkout rechaza branch inválida sin invocar git', async () => {
  let called = false;
  const exec = async () => { called = true; return ''; };
  assert.equal((await checkout('/proj', '-rf', exec)).ok, false);
  assert.equal((await checkout('/proj', 'a..b', exec)).ok, false);
  assert.equal(called, false);
});

test('checkout rechaza branch tomada por otro worktree sin invocar checkout', async () => {
  const calls = [];
  const exec = async (file, args) => {
    const a = args.join(' ');
    calls.push(a);
    if (a.includes('symbolic-ref')) return 'origin/main\n';
    if (a.includes('--abbrev-ref HEAD')) return 'link\n';
    if (a.includes('branch -r')) return '';
    if (a.includes('branch --list')) return 'dante\t/wt/dante\t \n';
    return '';
  };
  const r = await checkout('/proj', 'dante', exec);
  assert.equal(r.ok, false);
  assert.ok(r.message.includes('dante')); // nombra la sesión que la tiene
  assert.equal(calls.some((c) => c.startsWith('-C /proj switch')), false);
});

test('checkout marca dirty cuando git rechaza por cambios locales', async () => {
  const exec = async (file, args) => {
    const a = args.join(' ');
    if (a.includes('symbolic-ref')) return 'origin/main\n';
    if (a.includes('--abbrev-ref HEAD')) return 'link\n';
    if (a.includes('branch -r')) return '';
    if (a.includes('branch --list')) return 'main\t\t \n';
    if (a.startsWith('-C /proj switch')) {
      const e = new Error('x');
      // stderr real de `git switch` sobre árbol sucio (verificado empíricamente):
      // conserva la palabra "checkout" pero menciona "switch branches".
      e.stderr = 'error: Your local changes to the following files would be overwritten by checkout:\n\ta.js\nPlease commit your changes or stash them before you switch branches.\nAborting';
      throw e;
    }
    return '';
  };
  const r = await checkout('/proj', 'main', exec);
  assert.equal(r.ok, false);
  assert.equal(r.dirty, true);
});

test('checkout ok invoca git switch', async () => {
  let got;
  const exec = async (file, args) => {
    const a = args.join(' ');
    if (a.includes('symbolic-ref')) return 'origin/main\n';
    if (a.includes('--abbrev-ref HEAD')) return 'link\n';
    if (a.includes('branch -r')) return '';
    if (a.includes('branch --list')) return 'main\t\t \n';
    if (a.startsWith('-C /proj switch')) { got = a; return ''; }
    return '';
  };
  const r = await checkout('/proj', 'main', exec);
  assert.equal(r.ok, true);
  assert.equal(r.branch, 'main');
  assert.equal(got, '-C /proj switch main');
});

test('createBranch desde default y desde HEAD', async () => {
  const calls = [];
  const exec = async (file, args) => {
    const a = args.join(' ');
    calls.push(a);
    if (a.includes('symbolic-ref')) return 'origin/main\n';
    return '';
  };
  assert.equal((await createBranch('/proj', 'nueva', 'default', exec)).ok, true);
  assert.ok(calls.some((c) => c === '-C /proj checkout -b nueva origin/main'));
  calls.length = 0;
  assert.equal((await createBranch('/proj', 'otra', 'HEAD', exec)).ok, true);
  assert.ok(calls.some((c) => c === '-C /proj checkout -b otra HEAD'));
});

test('createBranch rechaza nombre inválido', async () => {
  let called = false;
  const exec = async () => { called = true; return ''; };
  assert.equal((await createBranch('/proj', '--force', 'HEAD', exec)).ok, false);
  assert.equal(called, false);
});
