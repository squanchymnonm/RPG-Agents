# GUI de git en la vista de proyecto — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gestionar git desde la vista de proyecto de Hábitat, scopeado al repo que contiene la carpeta donde estás parado, con branches / stash / fetch / amend / historial / PR y las acciones frecuentes siempre visibles.

**Architecture:** Un helper único (`resolveRepo`) traduce `(cwd de la sesión, path relativo)` al repo efectivo, y todos los endpoints git pasan por ahí en vez de usar `s.cwd` clavado. En el cliente, `ProjectExplorer` se vuelve el shell con pestañas `Archivos | Git`, es dueño del `path` actual y lo pasa como prop a un `GitPanel` que re-fetchea cuando cambia. Se elimina el gate `HABITAT_ALLOW_GIT_WRITE`.

**Tech Stack:** Node 20+ ESM sin frameworks (`node:http`, `execFile`), tests con `node --test` y `exec` inyectado. Cliente Vue 3 + `<script setup>` + TypeScript, Pinia, tests con Vitest.

## Global Constraints

- **Todo el server es ESM** (`"type": "module"`). Imports con extensión `.js` explícita.
- **Sin dependencias nuevas** ni en server ni en cliente.
- **Todo comando git va por `execFile`** (nunca `exec`/shell) con args en array. Jamás interpolar input del usuario en un string de comando.
- **Toda función que invoca git recibe `exec` como último parámetro con default `defaultExec`.** Es el mecanismo de test de todo el repo: `const exec = async (file, args) => {...}`.
- **Anti flag-smuggling:** rechazar todo argumento posicional que empiece con `-`. Validar nombres de branch con `validBranch` (ya existe en `git.js:12`).
- **Los helpers de parseo se exportan puros** (sin tocar disco ni git), patrón de `parsePorcelain` / `parseNameStatus` en `git-read.js`.
- **Comentarios y mensajes de UI en español**, como todo el código existente.
- **Mensajes de commit:** `feat(habitat):` / `fix(habitat):` / `refactor(habitat):` / `test(habitat):`.
- **Validación:** 5 módulos del server fallan por `pngjs`/`ws` faltantes, previo y ajeno a este trabajo. Correr `node --test` **sobre los archivos tocados**, nunca la suite entera, y reportar sólo eso.
- Server: `cd habitat && node --test server/<archivo>.test.js`. Cliente: `cd habitat/client && npx vitest run <archivo>`.

---

# Fase 1 — Scope por path y baja del gate

Al terminar esta fase el problema original está resuelto: el botón de actualizar aparece y funciona por sub-repo. Sin UI nueva todavía.

### Task 1: `resolveRepo` en `git.js`

Traduce `(cwd, rel)` al repo git que contiene ese path. Es el único punto de verdad del scope.

**Files:**
- Modify: `habitat/server/git.js` (agregar al final, antes de `ensureContainerRepo`)
- Test: `habitat/server/git.test.js` (agregar tests al final)

**Interfaces:**
- Consumes: `resolveWithinRoot(root, rel)` de `files.js:13` (devuelve path absoluto o `null` si escapa).
- Produces: **`defaultExec` pasa a exportarse desde `git.js`.** Hoy está declarado en `git.js:10` pero no exportado, y `git-branches.js` / `git-stash.js` / `gh.js` (Tasks 10, 13, 17) lo importan de ahí. Agregarlo al `export { }` del final del archivo.
- Produces: `resolveRepo(cwd, rel, deps = {}, exec = defaultExec)` → `Promise<{ dir, rel, name } | null>`.
  - `dir`: path absoluto del toplevel del repo (para los comandos git).
  - `rel`: path del repo relativo a `cwd` (`''` si el repo *es* `cwd`).
  - `name`: `basename(dir)`.
  - `null` si el path escapa, no existe, o no hay repo git.
  - `deps.realpath` inyectable para test (default `fs/promises.realpath`).

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al final de `habitat/server/git.test.js`. Notar que los imports de ese archivo están arriba: agregar `resolveRepo` a la lista importada de `./git.js`.

```js
test('resolveRepo devuelve el repo del subdirectorio', async () => {
  const exec = async (file, args) => {
    assert.deepEqual(args, ['-C', '/wt/link/back/src', 'rev-parse', '--show-toplevel']);
    return '/wt/link/back\n';
  };
  const realpath = async (p) => p;
  const r = await resolveRepo('/wt/link', 'back/src', { realpath }, exec);
  assert.deepEqual(r, { dir: '/wt/link/back', rel: 'back', name: 'back' });
});

test('resolveRepo con rel vacío devuelve el propio cwd', async () => {
  const exec = async () => '/wt/link\n';
  const realpath = async (p) => p;
  const r = await resolveRepo('/wt/link', '', { realpath }, exec);
  assert.deepEqual(r, { dir: '/wt/link', rel: '', name: 'link' });
});

test('resolveRepo rechaza path que escapa del cwd', async () => {
  let called = false;
  const exec = async () => { called = true; return ''; };
  const r = await resolveRepo('/wt/link', '../otro', {}, exec);
  assert.equal(r, null);
  assert.equal(called, false); // ni siquiera invoca git
});

test('resolveRepo rechaza toplevel fuera del cwd (symlink)', async () => {
  // El path resuelve sintácticamente dentro, pero el repo real vive afuera.
  const exec = async () => '/otro/repo\n';
  const realpath = async (p) => (p === '/wt/link/enlace' ? '/otro/repo' : p);
  const r = await resolveRepo('/wt/link', 'enlace', { realpath }, exec);
  assert.equal(r, null);
});

test('resolveRepo devuelve null si no hay repo git', async () => {
  const exec = async () => { throw new Error('not a git repository'); };
  const realpath = async (p) => p;
  const r = await resolveRepo('/tmp/vacio', '', { realpath }, exec);
  assert.equal(r, null);
});

test('resolveRepo devuelve null si realpath falla (path inexistente)', async () => {
  const exec = async () => '/wt/link\n';
  const realpath = async () => { throw new Error('ENOENT'); };
  const r = await resolveRepo('/wt/link', 'no-existe', { realpath }, exec);
  assert.equal(r, null);
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd habitat && node --test server/git.test.js`
Expected: FAIL — `resolveRepo is not defined` / no exportado.

- [ ] **Step 3: Implementar**

En `habitat/server/git.js`, agregar el import de `resolveWithinRoot` arriba y `basename`/`relative` a los de `node:path`:

```js
import { join, basename, relative } from 'node:path';
import { realpath as fsRealpath } from 'node:fs/promises';
import { resolveWithinRoot } from './files.js';
```

Y la función:

```js
// Traduce (cwd de la sesión, path relativo) al repo git que contiene ese path.
// Único punto de verdad del scope de repo: lo usan todos los endpoints git.
// Dos guards en capas: resolveWithinRoot es sintáctico (path traversal), y la
// comparación de realpaths cubre symlinks que apunten a un repo de afuera
// (--show-toplevel no garantiza forma canónica, así que se realpathean ambos).
export async function resolveRepo(cwd, rel, deps = {}, exec = defaultExec) {
  const realpath = deps.realpath || fsRealpath;
  const target = resolveWithinRoot(cwd, rel);
  if (!target) return null;
  let top;
  try {
    top = String(await exec('git', ['-C', target, 'rev-parse', '--show-toplevel'])).trim();
  } catch {
    return null; // no es repo git (o el path no existe)
  }
  if (!top) return null;
  let realTop, realRoot;
  try { realTop = await realpath(top); realRoot = await realpath(cwd); }
  catch { return null; }
  if (realTop !== realRoot && !realTop.startsWith(realRoot + sep)) return null;
  return { dir: top, rel: relative(realRoot, realTop), name: basename(top) };
}
```

Agregar `sep` al import de `node:path`, y `defaultExec` a los exports del final del archivo (lo necesitan las Tasks 10, 13 y 17):

```js
export { defaultExec };
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `cd habitat && node --test server/git.test.js`
Expected: PASS (los tests previos del archivo siguen pasando).

- [ ] **Step 5: Commit**

```bash
git add habitat/server/git.js habitat/server/git.test.js
git commit -m "feat(habitat): resolveRepo, scope de repo por path"
```

---

### Task 2: Baja del gate y `path` en los endpoints git existentes

**Files:**
- Modify: `habitat/server/index.js` — endpoints `/git/status` (~309-333), `/git/diff` (~335-347), `/git/action` (~349-377)
- Modify: `habitat/server/git-write.js:44-48` (`push` deriva el branch del repo)
- Test: `habitat/server/index.test.js` (reemplazar el test del 403, agregar los nuevos)
- Test: `habitat/server/git-write.test.js` (test de `push`)

**Interfaces:**
- Consumes: `resolveRepo(cwd, rel, deps, exec)` de Task 1.
- Produces:
  - Helper local en `index.js`: `resolveRepoOr(res, s, url)` → `{dir, rel, name}` o `null` (ya habiendo escrito la respuesta de error). Distingue tres casos: **409** sin sesión/cwd, **400** si el path escapa del worktree, **409** si no hay repo git ahí. Los dos 409 son distintos del 400 a propósito: `useGit` traduce 409 a `error = 'sin-dir'`, que es lo que `GitPanel` muestra como "sin repo git acá".
  - `/git/status` devuelve además `repo: { rel, name }` y **ya no** devuelve `canWrite`.
  - `push(cwd, exec)` — **cambia de firma**: ya no recibe branch, lo deriva con `currentBranch(cwd, exec)`.

- [ ] **Step 1: Escribir los tests que fallan**

En `habitat/server/git-write.test.js`, **reemplazar** el test `'push intenta git push y cae a -u origin <branch> si falla'` por:

```js
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
```

En `habitat/server/index.test.js`, **reemplazar** el test `'POST /git/action con gate off -> 403'` por uno que verifique que el gate ya no existe. Necesita un repo git real, y el archivo ya importa `mkdtempSync` / `tmpdir` / `join`:

```js
import { execFileSync } from 'node:child_process';

// Repo git temporal con un commit inicial. Identidad explícita para no depender
// de la config global de git en la máquina que corre los tests.
function tmpRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'habitat-git-'));
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });
  git('init', '-b', 'main');
  git('config', 'user.email', 'test@local');
  git('config', 'user.name', 'test');
  writeFileSync(join(dir, 'a.js'), 'const a = 1\n');
  git('add', '-A');
  git('commit', '-m', 'inicial');
  return { dir, git };
}

