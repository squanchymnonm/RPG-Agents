# GUI de git en la vista de proyecto, scopeada al repo donde estás parado

## Problema

Hábitat ya tiene lectura y escritura de git (`ChangesPanel`, `/git/status`,
`/git/action`), pero con tres limitaciones que la vuelven inusable en la
práctica:

1. **No se puede llegar al botón.** Las acciones de escritura están detrás de
   `HABITAT_ALLOW_GIT_WRITE` (default off) y el server de producción corre sin
   ese flag, así que `canWrite()` es `false` y `ChangesPanel.vue:140` esconde
   toda la fila (Push / Pull / Merge default). El botón existe en el código y
   nunca se dibuja. Y aun con el flag prendido, está a tres toques: abrir
   Cambios → pestaña Rama → botón.

2. **Un solo repo por sesión.** Todos los endpoints git usan `s.cwd` clavado.
   En un proyecto contenedor como Artisano (sub-repos `back`, `front`,
   `server`), sólo se puede gestionar el repo padre; los tres hijos quedan
   fuera de alcance y sin aviso.

3. **No se puede cambiar de branch.** Falta lo más básico de una GUI de git:
   listar branches, hacer checkout, crear una nueva. Tampoco hay stash, fetch
   suelto, amend, ni historial más allá de los commits que están por encima del
   default.

Al mismo tiempo existe una vista de proyecto (`ProjectExplorer`, Feature 2) que
ya navega todo el árbol del worktree y sabe en qué carpeta estás — exactamente
el contexto que le falta a git.

## Objetivo

Que la **vista de proyecto** sea el lugar donde se gestiona git, **scopeado al
repo que contiene la carpeta donde estás parado**. Parado en `back/src` gestionás
el repo `back`; parado en `docs/` gestionás el worktree padre.

Alcance de "gestionar": lo que ya hay (status, diff, stage/unstage/discard,
commit, push, pull, merge default, abortar merge, log) más lo que falta:

- **Branches**: listar locales y remotas, checkout, crear.
- **Stash**: guardar, listar, aplicar, borrar.
- **Fetch** suelto, **amend** del último commit, **historial completo** del repo.
- **Crear PR** con `gh`.

Y que la acción que originó todo esto — *traer el default actualizado a mi
branch de trabajo* — esté a un toque y siempre visible.

## Decisiones de diseño (acordadas en brainstorming)

- **Se elimina el gate `HABITAT_ALLOW_GIT_WRITE`.** No protegía nada: la
  terminal ya expone shell arbitrario bajo la misma autenticación
  (`HABITAT_USER` + hash scrypt + token de sesión). Un gate sobre `git commit`
  mientras `/term` deja correr cualquier comando es seguridad de utilería.
  `HABITAT_ALLOW_SPAWN` queda intacto: eso sí crea worktrees y sesiones tmux.

- **El scope de repo se resuelve por path, no por sesión.** Un helper único
  (`resolveRepo`) traduce `(s.cwd, pathRelativo)` al repo efectivo. Todos los
  endpoints git pasan por ahí.

- **Vista de proyecto con pestañas `Archivos | Git`.** Una sola vista, no dos
  overlays que van y vienen. El header muestra siempre qué repo y qué branch
  estás tocando.

- **Las acciones frecuentes van en una barra fija**, visible desde cualquier
  sub-pestaña, no enterradas en una de ellas. Es la corrección directa al
  problema 1.

- **Stash vive en la pestaña Trabajo**, no en una pestaña propia: es trabajo sin
  commitear. Evita una quinta pestaña en una UI que se usa en tablet.

- **Sin force-push desde la web.** `amend` se permite (con aviso si el commit ya
  está pusheado), pero reescribir historia remota queda para la terminal.

- **Nada de encadenar acciones implícitas.** Si falta pushear para crear el PR,
  el botón lo dice y se deshabilita; no pushea por su cuenta.

## Arquitectura

### `resolveRepo(cwd, rel)` — nuevo helper en `git.js`

Único punto de verdad para el scope. Todos los endpoints git lo usan:

