import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prCreate } from './gh.js';

const gitStub = (a) => {
  if (a.includes('symbolic-ref')) return 'origin/main\n';
  if (a.includes('--abbrev-ref HEAD')) return 'feature/x\n';
  return null;
};

test('prCreate llama gh con --base y --head y devuelve la url', async () => {
  let ghArgs;
  const exec = async (file, args) => {
    const a = args.join(' ');
    const g = gitStub(a);
    if (g !== null) return g;
    if (file === 'gh') { ghArgs = args; return 'https://github.com/o/r/pull/7\n'; }
    return '';
  };
  const r = await prCreate('/proj', exec);
  assert.equal(r.ok, true);
  assert.equal(r.url, 'https://github.com/o/r/pull/7');
  assert.deepEqual(ghArgs, [
    'pr', 'create', '--base', 'main', '--head', 'feature/x', '--fill',
  ]);
});

test('prCreate avisa si gh no está instalado', async () => {
  const exec = async (file, args) => {
    const g = gitStub(args.join(' '));
    if (g !== null) return g;
    const e = new Error('spawn gh ENOENT'); e.code = 'ENOENT'; throw e;
  };
  const r = await prCreate('/proj', exec);
  assert.equal(r.ok, false);
  assert.ok(/no está instalado/.test(r.message));
});

test('prCreate avisa si gh no está autenticado', async () => {
  const exec = async (file, args) => {
    const g = gitStub(args.join(' '));
    if (g !== null) return g;
    const e = new Error('x'); e.code = 4;
    e.stderr = 'gh: To get started with GitHub CLI, please run: gh auth login';
    throw e;
  };
  const r = await prCreate('/proj', exec);
  assert.equal(r.ok, false);
  assert.ok(/gh auth login/.test(r.message));
});

test('prCreate devuelve la url si el PR ya existe', async () => {
  const exec = async (file, args) => {
    const g = gitStub(args.join(' '));
    if (g !== null) return g;
    const e = new Error('x'); e.code = 1;
    e.stderr = 'a pull request for branch "feature/x" already exists:\nhttps://github.com/o/r/pull/3';
    throw e;
  };
  const r = await prCreate('/proj', exec);
  assert.equal(r.ok, false);
  assert.equal(r.url, 'https://github.com/o/r/pull/3');
  assert.ok(/ya existe/.test(r.message));
});

test('prCreate rechaza branch actual inválida sin llamar gh', async () => {
  let ghCalled = false;
  const exec = async (file, args) => {
    const a = args.join(' ');
    if (a.includes('symbolic-ref')) return 'origin/main\n';
    if (a.includes('--abbrev-ref HEAD')) return 'HEAD\n'; // detached
    if (file === 'gh') { ghCalled = true; return ''; }
    return '';
  };
  const r = await prCreate('/proj', exec);
  assert.equal(r.ok, false);
  assert.equal(ghCalled, false);
});