test('POST /git/action ya no está detrás de un gate (stage funciona)', async () => {
  const { dir } = tmpRepo();
  const store = createStore();
  store.upsert({ id: 's1', cwd: dir, name: 'proj', status: 'working' });
  const { server } = createApp({ config, store }); // config sin ALLOW_GIT_WRITE
  const port = await listen(server);
  writeFileSync(join(dir, 'b.js'), 'const b = 2\n');
  const res = await fetch(`http://127.0.0.1:${port}/git/action?id=s1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer secret' },
    body: JSON.stringify({ action: 'stage', paths: ['b.js'] }),
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

test('GET /git/status con path scopea al sub-repo y devuelve repo', async () => {
  const { dir, git } = tmpRepo();
  // sub-repo anidado en back/
  const back = join(dir, 'back');
  mkdirSync(back);
  const sub = (...args) => execFileSync('git', ['-C', back, ...args], { stdio: 'pipe' });
  sub('init', '-b', 'main');
  sub('config', 'user.email', 'test@local');
  sub('config', 'user.name', 'test');
  writeFileSync(join(back, 'x.js'), 'x\n');
  sub('add', '-A');
  sub('commit', '-m', 'inicial back');
  git('add', '-A'); // el padre ignora back/ o lo trackea, da igual acá

  const store = createStore();
  store.upsert({ id: 's1', cwd: dir, name: 'proj', status: 'working' });
  const { server } = createApp({ config, store });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/git/status?id=s1&path=back`, {
    headers: { authorization: 'Bearer secret' },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.repo.name, 'back');
  assert.equal(body.repo.rel, 'back');
  assert.equal(body.canWrite, undefined); // el gate se fue del payload
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

test('GET /git/status con path que escapa -> 400', async () => {
  const { dir } = tmpRepo();
  const store = createStore();
  store.upsert({ id: 's1', cwd: dir, name: 'proj', status: 'working' });
  const { server } = createApp({ config, store });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/git/status?id=s1&path=../fuera`, {
    headers: { authorization: 'Bearer secret' },
  });
  assert.equal(res.status, 400);
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

test('GET /git/status en un cwd sin repo git -> 409', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'habitat-norepo-'));
  const store = createStore();
  store.upsert({ id: 's1', cwd: dir, name: 'proj', status: 'working' });
  const { server } = createApp({ config, store });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/git/status?id=s1`, {
    headers: { authorization: 'Bearer secret' },
  });
  assert.equal(res.status, 409); // el cliente lo muestra como "sin repo git acá"
  server.close();
  rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd habitat && node --test server/git-write.test.js server/index.test.js`
Expected: FAIL — `push` con la firma vieja, `/git/action` devolviendo 403, `body.repo` undefined.

- [ ] **Step 3: Implementar**

En `habitat/server/git-write.js`, cambiar `push` (importar `currentBranch` desde `./git.js`, ya está en el `export {}` de la línea 85):

```js
export async function push(cwd, exec = defaultExec) {
  const first = await gitOk(cwd, ['push'], exec);
  if (first.ok) return first;
  // Sin upstream: reintentar con -u origin <branch>. El branch se deriva del repo
  // real, no del cacheado en la sesión: tras un checkout o en un sub-repo el de la
  // sesión es el equivocado.
  const branch = await currentBranch(cwd, exec);
  if (!validBranch(branch)) return first;
  return gitOk(cwd, ['push', '-u', 'origin', branch], exec);
}
```

Agregar `currentBranch` al import de la línea 3.

En `habitat/server/index.js`:

1. Importar `resolveRepo` en la línea 15 (junto a `worktreeAdd`, etc.).

2. Agregar el helper después de `authorize` (~línea 73):

```js
  // Resuelve el repo scopeado por ?path=. Escribe la respuesta de error y devuelve
  // null si no se puede. 400 = el path escapa del worktree (input inválido);
  // 409 = no hay sesión/cwd, o ahí no hay repo git (estado, no input). El cliente
  // muestra el 409 como "sin repo git acá".
  async function resolveRepoOr(res, s, url) {
    if (!s || !s.cwd) { res.writeHead(409).end(); return null; }
    const rel = (url.searchParams.get('path') || '').replace(/^\/+/, '');
    if (resolveWithinRoot(s.cwd, rel) === null) { res.writeHead(400).end(); return null; }
    const repo = await resolveRepo(s.cwd, rel);
    if (!repo) { res.writeHead(409).end(); return null; }
    return repo;
  }
```

3. `/git/status`: reemplazar el uso de `s.cwd` por el repo resuelto, y el payload:

```js
      const s = store.get(url.searchParams.get('id') || '');
      const repo = await resolveRepoOr(res, s, url);
      if (!repo) return;
      try {
        const [working, overview, log] = await Promise.all([
          workingStatus(repo.dir), branchOverview(repo.dir), commits(repo.dir),
        ]);
        res.writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ working, overview, commits: log, repo: { rel: repo.rel, name: repo.name } }));
      } catch { res.writeHead(500).end(); }
```

(Mantener la forma exacta en que el código actual invoca `workingStatus`/`branchOverview`/`commits` — leer las líneas 309-331 y sustituir sólo `s.cwd` → `repo.dir` y el objeto de respuesta.)

4. `/git/diff`: igual — `resolveRepoOr`, y el guard de `file` pasa a `resolveWithinRoot(repo.dir, file)`, y `filePatch(repo.dir, file, base)`.

5. `/git/action`: **borrar** el bloque `if (!config.ALLOW_GIT_WRITE) { res.writeHead(403).end(); return; }`, usar `resolveRepoOr`, validar `paths` contra `repo.dir`, y pasar `repo.dir` a todas las acciones. `push` pierde el segundo argumento:

```js
        case 'push': r = await gitWrite.push(repo.dir); break;
```

6. En `habitat/server/config.js`, **borrar** la línea `ALLOW_GIT_WRITE: bool(process.env.HABITAT_ALLOW_GIT_WRITE),` y en `habitat/server/config.test.js` borrar el test `'ALLOW_GIT_WRITE: off por default, on con HABITAT_ALLOW_GIT_WRITE=1'` (líneas ~47-54).

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `cd habitat && node --test server/git-write.test.js server/index.test.js server/config.test.js server/git.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add habitat/server/index.js habitat/server/git-write.js habitat/server/config.js \
  habitat/server/index.test.js habitat/server/git-write.test.js habitat/server/config.test.js
git commit -m "feat(habitat): endpoints git scopeados por path, sin gate ALLOW_GIT_WRITE"
```

---

### Task 3: `isRepo` en `/tree`

Para que el explorer pueda dibujar el badge `git` en las carpetas que son repos.

**Files:**
- Modify: `habitat/server/index.js` — endpoint `/tree`, loop de entries (~282-289)
- Test: `habitat/server/index.test.js`

**Interfaces:**
- Produces: cada entry de `/tree` suma `isRepo: boolean`. `true` sólo para directorios que contienen una entrada `.git`, y nunca para el directorio `.git` mismo.

- [ ] **Step 1: Escribir el test que falla**

```js
test('GET /tree marca isRepo en carpetas que son repos, no en .git', async () => {
  const { dir } = tmpRepo();
  mkdirSync(join(dir, 'back'));
  mkdirSync(join(dir, 'back', '.git'));
  mkdirSync(join(dir, 'docs'));
  const store = createStore();
  store.upsert({ id: 's1', cwd: dir, name: 'proj', status: 'working' });
  const { server } = createApp({ config, store });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/tree?id=s1`, {
    headers: { authorization: 'Bearer secret' },
  });
  const body = await res.json();
  const byName = Object.fromEntries(body.entries.map((e) => [e.name, e]));
  assert.equal(byName.back.isRepo, true);
  assert.equal(byName.docs.isRepo, false);
  assert.equal(byName['.git'].isRepo, false); // el .git del repo raíz no se marca
  server.close();
  rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd habitat && node --test server/index.test.js`
Expected: FAIL — `byName.back.isRepo` es `undefined`.

- [ ] **Step 3: Implementar**

En el loop de entries de `/tree` (~283-289):

```js
      for (const d of dirents) {
        // Sin filtro: mostramos TODO (incluidos dotfiles y .git/).
        const abs = join(realTarget, d.name);
        let size = 0;
        if (!d.isDirectory()) { try { size = (await stat(abs)).size; } catch { size = 0; } }
        // isRepo: subcarpeta que es repo git. El propio '.git' no cuenta.
        let isRepo = false;
        if (d.isDirectory() && d.name !== '.git') {
          try { await stat(join(abs, '.git')); isRepo = true; } catch { /* no es repo */ }
        }
        entries.push({ name: d.name, rel: relative(realRoot, abs), isDir: d.isDirectory(), size, isRepo });
      }
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `cd habitat && node --test server/index.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add habitat/server/index.js habitat/server/index.test.js
git commit -m "feat(habitat): /tree marca las carpetas que son repos git"
```

---

### Task 4: Cliente — `useGit.ts` con `path`, sin `canWrite`

**Crítico:** hoy los botones se esconden con `canWrite()`. Si el payload deja de traer `canWrite` y el cliente no se toca, los botones quedan escondidos para siempre. Esta task es la que los hace aparecer.

**Files:**
- Create: `habitat/client/src/composables/useGit.ts` (renombrado de `useGitChanges.ts`)
- Delete: `habitat/client/src/composables/useGitChanges.ts`
- Modify: `habitat/client/src/components/ChangesPanel.vue`
- Modify: `habitat/client/src/composables/useProjectTree.ts` (agregar `isRepo` a `TreeEntry`)

**Interfaces:**
- Produces: `useGit()` → `{ status, loading, error, loadStatus, loadDiff, action }`
  - `loadStatus(id: string, path?: string): Promise<void>`
  - `loadDiff(id: string, file: string, base: DiffBase, path?: string): Promise<{binary, patch}>`
  - `action(id: string, actionName: string, payload?: { path?: string; paths?: string[]; message?: string }): Promise<GitActionResult>`
  - `GitStatus` pierde `canWrite` y gana `repo: { rel: string; name: string }`.
- Consumes: los endpoints de Task 2.

- [ ] **Step 1: Escribir el test que falla**

Create `habitat/client/src/composables/useGit.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { useGit } from './useGit'

afterEach(() => { vi.unstubAllGlobals() })

describe('useGit', () => {
  it('loadStatus manda el path y expone repo', async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      urls.push(u)
      return {
        ok: true, status: 200,
        json: async () => ({
          working: { staged: [], unstaged: [], untracked: [], conflicted: [] },
          overview: { branch: 'link', default: 'origin/main', ahead: 0, behind: 0, files: [] },
          commits: [], repo: { rel: 'back', name: 'back' },
        }),
      }
    }))
    const { status, loadStatus } = useGit()
    await loadStatus('s1', 'back/src')
    expect(urls[0]).toContain('path=back%2Fsrc')
    expect(status.value?.repo.name).toBe('back')
  })

  it('action manda el path en la query, no en el body', async () => {
    let calledUrl = ''
    let body: any = null
    vi.stubGlobal('fetch', vi.fn(async (u: string, init: any) => {
      calledUrl = u
      body = JSON.parse(init.body)
      return { ok: true, status: 200, json: async () => ({ ok: true }) }
    }))
    const { action } = useGit()
    const r = await action('s1', 'merge-default', { path: 'back' })
    expect(r.ok).toBe(true)
    expect(calledUrl).toContain('path=back')
    expect(body).toEqual({ action: 'merge-default' })
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd habitat/client && npx vitest run src/composables/useGit.test.ts`
Expected: FAIL — no existe `./useGit`.

- [ ] **Step 3: Implementar**

`git mv habitat/client/src/composables/useGitChanges.ts habitat/client/src/composables/useGit.ts`, y en el archivo nuevo:

- Renombrar `useGitChanges` → `useGit`.
- `GitStatus`: sacar `canWrite: boolean`, agregar `repo: { rel: string; name: string }`.
- Agregar un helper de query para no repetir el armado:

```ts
const q = (id: string, path?: string, extra: Record<string, string> = {}) => {
  const p = new URLSearchParams({ id, ...extra })
  if (path) p.set('path', path)
  return p.toString()
}
```

- `loadStatus(id, path?)` → `fetch(`/git/status?${q(id, path)}`, ...)`.
- `loadDiff(id, file, base, path?)` → `fetch(`/git/diff?${q(id, path, { file, base })}`, ...)`.
- `action(id, actionName, payload = {})`: extraer `path` del payload y mandarlo por query; el resto va en el body.

```ts
  async function action(
    id: string,
    actionName: string,
    payload: { path?: string; paths?: string[]; message?: string } = {},
  ): Promise<GitActionResult> {
    const { path, ...rest } = payload
    const res = await fetch(`/git/action?${q(id, path)}`, {
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ action: actionName, ...rest }),
    })
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}` }
    return (await res.json()) as GitActionResult
  }
```

Borrar la rama `if (res.status === 403)`: ya no hay gate.

En `ChangesPanel.vue`: cambiar el import a `useGit`, y **borrar la función `canWrite()`** (línea 53) junto con todos los `v-if="canWrite()"` del template (líneas 89, 95, 102, 113, 114, 120, 125, 140) — las acciones ahora están siempre disponibles.

En `useProjectTree.ts`, agregar `isRepo: boolean` a `TreeEntry`.

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `cd habitat/client && npx vitest run src/composables/useGit.test.ts && npx vue-tsc --noEmit`
Expected: PASS y typecheck limpio.

- [ ] **Step 5: Commit**

```bash
git add habitat/client/src
git commit -m "feat(habitat): useGit con scope por path, sin canWrite"
```

---

### Task 5: Verificación manual de la Fase 1

**Files:** ninguno (verificación).

- [ ] **Step 1: Buildear el cliente**

Run: `cd habitat/client && npm run build`
Expected: build sin errores.

- [ ] **Step 2: Reiniciar el server y probar en el navegador**

```bash
systemctl --user restart habitat
```

Abrir Hábitat, elegir una sesión, `⌥ Cambios` → pestaña **Rama**. Verificar que ahora **sí aparecen** los botones Push / Pull / Merge default (antes escondidos por el gate). Tocar **Merge default** y confirmar que trae el default a la branch.

- [ ] **Step 3: Commit del estado verificado (si hubo ajustes)**

```bash
git commit -am "fix(habitat): ajustes de la verificación manual de fase 1" || echo "sin cambios"
```

---

# Fase 2 — Split de componentes y pestañas `Archivos | Git`

Refactor sin features nuevas. Al terminar, la vista de proyecto tiene las dos pestañas y la barra de acciones fija.

### Task 6: Extraer `GitDiff.vue`

**Files:**
- Create: `habitat/client/src/components/GitDiff.vue`
- Modify: `habitat/client/src/components/ChangesPanel.vue`

**Interfaces:**
- Produces: `GitDiff` con props `{ file: string; hunks: DiffHunk[]; binary: boolean }` y emit `close`.

- [ ] **Step 1: Crear el componente**

Mover el bloque `<!-- VISOR DIFF -->` de `ChangesPanel.vue` (líneas 166-183) y sus estilos (`.ch-diff`, `.ch-diff-box`, `.diff-scroll`, `.diff-table` y variantes, líneas 217-227) a `GitDiff.vue`, renombrando las clases con prefijo `gd-`:

```vue
<script setup lang="ts">
import type { DiffHunk } from '../composables/parseDiff'

defineProps<{ file: string; hunks: DiffHunk[]; binary: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()
</script>

<template>
  <div class="gd-overlay" @click.self="emit('close')">
    <div class="gd-box">
      <header><b>{{ file }}</b><button class="gd-x" @click="emit('close')">✕</button></header>
      <p v-if="binary" class="gd-muted">archivo binario</p>
      <div v-else class="gd-scroll">
        <table v-for="(h, i) in hunks" :key="i" class="gd-table">
          <tbody>
            <tr v-for="(l, j) in h.lines" :key="j" :class="l.type">
              <td class="ln">{{ l.oldNo ?? '' }}</td>
              <td class="ln">{{ l.newNo ?? '' }}</td>
              <td class="code">{{ l.text }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
```

Los estilos se copian de `ChangesPanel.vue:217-227` cambiando el prefijo `.ch-diff` → `.gd-overlay` / `.gd-box`, `.diff-scroll` → `.gd-scroll`, `.diff-table` → `.gd-table`, y agregando `.gd-x` / `.gd-muted` copiados de `.ch-x` / `.ch-muted`.

- [ ] **Step 2: Usarlo en `ChangesPanel.vue`**

Importar `GitDiff` y reemplazar el bloque del visor por:

```vue
      <GitDiff v-if="diff" :file="diff.file" :hunks="diff.hunks" :binary="diff.binary" @close="diff = null" />
```

Borrar los estilos que se movieron.

- [ ] **Step 3: Verificar**

Run: `cd habitat/client && npx vue-tsc --noEmit && npm run build`
Expected: sin errores. Abrir un diff en el navegador y confirmar que se ve igual.

- [ ] **Step 4: Commit**

```bash
git add habitat/client/src/components
git commit -m "refactor(habitat): extraer GitDiff de ChangesPanel"
```

---

### Task 7: Extraer `ProjectFiles.vue` de `ProjectExplorer.vue`

**Files:**
- Create: `habitat/client/src/components/ProjectFiles.vue`
- Modify: `habitat/client/src/components/ProjectExplorer.vue`

**Interfaces:**
- Produces: `ProjectFiles` con props `{ id: string; path: string }`, emits `navigate(rel: string)` y `opened`.
  - No es dueño del `path`: cuando el usuario abre una carpeta emite `navigate`, y el padre decide.
  - Sigue siendo dueño de su propio `preview` y del estado de nvim.

- [ ] **Step 1: Crear `ProjectFiles.vue`**

Mover de `ProjectExplorer.vue`: el body (`<ul class="pe-list">` + `<div class="pe-preview">`, líneas 55-77) y la lógica de `preview` / `showPreview` / `editInNvim` / `openEntry` (líneas 8-30). Los estilos `.pe-list`, `.pe-preview`, `.pe-code`, `.pe-edit`, `.pe-muted`, `.pe-empty` y el `@media` se mueven también.

```vue
<script setup lang="ts">
import { ref, watch } from 'vue'
import { useProjectTree, type TreeEntry, type FileContent } from '../composables/useProjectTree'

const props = defineProps<{ id: string; path: string }>()
const emit = defineEmits<{ (e: 'navigate', rel: string): void; (e: 'opened'): void }>()

const { listing, loading, error, loadTree, loadFile, openInNvim } = useProjectTree()
const preview = ref<{ path: string; content: FileContent } | null>(null)
const busy = ref('')
const actionErr = ref('')

watch(
  () => [props.id, props.path] as const,
  ([id, path]) => { if (id) { preview.value = null; loadTree(id, path) } },
  { immediate: true },
)

function openEntry(e: TreeEntry) {
  if (e.isDir) emit('navigate', e.rel)
  else showPreview(e.rel)
}
async function showPreview(rel: string) {
  actionErr.value = ''
  try { preview.value = { path: rel, content: await loadFile(props.id, rel) } }
  catch { actionErr.value = 'no se pudo leer el archivo' }
}
async function editInNvim(rel: string) {
  busy.value = rel; actionErr.value = ''
  const r = await openInNvim(props.id, rel)
  busy.value = ''
  if (r.ok) emit('opened')
  else actionErr.value = r.message || 'no se pudo abrir nvim'
}

defineExpose({ listing })
</script>
```

El template es el de las líneas 53-77 de `ProjectExplorer.vue` (incluyendo el `<p v-if="actionErr">`), con el badge de repo agregado en el `<li>`:

```vue
        <li v-for="e in listing?.entries || []" :key="e.rel"
            @click="openEntry(e)" @dblclick="!e.isDir && editInNvim(e.rel)">
          <span class="ico">{{ e.isDir ? '📁' : '📄' }}</span>
          <span class="nm">{{ e.name }}</span>
          <span v-if="e.isRepo" class="badge-git">git</span>
        </li>
```

Con el estilo:

```css
.badge-git { font-size: .7rem; padding: 0 .3rem; border-radius: var(--radius-sm, 4px); background: var(--color-raise, #2a2018); color: var(--color-brass, #c79a4b); border: 1px solid var(--color-line, #3a2e22); }
```

- [ ] **Step 2: Dejar `ProjectExplorer.vue` como shell**

Pasa a ser dueño del `path` y de los breadcrumbs. Todavía sin pestañas (eso es Task 9):

```vue
<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import ProjectFiles from './ProjectFiles.vue'

const props = defineProps<{ id: string }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'opened'): void }>()

const path = ref('')
const files = ref<InstanceType<typeof ProjectFiles> | null>(null)

function onKey(e: KeyboardEvent) { if (e.key === 'Escape') emit('close') }
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>
```

Los breadcrumbs necesitan el `listing`, que ahora vive en `ProjectFiles`. Para no duplicar el fetch, `ProjectFiles` lo expone con `defineExpose({ listing })` y el shell lo lee vía `ref`:

```vue
      <nav class="pe-crumbs">
        <button class="pe-crumb" @click="path = ''">{{ files?.listing?.root || '~' }}</button>
        <template v-for="c in files?.listing?.breadcrumbs || []" :key="c.rel">
          <span class="pe-sep">/</span>
          <button class="pe-crumb" @click="path = c.rel">{{ c.name }}</button>
        </template>
      </nav>
```

Y el body:

```vue
      <ProjectFiles ref="files" :id="props.id" :path="path"
        @navigate="(rel) => (path = rel)" @opened="emit('opened')" />
```

Nota: el `Escape` que antes cerraba el preview ahora sólo cierra el explorer. El preview se cierra eligiendo otro archivo o cerrando la vista — aceptable; si molesta, se puede volver a agregar con un `defineExpose` del preview.

- [ ] **Step 3: Verificar**

Run: `cd habitat/client && npx vue-tsc --noEmit && npm run build`
Expected: sin errores. En el navegador: `🗂 Proyecto` navega igual que antes, y las carpetas que son repos muestran el badge `git`.

- [ ] **Step 4: Commit**

```bash
git add habitat/client/src/components
git commit -m "refactor(habitat): extraer ProjectFiles, ProjectExplorer dueño del path"
```

---

### Task 8: `ChangesPanel` → `GitPanel` + `GitWork` + `GitBranchDiff` + `GitCommits`

**Files:**
- Create: `habitat/client/src/components/GitPanel.vue`
- Create: `habitat/client/src/components/GitWork.vue`
- Create: `habitat/client/src/components/GitBranchDiff.vue`
- Create: `habitat/client/src/components/GitCommits.vue`
- Create: `habitat/client/src/styles/git.css`
- Delete: `habitat/client/src/components/ChangesPanel.vue`

**Interfaces:**
- Produces:
  - `GitPanel` props `{ id: string; path: string }`. Dueño de `status`, `busy`, `actionErr`, `diff`, y de la sub-pestaña activa. Expone `defineExpose({ repoLabel })` donde `repoLabel = { name, branch, ahead, behind }` para el chip del shell.
  - `GitWork` props `{ status: GitStatus }`, emits `run(name, payload?, confirmMsg?)` y `diff(file, base)`.
  - `GitBranchDiff` props `{ status: GitStatus }`, emit `diff(file, base)`.
  - `GitCommits` props `{ status: GitStatus }`, emit `diff(file, base)`.
- Consumes: `useGit()` de Task 4, `GitDiff` de Task 6.

Los tres hijos son **presentacionales**: no llaman a la API, emiten `run` y el `GitPanel` ejecuta. Eso mantiene toda la lógica de red y de `busy` en un solo lugar.

- [ ] **Step 1: Crear `habitat/client/src/styles/git.css`**

Los cuatro componentes comparten los estilos de lista de archivos. Para no duplicarlos, van a un CSS importado (no `scoped`), con las clases de `ChangesPanel.vue:198-216` renombradas con prefijo `g-`:

```css
.g-group { margin-bottom: .9rem; }
.g-group h4 { margin: .3rem 0; font-size: .85rem; display: flex; align-items: center; gap: .5rem; }
.g-group ul { list-style: none; margin: 0; padding: 0; }
.g-group li { display: flex; align-items: center; gap: .4rem; padding: .12rem 0; font-size: .85rem; }
.g-group a { cursor: pointer; text-decoration: underline dotted; flex: 1; word-break: break-all; }
.g-st { display: inline-block; width: 1.4em; text-align: center; font-weight: 700; color: var(--color-brass, #c79a4b); }
.g-st.new { color: #5fb36b; }
.g-st.conf { color: #d2553f; }
.g-mini { padding: 0 .4rem; font-weight: 700; cursor: pointer; background: var(--color-raise, #2a2018); color: inherit; border: 1px solid var(--color-line, #3a2e22); border-radius: var(--radius-sm, 4px); }
.g-danger { color: #d2553f; }
.g-muted { opacity: .6; font-size: .82rem; }
.g-err { color: #d2553f; padding: 0 .75rem; font-size: .8rem; }
/* Botones de acción: target táctil de 44px para tablet. */
.g-act { padding: .5rem .7rem; min-height: 44px; cursor: pointer; background: var(--color-raise, #2a2018); color: inherit; border: 1px solid var(--color-line, #3a2e22); border-radius: var(--radius-sm, 4px); }
.g-act:disabled { opacity: .5; cursor: default; }
```

Importarlo en `GitPanel.vue` con `import '../styles/git.css'`.

- [ ] **Step 2: Crear `GitWork.vue`**

Es el contenido de la sección `<!-- TRABAJO -->` de `ChangesPanel.vue:81-129`, con las clases renombradas a `g-*`, sin los `v-if="canWrite()"`, y emitiendo en vez de ejecutar:

```vue
<script setup lang="ts">
import { ref } from 'vue'
import type { GitStatus, GitFile, DiffBase } from '../composables/useGit'

const props = defineProps<{ status: GitStatus }>()
const emit = defineEmits<{
  (e: 'run', name: string, payload?: { paths?: string[]; message?: string }, confirmMsg?: string): void
  (e: 'diff', file: string, base: DiffBase): void
}>()

const commitMsg = ref('')
function paths(list: GitFile[]) { return list.map((f) => f.rel) }
function doCommit() {
  if (!commitMsg.value.trim()) return
  emit('run', 'commit', { message: commitMsg.value })
  commitMsg.value = ''
}
</script>
```

Template: copiar `ChangesPanel.vue:81-129` cambiando `run(...)` → `emit('run', ...)`, `openDiff(...)` → `emit('diff', ...)`, `status.` → `props.status.`, y `class="st"` → `class="g-st"` etc.

- [ ] **Step 3: Crear `GitBranchDiff.vue` y `GitCommits.vue`**

`GitBranchDiff.vue` es `ChangesPanel.vue:133-139` (la lista de archivos, **sin** el `<div class="ch-actions">` — esos botones se van a la barra fija del `GitPanel`):

```vue
<script setup lang="ts">
import type { GitStatus, DiffBase } from '../composables/useGit'
const props = defineProps<{ status: GitStatus }>()
const emit = defineEmits<{ (e: 'diff', file: string, base: DiffBase): void }>()
</script>

<template>
  <ul class="g-group">
    <li v-for="f in props.status.overview.files" :key="f.rel">
      <span class="g-st">{{ f.status }}</span>
      <a @click="emit('diff', f.rel, 'branch')">{{ f.rel }}</a>
    </li>
    <li v-if="!props.status.overview.files.length" class="g-muted">
      sin diferencias con {{ props.status.overview.default }}
    </li>
  </ul>
</template>
```

`GitCommits.vue` es `ChangesPanel.vue:149-163` con el mismo tratamiento (props + emit `diff`), y sus estilos `.ch-commit-row` / `.dot` renombrados a `.gc-row` / `.gc-dot` en un `<style scoped>` propio.

- [ ] **Step 4: Crear `GitPanel.vue`**

```vue
<script setup lang="ts">
import { ref, watch, onBeforeUnmount, computed } from 'vue'
import { useGit, type DiffBase } from '../composables/useGit'
import { parseDiff, type DiffHunk } from '../composables/parseDiff'
import { useSessions } from '../stores/sessions'
import GitWork from './GitWork.vue'
import GitBranchDiff from './GitBranchDiff.vue'
import GitCommits from './GitCommits.vue'
import GitDiff from './GitDiff.vue'
import '../styles/git.css'

const props = defineProps<{ id: string; path: string }>()

const store = useSessions()
const { status, loading, error, loadStatus, loadDiff, action } = useGit()

const tab = ref<'work' | 'branch' | 'commits'>('work')
const diff = ref<{ file: string; hunks: DiffHunk[]; binary: boolean } | null>(null)
const busy = ref('')
const actionErr = ref('')

async function refresh() { await loadStatus(props.id, props.path) }

async function openDiff(file: string, base: DiffBase) {
  diff.value = null
  try {
    const r = await loadDiff(props.id, file, base, props.path)
    diff.value = { file, hunks: r.binary ? [] : parseDiff(r.patch), binary: r.binary }
  } catch { actionErr.value = 'no se pudo cargar el diff' }
}

async function run(name: string, payload: { paths?: string[]; message?: string } = {}, confirmMsg?: string) {
  if (confirmMsg && !confirm(confirmMsg)) return
  busy.value = name; actionErr.value = ''
  const r = await action(props.id, name, { path: props.path, ...payload })
  busy.value = ''
  if (!r.ok) actionErr.value = r.conflict ? `Conflicto en: ${(r.files ?? []).join(', ')}` : (r.message || 'falló')
  await refresh()
}

// Refresh live: cada broadcast WS hace store.upsert -> la sesión seleccionada
// cambia de identidad; debounced para no spamear git.
let t: ReturnType<typeof setTimeout> | null = null
function schedule() { if (t) clearTimeout(t); t = setTimeout(refresh, 800) }
watch(() => store.list.find((s) => s.id === props.id), schedule)
// El path lo manda el shell: al navegar a otra carpeta hay que re-scopear.
watch(() => [props.id, props.path] as const, refresh, { immediate: true })
onBeforeUnmount(() => { if (t) clearTimeout(t) })

const repoLabel = computed(() => {
  if (!status.value) return null
  const { branch, ahead, behind } = status.value.overview
  return { name: status.value.repo.name || status.value.repo.rel || '·', branch, ahead, behind }
})
defineExpose({ repoLabel, refresh })
</script>

<template>
  <div class="gp">
    <nav class="gp-tabs">
      <button :class="{ on: tab === 'work' }" @click="tab = 'work'">Trabajo</button>
      <button :class="{ on: tab === 'branch' }" @click="tab = 'branch'">Rama</button>
      <button :class="{ on: tab === 'commits' }" @click="tab = 'commits'">Commits</button>
    </nav>

    <p v-if="error" class="g-err">{{ error === 'sin-dir' ? 'sin repo git acá' : error }}</p>
    <p v-if="actionErr" class="g-err">{{ actionErr }}</p>
    <p v-if="loading" class="g-muted">cargando…</p>

    <div v-if="status" class="gp-body">
      <GitWork v-if="tab === 'work'" :status="status" @run="run" @diff="openDiff" />
      <GitBranchDiff v-else-if="tab === 'branch'" :status="status" @diff="openDiff" />
      <GitCommits v-else :status="status" @diff="openDiff" />
    </div>

    <!-- Barra fija: visible desde cualquier sub-pestaña. Es la corrección al
         problema original (los botones estaban enterrados en una pestaña). -->
    <footer v-if="status" class="gp-actions">
      <button class="g-act" :disabled="busy === 'merge-default'"
        @click="run('merge-default', {}, `Traer ${status.overview.default} a la rama?`)">↻ Actualizar</button>
      <button class="g-act" :disabled="busy === 'pull'" @click="run('pull')">Pull</button>
      <button class="g-act" :disabled="busy === 'push'" @click="run('push')">Push</button>
    </footer>

    <GitDiff v-if="diff" :file="diff.file" :hunks="diff.hunks" :binary="diff.binary" @close="diff = null" />
  </div>
</template>

<style scoped>
.gp { position: relative; display: flex; flex-direction: column; min-height: 0; flex: 1; }
.gp-tabs { display: flex; gap: .25rem; padding: .4rem .75rem; }
.gp-tabs button { flex: 1; padding: .35rem; min-height: 40px; background: transparent; color: inherit; border: 1px solid var(--color-line, #3a2e22); border-radius: var(--radius-sm, 4px); cursor: pointer; }
.gp-tabs button.on { background: var(--color-brass, #c79a4b); color: #1a1410; font-weight: 700; }
.gp-body { flex: 1; overflow: auto; padding: .5rem .75rem; }
.gp-actions { display: flex; flex-wrap: wrap; gap: .4rem; padding: .5rem .75rem; border-top: 1px solid var(--color-line, #3a2e22); }
</style>
```

`Fetch` y `PR` se agregan a esta barra en las Tasks 14 y 16.

- [ ] **Step 5: Borrar `ChangesPanel.vue`**

```bash
git rm habitat/client/src/components/ChangesPanel.vue
```

`DetailPanel.vue` todavía lo importa: eso se arregla en Task 9, que es la que cierra este refactor. Las dos tasks se commitean juntas si el build no queda verde en el medio.

- [ ] **Step 6: Verificar**

Run: `cd habitat/client && npx vue-tsc --noEmit`
Expected: el único error debe ser el import roto de `ChangesPanel` en `DetailPanel.vue`, que resuelve Task 9.

- [ ] **Step 7: Commit**

```bash
git add habitat/client/src
git commit -m "refactor(habitat): partir ChangesPanel en GitPanel + GitWork/GitBranchDiff/GitCommits"
```

---

### Task 9: Pestañas `Archivos | Git` y chip de repo en `ProjectExplorer`

**Files:**
- Modify: `habitat/client/src/components/ProjectExplorer.vue`
- Modify: `habitat/client/src/components/DetailPanel.vue` (~línea 125 dtools, ~166 overlays)

**Interfaces:**
- Produces: `ProjectExplorer` props `{ id: string; tab?: 'files' | 'git' }`. El `tab` inicial lo decide quien lo abre.
- Consumes: `GitPanel` (Task 8), `ProjectFiles` (Task 7).

- [ ] **Step 1: Agregar las pestañas y el chip**

En `ProjectExplorer.vue`:

```vue
<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import ProjectFiles from './ProjectFiles.vue'
import GitPanel from './GitPanel.vue'

const props = withDefaults(defineProps<{ id: string; tab?: 'files' | 'git' }>(), { tab: 'files' })
const emit = defineEmits<{ (e: 'close'): void; (e: 'opened'): void }>()

const path = ref('')
const tab = ref<'files' | 'git'>(props.tab)
const files = ref<InstanceType<typeof ProjectFiles> | null>(null)
const git = ref<InstanceType<typeof GitPanel> | null>(null)

function onKey(e: KeyboardEvent) { if (e.key === 'Escape') emit('close') }
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>
```

Template — header con breadcrumbs + chip, y las dos pestañas:

```vue
    <header class="pe-head">
      <span class="pe-title">🗂 Proyecto</span>
      <nav class="pe-crumbs">
        <button class="pe-crumb" @click="path = ''">{{ files?.listing?.root || '~' }}</button>
        <template v-for="c in files?.listing?.breadcrumbs || []" :key="c.rel">
          <span class="pe-sep">/</span>
          <button class="pe-crumb" @click="path = c.rel">{{ c.name }}</button>
        </template>
      </nav>
      <button class="pe-x" @click="emit('close')" title="Cerrar">✕</button>
    </header>

    <div v-if="git?.repoLabel" class="pe-chip">
      repo: <b>{{ git.repoLabel.name }}</b>
      · ⌥ <b>{{ git.repoLabel.branch }}</b>
      · ↑{{ git.repoLabel.ahead }} ↓{{ git.repoLabel.behind }}
    </div>

    <nav class="pe-tabs">
      <button :class="{ on: tab === 'files' }" @click="tab = 'files'">Archivos</button>
      <button :class="{ on: tab === 'git' }" @click="tab = 'git'">Git</button>
    </nav>

    <div class="pe-body">
      <ProjectFiles v-show="tab === 'files'" ref="files" :id="props.id" :path="path"
        @navigate="(rel) => (path = rel)" @opened="emit('opened')" />
      <GitPanel v-if="tab === 'git'" ref="git" :id="props.id" :path="path" />
    </div>
```

`ProjectFiles` va con `v-show` (no `v-if`) para que el `listing` de los breadcrumbs siga vivo mientras estás en la pestaña Git. `GitPanel` va con `v-if` para no pollear git cuando no está visible.

Estilos nuevos:

```css
.pe-chip { padding: .25rem .75rem; font-size: .8rem; opacity: .9; border-bottom: 1px solid var(--color-line, #3a2e22); }
.pe-tabs { display: flex; gap: .25rem; padding: .4rem .75rem 0; }
.pe-tabs button { flex: 1; padding: .4rem; min-height: 44px; background: transparent; color: inherit; border: 1px solid var(--color-line, #3a2e22); border-radius: var(--radius-sm, 4px); cursor: pointer; }
.pe-tabs button.on { background: var(--color-brass, #c79a4b); color: #1a1410; font-weight: 700; }
.pe-body { flex: 1; display: flex; flex-direction: column; min-height: 0; }
```

Ojo: `.pe-body` era `display: flex` en fila para el split lista/preview. Ese split ahora vive dentro de `ProjectFiles.vue` con sus propios estilos, así que acá pasa a `column`.

- [ ] **Step 2: Actualizar `DetailPanel.vue`**

Borrar `import ChangesPanel from './ChangesPanel.vue'` (línea 5) y la variable `changesOpen`. El botón `⌥ Cambios` abre Proyecto en la pestaña Git:

```vue
          <button class="tool" @click="openProject('git')" title="Cambios git">⌥ Cambios</button>
          <button class="tool" @click="openProject('files')" title="Explorador de proyecto">🗂 Proyecto</button>
```

En el script:

```ts
const explorerOpen = ref(false)
const explorerTab = ref<'files' | 'git'>('files')
function openProject(tab: 'files' | 'git') {
  if (explorerOpen.value && explorerTab.value === tab) { explorerOpen.value = false; return }
  explorerTab.value = tab
  explorerOpen.value = true
}
```

Y en los overlays, borrar la línea de `<ChangesPanel .../>` y pasarle el tab al explorer:

```vue
      <ProjectExplorer v-if="explorerOpen" :id="store.selected.id" :tab="explorerTab"
        @close="explorerOpen = false" @opened="editorOpen = true" />
```

(`explorerOpen` ya existe en `DetailPanel`; leer el script actual y ajustar en vez de duplicar la declaración.)

- [ ] **Step 3: Verificar**

Run: `cd habitat/client && npx vue-tsc --noEmit && npm run build`
Expected: sin errores.

En el navegador: `🗂 Proyecto` abre en Archivos; `⌥ Cambios` abre en Git. Navegar a una subcarpeta que sea repo (en Artisano: `back`) y verificar que el chip cambia a `repo: back` y que el status es el de ese repo. La barra `↻ Actualizar / Pull / Push` se ve desde las tres sub-pestañas.

- [ ] **Step 4: Commit**

```bash
git add habitat/client/src/components
git commit -m "feat(habitat): vista de proyecto con pestañas Archivos|Git y chip de repo"
```

---

# Fase 3 — Branches

### Task 10: `git-branches.js`

**Files:**
- Create: `habitat/server/git-branches.js`
- Test: `habitat/server/git-branches.test.js`

**Interfaces:**
- Consumes: `validBranch`, `currentBranch`, `remoteDefaultBranch`, `defaultExec` de `git.js`; `trimErr`, `gitOk` de `git-write.js`.
- Produces:
  - `parseBranchList(out)` → `[{ name, worktree, current }]` — puro. `worktree` es `''` si está libre.
  - `parseRemoteList(out)` → `string[]` — puro, filtra `origin/HEAD` (que sale como el remote pelado, sin `/`).
  - `listBranches(cwd, exec)` → `{ current, default, local: [{name, worktree, current}], remote: string[] }`
  - `checkout(cwd, branch, exec)` → `{ ok, dirty?: true, message? }` — `dirty: true` cuando git rechaza por cambios locales que se sobreescribirían (habilita el "stashear y reintentar" del cliente).
  - `createBranch(cwd, branch, from, exec)` → `{ ok, message? }` — `from` es `'default'` o `'HEAD'`.

- [ ] **Step 1: Escribir los tests que fallan**

Create `habitat/server/git-branches.test.js`:

```js
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
  assert.equal(calls.some((c) => c.startsWith('-C /proj checkout')), false);
});

test('checkout marca dirty cuando git rechaza por cambios locales', async () => {
  const exec = async (file, args) => {
    const a = args.join(' ');
    if (a.includes('symbolic-ref')) return 'origin/main\n';
    if (a.includes('--abbrev-ref HEAD')) return 'link\n';
    if (a.includes('branch -r')) return '';
    if (a.includes('branch --list')) return 'main\t\t \n';
    if (a.startsWith('-C /proj checkout')) {
      const e = new Error('x');
      e.stderr = 'error: Your local changes to the following files would be overwritten by checkout:\n\ta.js';
      throw e;
    }
    return '';
  };
  const r = await checkout('/proj', 'main', exec);
  assert.equal(r.ok, false);
  assert.equal(r.dirty, true);
});

test('checkout ok invoca git checkout', async () => {
  let got;
  const exec = async (file, args) => {
    const a = args.join(' ');
    if (a.includes('symbolic-ref')) return 'origin/main\n';
    if (a.includes('--abbrev-ref HEAD')) return 'link\n';
    if (a.includes('branch -r')) return '';
    if (a.includes('branch --list')) return 'main\t\t \n';
    if (a.startsWith('-C /proj checkout')) { got = a; return ''; }
    return '';
  };
  const r = await checkout('/proj', 'main', exec);
  assert.equal(r.ok, true);
  assert.equal(r.branch, 'main');
  assert.equal(got, '-C /proj checkout main');
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
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd habitat && node --test server/git-branches.test.js`
Expected: FAIL — no existe `./git-branches.js`.

- [ ] **Step 3: Implementar**

Create `habitat/server/git-branches.js`:

```js
import { basename } from 'node:path';
import { validBranch, currentBranch, remoteDefaultBranch, defaultExec } from './git.js';
import { trimErr, gitOk } from './git-write.js';

// Parsea `git branch --list --format='%(refname:short)\t%(worktreepath)\t%(HEAD)'`.
// worktreepath viene vacío para las branches libres, y con la ruta del worktree
// para las que ya están checked out en otro lado (git rechaza tomarlas de nuevo).
export function parseBranchList(out) {
  const rows = [];
  for (const line of String(out).split('\n')) {
    if (!line.trim()) continue;
    const [name, worktree = '', head = ''] = line.split('\t');
    if (!name) continue;
    rows.push({ name, worktree: worktree.trim(), current: head.trim() === '*' });
  }
  return rows;
}

// Parsea `git branch -r --format='%(refname:short)'`. El HEAD del remoto
// (refs/remotes/origin/HEAD) sale como el remote pelado, sin '/': lo filtramos.
export function parseRemoteList(out) {
  return String(out).split('\n').map((l) => l.trim()).filter((l) => l && l.includes('/'));
}

export async function listBranches(cwd, exec = defaultExec) {
  const [current, def] = await Promise.all([
    currentBranch(cwd, exec),
    remoteDefaultBranch(cwd, exec),
  ]);
  let local = [], remote = [];
  try {
    local = parseBranchList(await exec('git', [
      '-C', cwd, 'branch', '--list',
      '--format=%(refname:short)%09%(worktreepath)%09%(HEAD)',
    ]));
  } catch { /* dejar [] */ }
  try {
    remote = parseRemoteList(await exec('git', ['-C', cwd, 'branch', '-r', '--format=%(refname:short)']));
  } catch { /* dejar [] */ }
  return { current, default: def, local, remote };
}

// Detecta el rechazo de git por cambios locales que se sobreescribirían. Habilita
// el "stashear y reintentar" del cliente, que es la salida útil para el usuario.
function isDirtyReject(e) {
  const out = (e && ((e.stdout || '') + (e.stderr || ''))) || '';
  return /would be overwritten by checkout|Please commit your changes or stash them/i.test(out);
}

export async function checkout(cwd, branch, exec = defaultExec) {
  if (!validBranch(branch)) return { ok: false, message: 'nombre de rama inválido' };
  // Guard en el server además del de la UI: la lista del cliente puede estar stale.
  // git fallaría igual, pero acá el mensaje nombra la sesión que la tiene tomada.
  const { local } = await listBranches(cwd, exec);
  const taken = local.find((b) => b.name === branch && b.worktree && !b.current);
  if (taken) return { ok: false, message: `${branch} ya está abierta en ${basename(taken.worktree)}` };
  try {
    await exec('git', ['-C', cwd, 'checkout', branch]);
    return { ok: true, branch };
  } catch (e) {
    if (isDirtyReject(e)) return { ok: false, dirty: true, message: trimErr(e) };
    return { ok: false, code: e && e.code, message: trimErr(e) };
  }
}

export async function createBranch(cwd, branch, from, exec = defaultExec) {
  if (!validBranch(branch)) return { ok: false, message: 'nombre de rama inválido' };
  let start = 'HEAD';
  if (from === 'default') {
    start = await remoteDefaultBranch(cwd, exec);
    if (!start || String(start).startsWith('-')) return { ok: false, message: 'rama default inválida' };
  } else if (from !== 'HEAD') {
    return { ok: false, message: 'origen inválido' };
  }
  const r = await gitOk(cwd, ['checkout', '-b', branch, start], exec);
  return r.ok ? { ok: true, branch } : r;
}

export { defaultExec };
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `cd habitat && node --test server/git-branches.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add habitat/server/git-branches.js habitat/server/git-branches.test.js
git commit -m "feat(habitat): git-branches, listar/checkout/crear con guard de worktree"
```

---

### Task 11: Endpoint `/git/branches`, acciones `checkout` / `branch-create`, y lock por repo

**Files:**
- Create: `habitat/server/locks.js`
- Test: `habitat/server/locks.test.js`
- Modify: `habitat/server/index.js`
- Test: `habitat/server/index.test.js`

**Interfaces:**
- Produces:
  - `createLocks()` → `{ run(key, fn): Promise<any> }`. Lanza `Error('busy')` si `key` ya está tomada.
  - `GET /git/branches?id=&path=` → el objeto de `listBranches`.
  - `POST /git/action` acepta `checkout` (`{ branch }`) y `branch-create` (`{ branch, from }`).
  - Toda acción de escritura corre dentro del lock del `repo.dir`; si está tomada → `409`.
- Consumes: `listBranches`, `checkout`, `createBranch` de Task 10; `resolveRepoOr` de Task 2.

- [ ] **Step 1: Escribir los tests que fallan**

Create `habitat/server/locks.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocks } from './locks.js';

