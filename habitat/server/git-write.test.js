import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stage, unstage, discard, commit, push, pull, mergeDefault, abort, fetchRemote, amend } from './git-write.js';

test('stage usa git add -- <paths>', async () => {
  let got;
  const exec = async (file, args) => { got = [file, ...args]; return ''; };
  const r = await stage('/proj', ['a.js', 'b.js'], exec);
  assert.equal(r.ok, true);
  assert.deepEqual(got, ['git', '-C', '/proj', 'add', '--', 'a.js', 'b.js']);
});

test('unstage usa restore --staged', async () => {
  let got;
  const exec = async (file, args) => { got = args.join(' '); return ''; };
  await unstage('/proj', ['a.js'], exec);
  assert.ok(got.includes('restore --staged -- a.js'));
});

test('discard usa restore --', async () => {
  let got;
  const exec = async (file, args) => { got = args.join(' '); return ''; };
  await discard('/proj', ['a.js'], exec);
  assert.ok(got.includes('restore -- a.js'));
});

test('rechaza paths con prefijo - y arrays vacíos (flag smuggling)', async () => {
  let called = false;
  const exec = async () => { called = true; return ''; };
  assert.equal((await stage('/proj', ['-rf'], exec)).ok, false);
  assert.equal((await stage('/proj', [], exec)).ok, false);
  assert.equal(called, false);
});

test('devuelve ok:false con stderr recortado ante fallo', async () => {
  const exec = async () => { const e = new Error('boom'); e.stderr = 'fatal: pathspec\nlinea2'; e.code = 1; throw e; };
  const r = await stage('/proj', ['a.js'], exec);
  assert.equal(r.ok, false);
  assert.ok(r.message.includes('fatal: pathspec'));
});

test('commit rechaza mensaje vacío y usa -m', async () => {
  let got;
  const exec = async (file, args) => { got = args.join(' '); return ''; };
  assert.equal((await commit('/proj', '   ', exec)).ok, false);
  await commit('/proj', 'mi mensaje', exec);
  assert.deepEqual(got, '-C /proj commit -m mi mensaje');
});

test('push deriva el branch del repo y cae a -u origin <branch> si falla', async () => {
  const calls = [];
  const exec = async (file, args) => {
    const a = args.join(' ');
    calls.push(a);
    if (a.includes('rev-parse --abbrev-ref HEAD')) return 'feature/x\n';
    if (a === '-C /proj push') { const e = new Error('no upstream'); e.stderr = 'has no upstream branch'; throw e; }
    return '';
  };
  const r = await push('/proj', exec);
  assert.equal(r.ok, true);
  assert.ok(calls.some((c) => c.includes('push -u origin feature/x')));
});

test('mergeDefault hace fetch + merge y reporta conflicto', async () => {
  const exec = async (file, args) => {
    const a = args.join(' ');
    if (a.includes('symbolic-ref')) return 'origin/main\n';
    if (a.includes('fetch')) { assert.ok(a.includes('fetch origin main')); return ''; }
    if (a.startsWith('-C /proj merge')) { const e = new Error('m'); e.stdout = 'CONFLICT (content): Merge conflict in a.js'; throw e; }
    if (a.includes('diff --name-only --diff-filter=U')) return 'a.js\0';
    return '';
  };
  const r = await mergeDefault('/proj', exec);
  assert.equal(r.ok, false);
  assert.equal(r.conflict, true);
  assert.deepEqual(r.files, ['a.js']);
});

test('pull --no-edit y abort --abort', async () => {
  let pullArgs, abortArgs;
  const exec = async (file, args) => {
    const a = args.join(' ');
    if (a.includes('pull')) pullArgs = a;
    if (a.includes('merge --abort')) abortArgs = a;
    return '';
  };
  assert.equal((await pull('/proj', exec)).ok, true);
  assert.ok(pullArgs.includes('pull --no-edit'));
  assert.equal((await abort('/proj', exec)).ok, true);
  assert.ok(abortArgs.includes('merge --abort'));
});

test('fetchRemote usa fetch --all --prune', async () => {
  let got;
  const exec = async (file, args) => { got = args.join(' '); return ''; };
  assert.equal((await fetchRemote('/proj', exec)).ok, true);
  assert.equal(got, '-C /proj fetch --all --prune');
});

test('amend con mensaje usa -m, sin mensaje usa --no-edit', async () => {
  const calls = [];
  const exec = async (file, args) => { calls.push(args.join(' ')); return ''; };
  await amend('/proj', 'nuevo mensaje', exec);
  assert.equal(calls[0], '-C /proj commit --amend -m nuevo mensaje');
  await amend('/proj', '', exec);
  assert.equal(calls[1], '-C /proj commit --amend --no-edit');
});