1. `resolveWithinRoot(s.cwd, rel)` → aborta si el path escapa del worktree.
2. `git -C <target> rev-parse --show-toplevel` → el repo que **contiene** ese
   path.
3. `realpath` de toplevel **y** de `s.cwd`, y verificar contención. Sin este
   paso, un symlink dentro del worktree podría resolver a un repo de afuera;
   `--show-toplevel` no garantiza forma canónica.
4. Devuelve `{ dir, rel, name }` — `dir` para los comandos git, `rel`/`name`
   para el chip de la UI.

### Módulos nuevos y extendidos

Respeta el split existente (`git.js` compartido / `git-read.js` lectura /
`git-write.js` escritura) y mantiene los archivos chicos y enfocados:

| Módulo | Responsabilidad |
|---|---|
| `git-branches.js` (nuevo) | `listBranches` (con `%(worktreepath)` → detecta ocupadas), `checkout`, `createBranch` |
| `git-stash.js` (nuevo) | `stashPush`, `stashList`, `stashApply`, `stashDrop` |
| `gh.js` (nuevo) | `prCreate` — es `gh`, no `git`; va aparte |
| `git-write.js` (+) | `fetch` suelto, `amend` |
| `git-read.js` (+) | `fullLog` paginado |
| `git.js` (+) | `resolveRepo` |

Los helpers de parseo se exportan puros (patrón de `parsePorcelain` /
`parseNameStatus`) para testearlos sin tocar disco.

### API

```
GET  /git/status?id=&path=     → + repo:{rel,name}; se va canWrite
GET  /git/branches?id=&path=   → { current, default,
                                   local:[{name,worktree,current}], remote:[] }
GET  /git/stash?id=&path=      → [{ index, message }]
GET  /git/log?id=&path=&limit=&skip=
GET  /git/diff?id=&path=&file=&base=
POST /git/action?id=&path=     → + checkout, branch-create, fetch, amend,
                                  stash-push, stash-apply, stash-drop, pr-create
GET  /tree                     → + isRepo por entrada
```

`branches` y `stash` van en endpoints separados y **no** dentro de
`/git/status`: `status` se re-pollea con debounce en cada broadcast WS
(`ChangesPanel.vue:46`) y no vale pagar dos comandos git extra por tick. Se
cargan al abrir su pestaña.

`/tree` suma `isRepo` por entrada para dibujar el badge `git` en las carpetas
que son repos (el patrón ya existe en `index.js:219`, para el browser de
proyectos).

### Lock por repo

Dos acciones git simultáneas sobre el mismo repo producen errores de
`index.lock`. El `busy` del cliente serializa dentro de un panel, pero no cubre
dos pestañas ni dos clientes. Un mapa de promesas por `repo.dir` en el server
serializa las escrituras y devuelve `409` si hay una en curso.

### Bug que se arregla de paso

`index.js:369` hace `push(s.cwd, s.branch)` con el branch cacheado de la sesión.
Queda stale tras un checkout, y en un sub-repo es directamente el branch
equivocado. Pasa a derivarse con `currentBranch(repo.dir)`.

## UI

```
+--------------------------------------------------------+
| Proyecto    Artisano / back / src                  [x] |
| repo: back   * main   ^2 v3   (click -> Branches)      |
+--------------------------------------------------------+
| [ Archivos ]  [ Git ]                                  |
+--------------------------------------------------------+
| Trabajo | Branches | Commits | Rama                    |
|                                                        |
|  En conflicto (0)                                      |
|  Staged (1)                                            |
|    M  src/api.ts                                  [-]  |
|  Sin stagear (2)                        [+ stagear all]|
|    M  src/db.ts                            [+]  [del]  |
|    ?  notas.md                             [+]         |
|                                                        |
|  v Stash (1)                              [guardar]    |
|    stash@{0}  wip: refactor api    [aplicar] [borrar]  |
|                                                        |
|  [mensaje de commit__________________]  [Commit]       |
|                                         [amend]        |
+--------------------------------------------------------+
|  [^ Actualizar]  [Pull]  [Push]  [Fetch]  [PR]         |  <- fija
+--------------------------------------------------------+
```

`↻ Actualizar` es `merge-default` (fetch del default + merge en tu branch): el
pedido que originó este spec, ahora a un toque desde cualquier sub-pestaña.