test('run serializa: la segunda llamada concurrente sobre la misma key falla con busy', async () => {
  const locks = createLocks();
  let release;
  const primera = locks.run('/repo', () => new Promise((r) => { release = r; }));
  await assert.rejects(() => locks.run('/repo', async () => 'x'), /busy/);
  release('ok');
  assert.equal(await primera, 'ok');
  // liberada: ahora sí entra
  assert.equal(await locks.run('/repo', async () => 'y'), 'y');
});

test('run no bloquea keys distintas', async () => {
  const locks = createLocks();
  let release;
  const a = locks.run('/a', () => new Promise((r) => { release = r; }));
  assert.equal(await locks.run('/b', async () => 'b'), 'b');
  release('a');
  assert.equal(await a, 'a');
});

test('run libera la key aunque fn lance', async () => {
  const locks = createLocks();
  await assert.rejects(() => locks.run('/repo', async () => { throw new Error('boom'); }), /boom/);
  assert.equal(await locks.run('/repo', async () => 'ok'), 'ok');
});
```

En `habitat/server/index.test.js`:

```js
test('GET /git/branches lista locales y remotas', async () => {
  const { dir } = tmpRepo();
  const store = createStore();
  store.upsert({ id: 's1', cwd: dir, name: 'proj', status: 'working' });
  const { server } = createApp({ config, store });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/git/branches?id=s1`, {
    headers: { authorization: 'Bearer secret' },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.current, 'main');
  assert.ok(body.local.some((b) => b.name === 'main' && b.current === true));
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

test('POST /git/action checkout crea y cambia de rama', async () => {
  const { dir } = tmpRepo();
  const store = createStore();
  store.upsert({ id: 's1', cwd: dir, name: 'proj', status: 'working' });
  const { server } = createApp({ config, store });
  const port = await listen(server);
  const post = (body) => fetch(`http://127.0.0.1:${port}/git/action?id=s1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer secret' },
    body: JSON.stringify(body),
  });
  const c = await (await post({ action: 'branch-create', branch: 'feature/x', from: 'HEAD' })).json();
  assert.equal(c.ok, true);
  const b = await (await post({ action: 'checkout', branch: 'main' })).json();
  assert.equal(b.ok, true);
  assert.equal(b.branch, 'main');
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