// --- I1: mergeDefault partía remoteDefaultBranch a ciegas ---
// remoteDefaultBranch tiene contrato dual: 'origin/main' cuando resuelve, y la rama
// actual SIN prefijo cuando no hay origin/HEAD resoluble (repo sin remoto, u offline
// cuando corre `remote set-head`). Sin el guard de prefijo, el botón "↻ Actualizar"
// era un no-op silencioso (ok:true sin traer nada) o fallaba con un error críptico.

// exec que simula un repo sin origin/HEAD resoluble, parado en `branch`.
const sinOriginHead = (branch, calls) => async (file, args) => {
  const a = args.join(' ');
  calls.push(a);
  if (a.includes('symbolic-ref')) throw new Error('fatal: ref refs/remotes/origin/HEAD is not a symbolic ref');
  if (a.includes('remote set-head')) throw new Error('fatal: could not read from remote repository');
  if (a.includes('--abbrev-ref HEAD')) return `${branch}\n`;
  return '';
};

test('mergeDefault sin origin/HEAD no mergea nada y avisa (rama sin barras: era ok:true silencioso)', async () => {
  const calls = [];
  const r = await mergeDefault('/proj', sinOriginHead('main', calls));
  assert.equal(r.ok, false);
  assert.ok(/no se pudo determinar la rama default/.test(r.message), r.message);
  assert.ok(!calls.some((c) => c.includes('merge')), 'no debe mergear contra una base inventada');
  assert.ok(!calls.some((c) => c.startsWith('-C /proj fetch')), 'no debe fetchear una base inventada');
});

test('mergeDefault sin origin/HEAD no mutila una rama con barras (era `fetch feature x`)', async () => {
  const calls = [];
  const r = await mergeDefault('/proj', sinOriginHead('feature/x', calls));
  assert.equal(r.ok, false);
  assert.ok(/no se pudo determinar la rama default/.test(r.message), r.message);
  assert.ok(!calls.some((c) => c.includes('fetch feature x')));
});

test('mergeDefault con origin/HEAD resuelto sigue fetcheando y mergeando', async () => {
  const calls = [];
  const exec = async (file, args) => {
    const a = args.join(' ');
    calls.push(a);
    if (a.includes('symbolic-ref')) return 'origin/main\n';
    return '';
  };
  const r = await mergeDefault('/proj', exec);
  assert.equal(r.ok, true);
  assert.ok(calls.some((c) => c === '-C /proj fetch origin main'));
  assert.ok(calls.some((c) => c === '-C /proj merge --no-edit origin/main'));
});

// --- I6: timeout en las operaciones de red ---
// Sin timeout, un remoto inalcanzable cuelga minutos con el lock del repo tomado y
// cualquier otra escritura sobre ese repo recibe 409 todo ese tiempo.

test('fetch, pull y push pasan timeout en los opts del exec', async () => {
  const opts = [];
  const exec = async (file, args, o) => { opts.push(o); return ''; };
  await fetchRemote('/proj', exec);
  await pull('/proj', exec);
  await push('/proj', exec);
  assert.equal(opts.length, 3);
  for (const o of opts) {
    assert.ok(o && typeof o.timeout === 'number' && o.timeout > 0, `opts sin timeout: ${JSON.stringify(o)}`);
  }
});

test('el fetch de mergeDefault pasa timeout (el merge, que es local, no lo necesita)', async () => {
  const seen = [];
  const exec = async (file, args, o) => {
    const a = args.join(' ');
    seen.push([a, o]);
    if (a.includes('symbolic-ref')) return 'origin/main\n';
    return '';
  };
  await mergeDefault('/proj', exec);
  const fetchCall = seen.find(([a]) => a === '-C /proj fetch origin main');
  assert.ok(fetchCall[1] && fetchCall[1].timeout > 0);
});

test('un exec matado por timeout devuelve un mensaje en español, no "Command failed"', async () => {
  const exec = async () => {
    const e = new Error('Command failed: git fetch --all --prune');
    e.killed = true; e.signal = 'SIGTERM'; e.stderr = '';
    throw e;
  };
  const r = await fetchRemote('/proj', exec);
  assert.equal(r.ok, false);
  assert.ok(/tardó demasiado/.test(r.message), r.message);
});

test('push no reintenta -u origin <branch> si el primer push venció por timeout', async () => {
  const calls = [];
  const exec = async (file, args) => {
    calls.push(args.join(' '));
    const e = new Error('Command failed: git push');
    e.killed = true; e.signal = 'SIGTERM';
    throw e;
  };
  const r = await push('/proj', exec);
  assert.equal(r.ok, false);
  assert.deepEqual(calls, ['-C /proj push'], 'un solo intento: no duplicar la espera con el lock tomado');
});