### Componentes

`ChangesPanel.vue` ya tiene 228 líneas; con branches, stash, historial y PR se
vuelve inmanejable. Se parte:

| Componente | Responsabilidad |
|---|---|
| `ProjectExplorer.vue` | Shell: header, breadcrumbs, chip de repo, pestañas `Archivos \| Git`. **Dueño del `path` actual** |
| `ProjectFiles.vue` (nuevo) | El body actual del explorer (lista + preview + nvim), extraído tal cual |
| `GitPanel.vue` (nuevo) | Shell git: sub-pestañas, barra de acciones fija, estado busy/error, refresh |
| `GitWork.vue` (nuevo) | Conflictos, staged, unstaged, untracked, commit, amend, stash |
| `GitBranches.vue` (nuevo) | Lista de branches, checkout, crear |
| `GitCommits.vue` (nuevo) | Commits sobre el default + historial completo paginado |
| `GitBranchDiff.vue` (nuevo) | Pestaña "Rama": archivos que difieren del default (read-only). Es el contenido actual de esa pestaña menos los botones, que se van a la barra fija |
| `GitDiff.vue` (nuevo) | El visor de diff, hoy embebido en `ChangesPanel` |

`ProjectExplorer` es dueño del `path`; `GitPanel` lo recibe como prop y
re-fetchea cuando cambia. Flujo en una sola dirección, sin estado compartido.

**`ChangesPanel.vue` se elimina** como overlay independiente. El botón
`⌥ Cambios` de las dtools queda, pero abre Proyecto directo en la pestaña Git
con `path=''` — git de la sesión a un toque. `DetailPanel` pierde un overlay y
una variable de estado.

**`useGitChanges.ts` → `useGit.ts`**: ya no es sólo "changes". Suma
`loadBranches`, `loadStash`, `loadLog`, y `path` atravesando todas las llamadas.

### Lista de branches

```
Branches                                    [+ nueva]
  buscar: [_________]
* link                                       (actual)
  main                                          v3
  ciri
  dante                            abierta en dante
  feat/habitat-file-browser        abierta en cloud
  --- remotas ---
  origin/shepard                      [crear local]
```

Las branches ocupadas por otro worktree salen deshabilitadas con el nombre de la
sesión que las tiene (basename del `worktreepath`), en vez de dejarte tocar y
comerte un error de git. Crear branch: input + selector `desde: default | HEAD`.

### Tablet

Los botones de la barra fija van con target táctil ≥44px y wrap en angosto. El
`@media (max-width: 640px)` que ya apila el explorer se extiende a las
sub-pestañas.

## Casos borde

### Checkout (donde está el riesgo real)

| Caso | Respuesta |
|---|---|
| Branch ocupada por otro worktree | Deshabilitada en UI **y** rechazada en el server antes de invocar git. Dos capas, porque la lista del cliente puede estar stale |
| Árbol sucio con colisión | git falla con "local changes would be overwritten" → se detecta ese error y el mensaje ofrece **"Stashear y reintentar"** (stash-push + checkout). Si no hay colisión, git arrastra los cambios: comportamiento normal de git, se deja |
| Merge en curso | git rechaza → mensaje con acceso directo a "Abortar merge", que ya existe |
| `s.branch` stale tras el checkout | La respuesta trae el branch nuevo, el cliente refresca y el server actualiza el store. `hooks-logic.js:106` lo reconfirma en el próximo evento |

**Consecuencia explícita:** tras un checkout, la sesión `link` puede quedar
parada en branch `main`, porque el directorio del worktree conserva el nombre
del personaje. Sesión y branch dejan de coincidir. Es el estado honesto y va en
línea con el `branch fiel` que ya existe, pero es un cambio conceptual: hasta
hoy sesión = branch por construcción.

### Resolución de path

- Symlink que sale del worktree → `400`.
- `s.cwd` no es repo → `409` "sin repo git acá", y la pestaña Git muestra ese
  estado en vez de romperse.
- Navegar dentro de `.git/` (el árbol lista todo, sin filtro) → `rev-parse`
  falla ahí → `409` con mensaje claro. El badge `isRepo` no se dibuja sobre
  `.git`.