test('POST /git/action con acción desconocida -> 400', async () => {
  const { dir } = tmpRepo();
  const store = createStore();
  store.upsert({ id: 's1', cwd: dir, name: 'proj', status: 'working' });
  const { server } = createApp({ config, store });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/git/action?id=s1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer secret' },
    body: JSON.stringify({ action: 'rm-rf' }),
  });
  assert.equal(res.status, 400);
  server.close();
  rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd habitat && node --test server/locks.test.js server/index.test.js`
Expected: FAIL — no existe `./locks.js`, y `/git/branches` da 404.

- [ ] **Step 3: Implementar `locks.js`**

```js
// Serializa acciones de escritura git por repo. Dos comandos git simultáneos en
// el mismo repo pelean por index.lock y fallan con un error ilegible; acá el
// segundo recibe un 'busy' limpio que el endpoint traduce a 409. El `busy` del
// cliente no alcanza: no cubre dos pestañas ni dos clientes.
export function createLocks() {
  const held = new Set();
  return {
    async run(key, fn) {
      if (held.has(key)) throw new Error('busy');
      held.add(key);
      try { return await fn(); }
      finally { held.delete(key); }
    },
  };
}
```

- [ ] **Step 4: Implementar los endpoints**

En `habitat/server/index.js`:

1. Imports: `import * as gitBranches from './git-branches.js';` y `import { createLocks } from './locks.js';`
2. Dentro de `createApp`, junto a las otras inicializaciones: `const locks = createLocks();`
3. Endpoint nuevo, al lado de `/git/status`:

```js
    if (req.method === 'GET' && url.pathname === '/git/branches') {
      if (!authorize(req, res)) return;
      const s = store.get(url.searchParams.get('id') || '');
      const repo = await resolveRepoOr(res, s, url);
      if (!repo) return;
      try {
        const out = await gitBranches.listBranches(repo.dir);
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
      } catch { res.writeHead(500).end(); }
      return;
    }
```

4. En `/git/action`, agregar los dos casos y envolver el switch en el lock. El `branch` del body se valida en las funciones de `git-branches.js`, pero hay que chequear que sea string:

```js
      const { action, paths, message, branch, from } = body || {};
      if (branch !== undefined && typeof branch !== 'string') { res.writeHead(400).end(); return; }
      // ... validación de paths, igual que antes ...
      let r;
      try {
        r = await locks.run(repo.dir, async () => {
          switch (action) {
            case 'stage': return gitWrite.stage(repo.dir, paths);
            case 'unstage': return gitWrite.unstage(repo.dir, paths);
            case 'discard': return gitWrite.discard(repo.dir, paths);
            case 'commit': return gitWrite.commit(repo.dir, message);
            case 'push': return gitWrite.push(repo.dir);
            case 'pull': return gitWrite.pull(repo.dir);
            case 'merge-default': return gitWrite.mergeDefault(repo.dir);
            case 'abort': return gitWrite.abort(repo.dir);
            case 'checkout': return gitBranches.checkout(repo.dir, branch);
            case 'branch-create': return gitBranches.createBranch(repo.dir, branch, from);
            default: return null; // acción desconocida
          }
        });
      } catch (e) {
        res.writeHead(e && e.message === 'busy' ? 409 : 500).end();
        return;
      }
      if (r === null) { res.writeHead(400).end(); return; }
      // Tras un checkout el branch de la sesión quedó stale: refrescarlo ya, sin
      // esperar al próximo hook. hooks-logic lo reconfirma después.
      if (r.ok && r.branch && s.cwd === repo.dir) store.upsert({ ...s, branch: r.branch });
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(r));
      return;
```

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `cd habitat && node --test server/locks.test.js server/index.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add habitat/server/locks.js habitat/server/locks.test.js habitat/server/index.js habitat/server/index.test.js
git commit -m "feat(habitat): endpoint /git/branches, acciones checkout y branch-create, lock por repo"
```

---

### Task 12: `GitBranches.vue` y el agrupador de branches

**Files:**
- Create: `habitat/client/src/composables/gitBranches.ts`
- Test: `habitat/client/src/composables/gitBranches.test.ts`
- Create: `habitat/client/src/components/GitBranches.vue`
- Modify: `habitat/client/src/composables/useGit.ts`
- Modify: `habitat/client/src/components/GitPanel.vue`

**Interfaces:**
- Produces:
  - `BranchRow = { name: string; worktree: string; current: boolean }`
  - `BranchList = { current: string; default: string; local: BranchRow[]; remote: string[] }`
  - `groupBranches(data: BranchList, filter: string)` → `{ local: (BranchRow & { takenBy: string })[]; remote: { name: string; short: string }[] }`
    - `takenBy`: basename del worktree si está tomada por **otra** sesión; `''` si está libre o es la actual.
    - `remote`: sólo las que no tienen equivalente local, con `short` = el nombre sin el remote.
  - `useGit()` suma `loadBranches(id, path?): Promise<BranchList | null>`.
- Consumes: `GET /git/branches` de Task 11.

- [ ] **Step 1: Escribir el test que falla**

Create `habitat/client/src/composables/gitBranches.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { groupBranches } from './gitBranches'

const data = {
  current: 'link',
  default: 'origin/main',
  local: [
    { name: 'link', worktree: '/wt/RPG/link', current: true },
    { name: 'main', worktree: '', current: false },
    { name: 'dante', worktree: '/wt/RPG/dante', current: false },
  ],
  remote: ['origin/main', 'origin/shepard'],
}