### PR con `gh`

- `ENOENT` → "gh no está instalado". Error de auth → "gh no autenticado, corré
  `gh auth login` en la terminal". No se intenta autenticar desde la web.
- PR ya existente → se muestra la URL que devuelve `gh`.
- **Sin pushear** → botón deshabilitado con "pusheá primero", en vez de
  encadenar un push implícito. Además evita que `gh` se cuelgue pidiendo
  confirmación en un contexto no interactivo.

### Destructivo

- `amend` de un commit ya pusheado: permitido con aviso previo. **No** se expone
  force-push.
- `discard`, `stash-drop`: `confirm()`, como ya hace `run(..., confirmMsg)`.

### Performance

`git-read.js:commits` hace un `git show --name-status` **por commit**. Sobre
`default..HEAD` está acotado, pero para historial completo serían cientos de
invocaciones. `fullLog` trae sólo el log y pide los archivos on-demand al
expandir un commit. `limit`/`skip` validados como enteros acotados (limit ≤ 200).

## Testing

**Server** — patrón existente: `exec` inyectado, `node --test`, helpers de
parseo puros.

- `resolveRepo`: dentro del root, subdir, symlink que escapa, inexistente,
  `.git`, cwd no-repo.
- `git-branches`: parseo de `git branch --format` con y sin `worktreepath`,
  actual, remotas; `checkout` rechaza ocupada; `createBranch` valida con
  `validBranch`.
- `git-stash`: parseo de `stash list`, índice validado (`stash@{N}`, N entero).
- `gh.js`: `ENOENT` vs error de auth vs PR existente.
- `git-write`: `fetch`, `amend`, y `push` derivando el branch del repo real.
- Endpoints: `400` por path que escapa, `409` sin repo, `409` por lock.
- **`index.test.js:1099` hay que tocarlo**: hoy testea el `403` con el flag off,
  y ese gate se elimina.

**Cliente** — los helpers nuevos van a archivo propio con test, siguiendo
`parseDiff.test.ts`: agrupado de branches (locales / remotas / ocupadas) y el
predicado de "¿puedo crear PR?". Los `.vue` no tienen tests hoy salvo
`GameSprite`, así que no se monta infra de component testing en esta tanda.

**Validación**: hay 5 módulos del server que fallan por `pngjs`/`ws` faltantes,
previos y ajenos a este trabajo. Se corre `node --test` sobre los módulos
tocados y se reporta eso, sin mezclarlo con ruido pre-existente.

## Orden de implementación

El spec es grande (3 módulos de server nuevos, 8 acciones nuevas, 7 componentes),
así que el orden importa: cada paso deja algo funcionando y testeable.

1. **`resolveRepo` + `path` en los endpoints existentes + baja del gate.** Sin UI
   nueva: `ChangesPanel` sigue como está pero ya scopeado y visible. Sólo con
   esto el problema original queda resuelto.
2. **Split de componentes**: `ProjectExplorer` con pestañas, `ChangesPanel` →
   `GitPanel` + `GitWork` / `GitBranchDiff` / `GitCommits` / `GitDiff`, y la
   barra de acciones fija. Refactor sin features nuevas.
3. **Branches**: `git-branches.js` + `GitBranches.vue` + checkout y crear.
4. **Stash**: `git-stash.js` + la sección en `GitWork`. Habilita el
   "stashear y reintentar" del checkout, que depende del paso 3.
5. **Fetch, amend, historial completo.**
6. **PR con `gh`.**

Los pasos 3–6 son independientes entre sí salvo la dependencia de 4 sobre 3.

## Fuera de alcance

- Force-push, rebase, cherry-pick, tags, resolución de conflictos desde la web
  (los conflictos se detectan y se listan; se resuelven en la terminal o en
  nvim, que ya está integrado).
- Gestión de remotes (agregar, renombrar).
- Actualizar la branch default local del checkout principal del proyecto:
  `merge-default` trabaja sobre el worktree de la sesión.
- Sincronizar el nombre del worktree con el branch tras un checkout.
- Tests de componentes `.vue`.