describe('groupBranches', () => {
  it('marca takenBy con el nombre de la sesión que tiene la branch', () => {
    const { local } = groupBranches(data, '')
    expect(local.find((b) => b.name === 'dante')?.takenBy).toBe('dante')
    expect(local.find((b) => b.name === 'main')?.takenBy).toBe('')
  })

  it('no marca takenBy en la branch actual', () => {
    const { local } = groupBranches(data, '')
    expect(local.find((b) => b.name === 'link')?.takenBy).toBe('')
  })

  it('esconde las remotas que ya tienen local', () => {
    const { remote } = groupBranches(data, '')
    expect(remote.map((r) => r.short)).toEqual(['shepard'])
  })

  it('filtra por substring en locales y remotas', () => {
    expect(groupBranches(data, 'dan').local.map((b) => b.name)).toEqual(['dante'])
    expect(groupBranches(data, 'shep').remote.map((r) => r.short)).toEqual(['shepard'])
    expect(groupBranches(data, 'zzz').local).toEqual([])
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd habitat/client && npx vitest run src/composables/gitBranches.test.ts`
Expected: FAIL — no existe `./gitBranches`.

- [ ] **Step 3: Implementar el helper**

Create `habitat/client/src/composables/gitBranches.ts`:

```ts
export interface BranchRow { name: string; worktree: string; current: boolean }
export interface BranchList { current: string; default: string; local: BranchRow[]; remote: string[] }

const base = (p: string) => p.slice(p.replace(/\/+$/, '').lastIndexOf('/') + 1)

// Agrupa para la UI: takenBy nombra la sesión que ya tiene la branch checked out
// (git rechazaría el checkout), y las remotas que ya tienen local se esconden
// porque no aportan nada.
export function groupBranches(data: BranchList, filter: string) {
  const f = filter.trim().toLowerCase()
  const match = (s: string) => !f || s.toLowerCase().includes(f)
  const localNames = new Set(data.local.map((b) => b.name))
  return {
    local: data.local
      .filter((b) => match(b.name))
      .map((b) => ({ ...b, takenBy: b.worktree && !b.current ? base(b.worktree) : '' })),
    remote: data.remote
      .map((name) => ({ name, short: name.slice(name.indexOf('/') + 1) }))
      .filter((r) => !localNames.has(r.short) && match(r.short)),
  }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `cd habitat/client && npx vitest run src/composables/gitBranches.test.ts`
Expected: PASS.

- [ ] **Step 5: Agregar `loadBranches` a `useGit.ts`**

```ts
import type { BranchList } from './gitBranches'

  async function loadBranches(id: string, path?: string): Promise<BranchList | null> {
    const res = await fetch(`/git/branches?${q(id, path)}`, { headers: authHeaders() })
    if (!res.ok) return null
    return (await res.json()) as BranchList
  }
```

Agregarlo al `return`.

- [ ] **Step 6: Crear `GitBranches.vue`**

```vue
<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useGit } from '../composables/useGit'
import { groupBranches, type BranchList } from '../composables/gitBranches'

const props = defineProps<{ id: string; path: string }>()
const emit = defineEmits<{
  (e: 'run', name: string, payload?: Record<string, unknown>, confirmMsg?: string): void
}>()

const { loadBranches } = useGit()
const data = ref<BranchList | null>(null)
const filter = ref('')
const creating = ref(false)
const newName = ref('')
const newFrom = ref<'default' | 'HEAD'>('default')

async function refresh() { data.value = await loadBranches(props.id, props.path) }
watch(() => [props.id, props.path] as const, refresh, { immediate: true })

const groups = computed(() => (data.value ? groupBranches(data.value, filter.value) : null))

function doCheckout(branch: string) { emit('run', 'checkout', { branch }) }
function doCreate() {
  if (!newName.value.trim()) return
  emit('run', 'branch-create', { branch: newName.value.trim(), from: newFrom.value })
  newName.value = ''; creating.value = false
}
defineExpose({ refresh })
</script>

<template>
  <div v-if="groups">
    <div class="gb-top">
      <input v-model="filter" class="gb-find" placeholder="buscar rama" />
      <button class="g-mini" @click="creating = !creating">+ nueva</button>
    </div>

    <div v-if="creating" class="gb-new">
      <input v-model="newName" placeholder="nombre de la rama" @keyup.enter="doCreate" />
      <select v-model="newFrom">
        <option value="default">desde {{ data?.default }}</option>
        <option value="HEAD">desde HEAD</option>
      </select>
      <button class="g-act" :disabled="!newName.trim()" @click="doCreate">Crear</button>
    </div>

    <ul class="g-group">
      <li v-for="b in groups.local" :key="b.name">
        <span class="g-st">{{ b.current ? '*' : '' }}</span>
        <a v-if="!b.current && !b.takenBy" @click="doCheckout(b.name)">{{ b.name }}</a>
        <span v-else class="gb-flat">{{ b.name }}</span>
        <span v-if="b.current" class="g-muted">(actual)</span>
        <span v-else-if="b.takenBy" class="g-muted">abierta en {{ b.takenBy }}</span>
      </li>
      <li v-if="!groups.local.length" class="g-muted">sin ramas locales que coincidan</li>
    </ul>

    <h4 v-if="groups.remote.length">remotas</h4>
    <ul class="g-group">
      <li v-for="r in groups.remote" :key="r.name">
        <span class="g-st"></span>
        <span class="gb-flat">{{ r.name }}</span>
        <button class="g-mini" @click="emit('run', 'branch-create', { branch: r.short, from: 'HEAD' })">crear local</button>
      </li>
    </ul>
  </div>
  <p v-else class="g-muted">cargando ramas…</p>
</template>

<style scoped>
.gb-top { display: flex; gap: .4rem; margin-bottom: .5rem; }
.gb-find { flex: 1; padding: .4rem; background: var(--color-raise, #2a2018); color: inherit; border: 1px solid var(--color-line, #3a2e22); border-radius: var(--radius-sm, 4px); }
.gb-new { display: flex; flex-wrap: wrap; gap: .4rem; margin-bottom: .6rem; }
.gb-new input { flex: 1; min-width: 8rem; padding: .4rem; background: var(--color-raise, #2a2018); color: inherit; border: 1px solid var(--color-line, #3a2e22); border-radius: var(--radius-sm, 4px); }
.gb-new select { padding: .4rem; background: var(--color-raise, #2a2018); color: inherit; border: 1px solid var(--color-line, #3a2e22); border-radius: var(--radius-sm, 4px); }
.gb-flat { flex: 1; word-break: break-all; }
</style>
```

Nota sobre "crear local" de una remota: `git checkout -b <short> HEAD` **no** la trackea. Se acepta en esta tanda porque `push` ya cae a `-u origin <branch>` y deja el upstream armado en el primer push.

- [ ] **Step 7: Enchufar la pestaña en `GitPanel.vue`**

- `tab` pasa a `ref<'work' | 'branches' | 'commits' | 'branch'>('work')`.
- Agregar el botón `Branches` en `.gp-tabs` (entre Trabajo y Commits).
- Agregar `<GitBranches v-else-if="tab === 'branches'" :id="props.id" :path="props.path" @run="run" />`.
- `run()` ya acepta payload arbitrario; ampliar su tipo a `Record<string, unknown>`.
- Tras un `run` exitoso de `checkout`/`branch-create`, refrescar también las branches: agregar un `ref` al `GitBranches` y llamar a su `refresh()` expuesto al final de `run()`.

```ts
const branchesEl = ref<InstanceType<typeof GitBranches> | null>(null)
// ... al final de run(), después del refresh():
  await branchesEl.value?.refresh()
```

- [ ] **Step 8: Verificar**

Run: `cd habitat/client && npx vitest run src/composables && npx vue-tsc --noEmit && npm run build`
Expected: PASS y build limpio.

En el navegador: pestaña **Branches**. Verificar que la branch actual sale con `*` y `(actual)`, que las tomadas por otras sesiones salen con "abierta en X" y no son clickeables, y que hacer checkout de una libre funciona y actualiza el chip.

- [ ] **Step 9: Commit**

```bash
git add habitat/client/src
git commit -m "feat(habitat): pestaña Branches con checkout y crear rama"
```

---

# Fase 4 — Stash

### Task 13: `git-stash.js`

**Files:**
- Create: `habitat/server/git-stash.js`
- Test: `habitat/server/git-stash.test.js`

**Interfaces:**
- Consumes: `defaultExec` de `git.js`; `trimErr`, `gitOk` de `git-write.js`.
- Produces:
  - `parseStashList(out)` → `[{ index: number, message: string }]` — puro.
  - `stashList(cwd, exec)` → `[{ index, message }]`
  - `stashPush(cwd, message, exec)` → `{ ok, message? }` — `message` opcional; sin él, `git stash push` sin `-m`.
  - `stashApply(cwd, index, exec)` → `{ ok, message? }` — usa `stash pop`.
  - `stashDrop(cwd, index, exec)` → `{ ok, message? }`

- [ ] **Step 1: Escribir los tests que fallan**

Create `habitat/server/git-stash.test.js`:

```js
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
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd habitat && node --test server/git-stash.test.js`
Expected: FAIL — no existe `./git-stash.js`.

- [ ] **Step 3: Implementar**

```js
import { defaultExec } from './git.js';
import { gitOk } from './git-write.js';

// Parsea `git stash list --format='%gd%x1f%gs'`: 'stash@{N}' + \x1f + asunto.
export function parseStashList(out) {
  const rows = [];
  for (const line of String(out).split('\n')) {
    if (!line.trim()) continue;
    const [ref, message = ''] = line.split('\x1f');
    const m = /^stash@\{(\d+)\}$/.exec(String(ref).trim());
    if (!m) continue;
    rows.push({ index: Number(m[1]), message });
  }
  return rows;
}

export async function stashList(cwd, exec = defaultExec) {
  try { return parseStashList(await exec('git', ['-C', cwd, 'stash', 'list', '--format=%gd%x1f%gs'])); }
  catch { return []; }
}

export async function stashPush(cwd, message, exec = defaultExec) {
  const msg = typeof message === 'string' ? message.trim() : '';
  // -m con el mensaje como arg separado: nunca se interpola en un string.
  const args = msg ? ['stash', 'push', '-m', msg] : ['stash', 'push'];
  return gitOk(cwd, args, exec);
}

// El índice se valida como entero >= 0 y se reconstruye como 'stash@{N}': no
// llega nada del usuario a la línea de comando sin pasar por Number.
function stashRef(index) {
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) return null;
  return `stash@{${index}}`;
}

// "aplicar" = pop: aplica y saca de la pila, que es lo que espera el usuario
// cuando toca aplicar en la UI.
export async function stashApply(cwd, index, exec = defaultExec) {
  const ref = stashRef(index);
  if (!ref) return { ok: false, message: 'índice de stash inválido' };
  return gitOk(cwd, ['stash', 'pop', ref], exec);
}

export async function stashDrop(cwd, index, exec = defaultExec) {
  const ref = stashRef(index);
  if (!ref) return { ok: false, message: 'índice de stash inválido' };
  return gitOk(cwd, ['stash', 'drop', ref], exec);
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `cd habitat && node --test server/git-stash.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add habitat/server/git-stash.js habitat/server/git-stash.test.js
git commit -m "feat(habitat): git-stash, guardar/listar/aplicar/borrar"
```

---

### Task 14: Endpoint `/git/stash`, acciones de stash, y UI en `GitWork`

**Files:**
- Modify: `habitat/server/index.js`
- Test: `habitat/server/index.test.js`
- Modify: `habitat/client/src/composables/useGit.ts`
- Modify: `habitat/client/src/components/GitWork.vue`
- Modify: `habitat/client/src/components/GitPanel.vue`

**Interfaces:**
- Produces:
  - `GET /git/stash?id=&path=` → `[{ index, message }]`
  - Acciones `stash-push` (`{ message? }`), `stash-apply` (`{ index }`), `stash-drop` (`{ index }`).
  - `useGit()` suma `loadStash(id, path?): Promise<StashEntry[]>` con `StashEntry = { index: number; message: string }`.
  - `GitWork` recibe prop nueva `stash: StashEntry[]`.

- [ ] **Step 1: Escribir el test que falla**

```js
test('stash: push, list y pop por endpoint', async () => {
  const { dir } = tmpRepo();
  const store = createStore();
  store.upsert({ id: 's1', cwd: dir, name: 'proj', status: 'working' });
  const { server } = createApp({ config, store });
  const port = await listen(server);
  const post = (body) => fetch(`http://127.0.0.1:${port}/git/action?id=s1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer secret' },
    body: JSON.stringify(body),
  });
  writeFileSync(join(dir, 'a.js'), 'const a = 99\n'); // sucia el árbol
  assert.equal((await (await post({ action: 'stash-push', message: 'wip' })).json()).ok, true);
  const list = await (await fetch(`http://127.0.0.1:${port}/git/stash?id=s1`, {
    headers: { authorization: 'Bearer secret' },
  })).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].index, 0);
  assert.ok(list[0].message.includes('wip'));
  assert.equal((await (await post({ action: 'stash-apply', index: 0 })).json()).ok, true);
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

test('stash-apply con índice no numérico -> ok:false', async () => {
  const { dir } = tmpRepo();
  const store = createStore();
  store.upsert({ id: 's1', cwd: dir, name: 'proj', status: 'working' });
  const { server } = createApp({ config, store });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/git/action?id=s1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer secret' },
    body: JSON.stringify({ action: 'stash-apply', index: 'x' }),
  });
  assert.equal((await res.json()).ok, false);
  server.close();
  rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd habitat && node --test server/index.test.js`
Expected: FAIL — `/git/stash` da 404.

- [ ] **Step 3: Implementar el server**

`import * as gitStash from './git-stash.js';`, endpoint análogo a `/git/branches`, y en el switch del lock:

```js
            case 'stash-push': return gitStash.stashPush(repo.dir, message);
            case 'stash-apply': return gitStash.stashApply(repo.dir, index);
            case 'stash-drop': return gitStash.stashDrop(repo.dir, index);
```

Agregar `index` al destructuring del body. No hace falta validarlo acá: `stashRef` exige entero ≥ 0 y devuelve `ok: false`.

- [ ] **Step 4: Implementar el cliente**

En `useGit.ts`:

```ts
export interface StashEntry { index: number; message: string }

  async function loadStash(id: string, path?: string): Promise<StashEntry[]> {
    const res = await fetch(`/git/stash?${q(id, path)}`, { headers: authHeaders() })
    if (!res.ok) return []
    return (await res.json()) as StashEntry[]
  }
```

En `GitPanel.vue`: agregar `const stash = ref<StashEntry[]>([])`, cargarlo en `refresh()` (`stash.value = await loadStash(props.id, props.path)`) y pasarlo a `GitWork` como `:stash="stash"`.

En `GitWork.vue`: prop `stash: StashEntry[]`, y la sección antes del commit:

```vue
    <div class="g-group">
      <h4>Stash ({{ props.stash.length }})
        <button class="g-mini" @click="emit('run', 'stash-push', { message: stashMsg })">guardar</button>
      </h4>
      <input v-model="stashMsg" class="gw-stash-msg" placeholder="etiqueta del stash (opcional)" />
      <ul>
        <li v-for="s in props.stash" :key="s.index">
          <span class="g-st">≡</span>
          <span class="gw-flat">{{ s.message }}</span>
          <button class="g-mini" @click="emit('run', 'stash-apply', { index: s.index })">aplicar</button>
          <button class="g-mini g-danger"
            @click="emit('run', 'stash-drop', { index: s.index }, 'Borrar este stash? No se puede deshacer.')">⌦</button>
        </li>
      </ul>
    </div>
```

Con `const stashMsg = ref('')` y los estilos `.gw-stash-msg` / `.gw-flat`.

- [ ] **Step 5: "Stashear y reintentar" en el checkout fallido**

En `GitPanel.vue`, `run()` ya guarda el resultado. Agregar el estado y la acción de recuperación:

```ts
// Cuando el checkout falla por árbol sucio, ofrecemos la salida útil en vez de
// dejar al usuario con un error de git.
const retry = ref<{ branch: string } | null>(null)

// dentro de run(), en el bloque de error:
  if (!r.ok) {
    actionErr.value = r.conflict ? `Conflicto en: ${(r.files ?? []).join(', ')}` : (r.message || 'falló')
    retry.value = r.dirty && name === 'checkout' ? { branch: payload.branch as string } : null
  } else {
    retry.value = null
  }

async function stashAndRetry() {
  const branch = retry.value?.branch
  if (!branch) return
  retry.value = null
  const s = await action(props.id, 'stash-push', { path: props.path, message: `auto antes de ir a ${branch}` })
  if (!s.ok) { actionErr.value = s.message || 'no se pudo stashear'; return }
  await run('checkout', { branch })
}
```

Y en el template, junto al error:

```vue
    <p v-if="retry" class="g-err">
      <button class="g-mini" @click="stashAndRetry">Stashear y reintentar</button>
    </p>
```

`GitActionResult` en `useGit.ts` suma `dirty?: boolean` y `branch?: string`.

- [ ] **Step 6: Verificar**

Run: `cd habitat && node --test server/index.test.js && cd client && npx vue-tsc --noEmit && npm run build`
Expected: PASS y build limpio.

En el navegador: modificar un archivo, guardar stash, verificar que aparece en la lista y que el árbol quedó limpio; aplicarlo y verificar que vuelve. Después: modificar un archivo que difiera entre dos ramas, intentar checkout, y verificar que aparece "Stashear y reintentar" y que funciona.

- [ ] **Step 7: Commit**

```bash
git add habitat/server habitat/client/src
git commit -m "feat(habitat): stash en la pestaña Trabajo y stashear-y-reintentar en checkout"
```

---

# Fase 5 — Fetch, amend, historial completo

### Task 15: `fetchRemote`, `amend` y `fullLog`

**Files:**
- Modify: `habitat/server/git-write.js`
- Test: `habitat/server/git-write.test.js`
- Modify: `habitat/server/git-read.js`
- Test: `habitat/server/git-read.test.js`

**Interfaces:**
- Produces:
  - `fetchRemote(cwd, exec)` → `{ ok, message? }` — `git fetch --all --prune`. Se llama `fetchRemote`, **no** `fetch`, para no pisar el `fetch` global de Node.
  - `amend(cwd, message, exec)` → `{ ok, message? }` — con `message` vacío usa `--no-edit`.
  - `parseFullLog(out)` → `[{ sha, shortSha, subject, author, date }]` — puro.
  - `fullLog(cwd, { limit, skip }, exec)` → el array anterior. **No** trae archivos por commit (el `commits()` existente hace un `git show` por commit y eso no escala a cientos).

- [ ] **Step 1: Escribir los tests que fallan**

En `habitat/server/git-write.test.js`:

```js
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
```

Agregar `fetchRemote, amend` al import de la línea 3.

En `habitat/server/git-read.test.js`:

```js
test('parseFullLog extrae sha, subject, autor y fecha', () => {
  const out = [
    'aaa111\x1faaa\x1fmi commit\x1fNico\x1f2026-08-05',
    'bbb222\x1fbbb\x1fotro\x1fNico\x1f2026-08-04',
  ].join('\n');
  assert.deepEqual(parseFullLog(out), [
    { sha: 'aaa111', shortSha: 'aaa', subject: 'mi commit', author: 'Nico', date: '2026-08-05' },
    { sha: 'bbb222', shortSha: 'bbb', subject: 'otro', author: 'Nico', date: '2026-08-04' },
  ]);
});

test('fullLog pasa -n y --skip y no pide archivos por commit', async () => {
  const calls = [];
  const exec = async (file, args) => { calls.push(args.join(' ')); return 'aaa\x1faa\x1fs\x1fN\x1f2026-08-05\n'; };
  const r = await fullLog('/proj', { limit: 50, skip: 100 }, exec);
  assert.equal(r.length, 1);
  assert.ok(calls[0].includes('-n 50'));
  assert.ok(calls[0].includes('--skip=100'));
  assert.equal(calls.length, 1); // un solo comando: nada de git show por commit
});
```

Agregar `parseFullLog, fullLog` al import de `./git-read.js`.

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd habitat && node --test server/git-write.test.js server/git-read.test.js`
Expected: FAIL — funciones no exportadas.

- [ ] **Step 3: Implementar**

En `git-write.js`:

```js
// 'fetchRemote' y no 'fetch': no pisar el fetch global de Node.
export async function fetchRemote(cwd, exec = defaultExec) {
  return gitOk(cwd, ['fetch', '--all', '--prune'], exec);
}

// Amend del último commit. Sin mensaje, mantiene el existente (--no-edit) para
// no abrir un editor en un contexto no interactivo.
export async function amend(cwd, message, exec = defaultExec) {
  const msg = typeof message === 'string' ? message.trim() : '';
  const args = msg ? ['commit', '--amend', '-m', msg] : ['commit', '--amend', '--no-edit'];
  return gitOk(cwd, args, exec);
}
```

En `git-read.js`:

```js
export function parseFullLog(out) {
  const rows = [];
  for (const line of String(out).split('\n')) {
    if (!line.trim()) continue;
    const [sha, shortSha, subject, author, date] = line.split('\x1f');
    if (!sha) continue;
    rows.push({ sha, shortSha, subject, author, date });
  }
  return rows;
}

// Historial completo del repo, paginado. A diferencia de commits(), NO trae los
// archivos de cada commit: eso es un `git show` por commit y con cientos de
// commits se vuelve inusable. El cliente los pide al expandir.
export async function fullLog(cwd, { limit = 50, skip = 0 } = {}, exec = defaultExec) {
  const n = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const s = Math.max(Number(skip) || 0, 0);
  try {
    return parseFullLog(await exec('git', [
      '-C', cwd, 'log', '--format=%H%x1f%h%x1f%s%x1f%an%x1f%as', '-n', String(n), `--skip=${s}`,
    ]));
  } catch { return []; }
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `cd habitat && node --test server/git-write.test.js server/git-read.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add habitat/server/git-write.js habitat/server/git-read.js habitat/server/git-write.test.js habitat/server/git-read.test.js
git commit -m "feat(habitat): fetchRemote, amend e historial completo paginado"
```

---

### Task 16: Endpoint `/git/log`, acciones `fetch` / `amend`, y UI

**Files:**
- Modify: `habitat/server/index.js`
- Test: `habitat/server/index.test.js`
- Modify: `habitat/client/src/composables/useGit.ts`
- Modify: `habitat/client/src/components/GitCommits.vue`
- Modify: `habitat/client/src/components/GitWork.vue`
- Modify: `habitat/client/src/components/GitPanel.vue`

**Interfaces:**
- Produces:
  - `GET /git/log?id=&path=&limit=&skip=` → `[{ sha, shortSha, subject, author, date }]`
  - Acciones `fetch` y `amend` (`{ message? }`).
  - `useGit()` suma `loadLog(id, path?, opts?: { limit?: number; skip?: number }): Promise<LogEntry[]>`.

- [ ] **Step 1: Escribir el test que falla**

```js
test('GET /git/log devuelve el historial y acota el limit', async () => {
  const { dir } = tmpRepo();
  const store = createStore();
  store.upsert({ id: 's1', cwd: dir, name: 'proj', status: 'working' });
  const { server } = createApp({ config, store });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/git/log?id=s1&limit=9999`, {
    headers: { authorization: 'Bearer secret' },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.length, 1);
  assert.equal(body[0].subject, 'inicial');
  server.close();
  rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd habitat && node --test server/index.test.js`
Expected: FAIL — 404.

- [ ] **Step 3: Implementar el server**

Endpoint nuevo (el clamp de `limit` vive en `fullLog`, así que acá sólo se pasan):

```js
    if (req.method === 'GET' && url.pathname === '/git/log') {
      if (!authorize(req, res)) return;
      const s = store.get(url.searchParams.get('id') || '');
      const repo = await resolveRepoOr(res, s, url);
      if (!repo) return;
      try {
        const out = await fullLog(repo.dir, {
          limit: url.searchParams.get('limit'),
          skip: url.searchParams.get('skip'),
        });
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
      } catch { res.writeHead(500).end(); }
      return;
    }
```

Agregar `fullLog` al import de `./git-read.js` y en el switch del lock:

```js
            case 'fetch': return gitWrite.fetchRemote(repo.dir);
            case 'amend': return gitWrite.amend(repo.dir, message);
```

- [ ] **Step 4: Implementar el cliente**

`useGit.ts`:

```ts
export interface LogEntry { sha: string; shortSha: string; subject: string; author: string; date: string }

  async function loadLog(id: string, path?: string, opts: { limit?: number; skip?: number } = {}): Promise<LogEntry[]> {
    const extra: Record<string, string> = {}
    if (opts.limit != null) extra.limit = String(opts.limit)
    if (opts.skip != null) extra.skip = String(opts.skip)
    const res = await fetch(`/git/log?${q(id, path, extra)}`, { headers: authHeaders() })
    if (!res.ok) return []
    return (await res.json()) as LogEntry[]
  }
```

`GitCommits.vue`: agregar props `{ id: string; path: string }` y un toggle entre las dos vistas. Al script existente (que ya tiene `props` y el emit `diff`) sumar:

```ts
import { ref, watch } from 'vue'
import { useGit, type LogEntry } from '../composables/useGit'

const { loadLog } = useGit()
const showAll = ref(false)
const log = ref<LogEntry[]>([])
const skip = ref(0)
const atEnd = ref(false)
const loadingMore = ref(false)
const PAGE = 50

async function loadMore() {
  loadingMore.value = true
  const rows = await loadLog(props.id, props.path, { limit: PAGE, skip: skip.value })
  log.value = skip.value === 0 ? rows : [...log.value, ...rows]
  skip.value += rows.length
  atEnd.value = rows.length < PAGE
  loadingMore.value = false
}

// Al cambiar de repo se descarta lo cargado: el historial es de otro repo.
watch(() => [props.id, props.path] as const, () => {
  log.value = []; skip.value = 0; atEnd.value = false
  if (showAll.value) loadMore()
})
watch(showAll, (on) => { if (on && !log.value.length) loadMore() })
```

Y al template, envolviendo la lista existente de `props.status.commits`:

```vue
  <div class="gc-toggle">
    <button class="g-mini" @click="showAll = !showAll">
      {{ showAll ? 'sólo mi rama' : 'historial completo' }}
    </button>
  </div>

  <template v-if="showAll">
    <div v-for="c in log" :key="c.sha" class="gc-row">
      <code>{{ c.shortSha }}</code> <span class="gc-subj">{{ c.subject }}</span>
      <div class="g-muted">{{ c.author }} · {{ c.date }}</div>
    </div>
    <p v-if="!log.length && !loadingMore" class="g-muted">sin commits</p>
    <button v-if="!atEnd" class="g-act" :disabled="loadingMore" @click="loadMore">
      {{ loadingMore ? 'cargando…' : 'cargar más' }}
    </button>
    <p v-else class="g-muted">fin del historial</p>
  </template>

  <template v-else>
    <!-- acá va el bloque existente: v-for sobre props.status.commits -->
  </template>
```

En la vista de historial completo no se listan archivos por commit a propósito: eso es un `git show` por commit y es justamente lo que `fullLog` evita. Los archivos siguen disponibles en la vista "sólo mi rama".

Estilo nuevo: `.gc-toggle { margin-bottom: .5rem; }`

`GitWork.vue`: agregar el botón amend junto al de commit, con aviso si el último commit ya está pusheado. El dato ya está en `status.commits[0].pushed`:

```vue
      <button class="g-act" @click="doAmend">amend</button>
```

```ts
function doAmend() {
  const last = props.status.commits[0]
  const warn = last?.pushed
    ? 'El último commit ya está pusheado: el amend reescribe historia y el próximo push va a ser rechazado (habría que forzarlo desde la terminal). Seguir?'
    : undefined
  emit('run', 'amend', { message: commitMsg.value }, warn)
  commitMsg.value = ''
}
```

`GitPanel.vue`: agregar el botón `Fetch` a la barra fija:

```vue
      <button class="g-act" :disabled="busy === 'fetch'" @click="run('fetch')">Fetch</button>
```

Y pasarle `:id` / `:path` a `GitCommits`.

- [ ] **Step 5: Verificar**

Run: `cd habitat && node --test server/index.test.js && cd client && npx vue-tsc --noEmit && npm run build`
Expected: PASS y build limpio.

En el navegador: `Fetch` no cambia el árbol pero actualiza `↑↓` del chip. En Commits, el toggle de historial completo pagina. El amend de un commit pusheado avisa antes.

- [ ] **Step 6: Commit**

```bash
git add habitat/server habitat/client/src
git commit -m "feat(habitat): fetch, amend e historial completo en la UI"
```

---

# Fase 6 — PR con `gh`

### Task 17: `gh.js`

**Files:**
- Create: `habitat/server/gh.js`
- Test: `habitat/server/gh.test.js`

**Interfaces:**
- Consumes: `currentBranch`, `remoteDefaultBranch`, `validBranch`, `defaultExec` de `git.js`.
- Produces: `prCreate(cwd, exec)` → `{ ok, url?, message? }`
  - Deriva `base` del default (sin el prefijo del remote) y `head` del branch actual.
  - Distingue `ENOENT` (gh no instalado), error de auth, y PR ya existente.

- [ ] **Step 1: Escribir los tests que fallan**

```js
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
```

Nota: `'HEAD'` pasa `validBranch`, así que hay que rechazarlo explícitamente — es el estado detached, donde un PR no tiene sentido.

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd habitat && node --test server/gh.test.js`
Expected: FAIL — no existe `./gh.js`.

- [ ] **Step 3: Implementar**

```js
import { currentBranch, remoteDefaultBranch, validBranch, defaultExec } from './git.js';

const firstUrl = (s) => (String(s).match(/https:\/\/\S+/) || [null])[0];

// Crea el PR con gh. No pushea por su cuenta: si falta pushear, el cliente
// deshabilita el botón. Tampoco intenta autenticar desde la web.
export async function prCreate(cwd, exec = defaultExec) {
  const head = await currentBranch(cwd, exec);
  if (!validBranch(head) || head === 'HEAD') return { ok: false, message: 'rama actual inválida (HEAD detached?)' };
  const def = await remoteDefaultBranch(cwd, exec); // 'origin/main'
  const slash = String(def).indexOf('/');
  const base = slash > 0 ? def.slice(slash + 1) : def;
  if (!validBranch(base)) return { ok: false, message: 'rama default inválida' };
  try {
    const out = await exec('gh', ['pr', 'create', '--base', base, '--head', head, '--fill'], { cwd });
    return { ok: true, url: firstUrl(out) || '' };
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      return { ok: false, message: 'gh no está instalado' };
    }
    const err = (e && ((e.stderr || '') + (e.stdout || ''))) || '';
    if (/gh auth login|not logged into/i.test(err)) {
      return { ok: false, message: 'gh no autenticado: corré `gh auth login` en la terminal' };
    }
    if (/already exists/i.test(err)) {
      return { ok: false, url: firstUrl(err) || '', message: 'ya existe un PR para esta rama' };
    }
    return { ok: false, message: String(err).split('\n').slice(0, 4).join('\n').slice(0, 500) };
  }
}
```

Ojo con el `exec`: las funciones git pasan `-C <dir>`, pero `gh` necesita correr **dentro** del repo. `defaultExec` en `git.js:10` es `(file, args) => run(file, args)` y descarta el tercer parámetro. Hay que ampliarlo en `git.js`:

```js
const defaultExec = async (file, args, opts) => (await run(file, args, opts)).stdout;
```

Es retrocompatible: `opts` undefined es el comportamiento actual.

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `cd habitat && node --test server/gh.test.js server/git.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add habitat/server/gh.js habitat/server/gh.test.js habitat/server/git.js
git commit -m "feat(habitat): gh.js, crear PR con mensajes claros de gh"
```

---

### Task 18: Acción `pr-create` y botón PR

**Files:**
- Modify: `habitat/server/index.js`
- Test: `habitat/server/index.test.js`
- Modify: `habitat/client/src/composables/gitBranches.ts`
- Test: `habitat/client/src/composables/gitBranches.test.ts`
- Modify: `habitat/client/src/components/GitPanel.vue`
- Modify: `habitat/client/src/composables/useGit.ts`

**Interfaces:**
- Produces:
  - Acción `pr-create` → `{ ok, url?, message? }`. `GitActionResult` suma `url?: string`.
  - `canCreatePr(overview: GitOverview)` → `{ can: boolean; why: string }` — `can: false` con `why` mostrable cuando la rama es la default o hay commits sin pushear.

- [ ] **Step 1: Escribir los tests que fallan**

En `gitBranches.test.ts`:

```ts
import { canCreatePr } from './gitBranches'

describe('canCreatePr', () => {
  const base = { branch: 'feature/x', default: 'origin/main', ahead: 0, behind: 0, files: [] }

  it('permite cuando la rama difiere del default y no hay nada sin pushear', () => {
    expect(canCreatePr({ ...base, files: [{ rel: 'a.js', status: 'M' }] })).toEqual({ can: true, why: '' })
  })

  it('advierte pero no bloquea si hay commits por delante del default', () => {
    const r = canCreatePr({ ...base, ahead: 2 })
    expect(r.can).toBe(true)
    expect(r.why).toMatch(/sin pushear/)
  })

  it('bloquea si estás en la rama default', () => {
    const r = canCreatePr({ ...base, branch: 'main' })
    expect(r.can).toBe(false)
    expect(r.why).toMatch(/default/)
  })
})
```

**Por qué `ahead > 0` advierte en vez de bloquear:** `ahead` en `branchOverview` cuenta commits por encima de `origin/<default>`, **no** los que faltan pushear. Con `ahead > 0` los commits pueden estar perfectamente pusheados a `origin/<branch>`. Bloquear con esa señal daría falsos negativos, y el cliente no tiene el dato de `origin/<branch>` para decidir mejor. Así que el único bloqueo real es estar en la rama default (un PR de main a main no existe); con commits por delante el botón queda habilitado y la advertencia va en el `title`, dejando que `gh` dé el error real si hace falta.

En `index.test.js`:

```js
test('POST /git/action pr-create devuelve ok:false con mensaje si no hay gh usable', async () => {
  const { dir } = tmpRepo();
  const store = createStore();
  store.upsert({ id: 's1', cwd: dir, name: 'proj', status: 'working' });
  const { server } = createApp({ config, store });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/git/action?id=s1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer secret' },
    body: JSON.stringify({ action: 'pr-create' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  // El repo temporal no tiene remoto: falla, pero con mensaje, no con 500.
  assert.equal(body.ok, false);
  assert.ok(typeof body.message === 'string' && body.message.length > 0);
  server.close();
  rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd habitat && node --test server/index.test.js && cd client && npx vitest run src/composables/gitBranches.test.ts`
Expected: FAIL — `canCreatePr` no existe, `pr-create` da 400.

- [ ] **Step 3: Implementar**

En `index.js`: `import { prCreate } from './gh.js';` y en el switch del lock:

```js
            case 'pr-create': return prCreate(repo.dir);
```

En `gitBranches.ts`:

```ts
import type { GitOverview } from './useGit'

// El botón sólo se bloquea de verdad estando en la rama default (un PR de main a
// main no existe). Con commits por delante advierte pero deja intentar: `ahead`
// cuenta contra el default, no contra origin/<branch>, así que no alcanza para
// afirmar que falta pushear.
export function canCreatePr(overview: GitOverview): { can: boolean; why: string } {
  const def = overview.default.slice(overview.default.indexOf('/') + 1)
  if (overview.branch === def) return { can: false, why: `estás en la rama default (${def})` }
  if (overview.ahead > 0) return { can: true, why: `${overview.ahead} commit(s) sin pushear: pusheá primero si gh falla` }
  return { can: true, why: '' }
}
```

En `useGit.ts`: `GitActionResult` suma `url?: string`.

En `GitPanel.vue`, la barra fija:

```vue
      <button class="g-act" :disabled="busy === 'pr-create' || !pr.can" :title="pr.why"
        @click="doPr">PR</button>
```

```ts
import { canCreatePr } from '../composables/gitBranches'

const pr = computed(() => (status.value ? canCreatePr(status.value.overview) : { can: false, why: '' }))
const prUrl = ref('')

async function doPr() {
  busy.value = 'pr-create'; actionErr.value = ''; prUrl.value = ''
  const r = await action(props.id, 'pr-create', { path: props.path })
  busy.value = ''
  if (r.url) prUrl.value = r.url
  if (!r.ok) actionErr.value = r.message || 'no se pudo crear el PR'
  await refresh()
}
```

Y el link del resultado, junto al error:

```vue
    <p v-if="prUrl" class="gp-pr"><a :href="prUrl" target="_blank" rel="noopener">{{ prUrl }}</a></p>
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `cd habitat && node --test server/index.test.js && cd client && npx vitest run src/composables && npx vue-tsc --noEmit && npm run build`
Expected: PASS y build limpio.

- [ ] **Step 5: Commit**

```bash
git add habitat/server habitat/client/src
git commit -m "feat(habitat): crear PR con gh desde la barra de acciones"
```

---

### Task 19: Verificación final, README y PR

**Files:**
- Modify: `habitat/README.md`, `README.md`, `README.es.md` (donde documenten `HABITAT_ALLOW_GIT_WRITE`)

- [ ] **Step 1: Sacar `HABITAT_ALLOW_GIT_WRITE` de la documentación**

Run: `grep -rn "ALLOW_GIT_WRITE" --include=*.md . | grep -v docs/superpowers`
Borrar las menciones que queden (el flag ya no existe) y, donde se listen las capacidades del panel git, agregar branches / stash / fetch / amend / historial / PR.

- [ ] **Step 2: Correr todos los tests de los módulos tocados**

```bash
cd habitat && node --test \
  server/git.test.js server/git-read.test.js server/git-write.test.js \
  server/git-branches.test.js server/git-stash.test.js server/gh.test.js \
  server/locks.test.js server/config.test.js server/index.test.js
cd client && npx vitest run && npx vue-tsc --noEmit && npm run build
```

Expected: todo PASS. **No** correr `node --test` sin argumentos: hay 5 módulos que fallan por `pngjs`/`ws` faltantes, previo y ajeno a este trabajo.

- [ ] **Step 3: Verificación manual completa**

`systemctl --user restart habitat`, y en Artisano (proyecto contenedor):

1. `🗂 Proyecto` → navegar a `back` → el chip dice `repo: back` y el status es el de ese repo.
2. Barra fija: `↻ Actualizar` trae el default. `Fetch` actualiza `↑↓`.
3. `Branches`: la actual con `*`, las tomadas con "abierta en X" no clickeables, checkout de una libre funciona.
4. `Trabajo`: stagear, commitear, guardar y aplicar un stash.
5. Sucia el árbol e intentar checkout a una rama que toque el mismo archivo → "Stashear y reintentar" funciona.
6. `Commits`: toggle a historial completo, paginar.
7. `PR`: en la rama default el botón está deshabilitado con el motivo en el `title`.

- [ ] **Step 4: Sincronizar con main y hacer el PR**

Obligatorio por `CLAUDE.md` antes de cerrar:

```bash
git fetch origin
git merge origin/main
# resolver conflictos si hay, y re-correr los tests del Step 2
git push origin <branch>
gh pr create --base main --head <branch>
```

- [ ] **Step 5: Commit final si hubo ajustes**

```bash
git commit -am "docs(habitat): documentar la GUI de git y sacar ALLOW_GIT_WRITE" || echo "sin cambios"
```
