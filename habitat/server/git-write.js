import {
  validBranch, remoteDefaultBranch, currentBranch, defaultExec,
  REMOTE_PREFIX, NET_OPTS,
} from './git.js';

function safePaths(rels) {
  if (!Array.isArray(rels) || rels.length === 0) return null;
  for (const r of rels) { if (typeof r !== 'string' || !r || r.startsWith('-')) return null; }
  return rels;
}

// `killed` lo marca execFile cuando mata al proceso por vencer el `timeout`: el
// error nativo es un 'Command failed: git …' con stderr vacío, que no dice nada
// del vencimiento. Lo traducimos acá para que el panel muestre algo accionable
// (lo aprovechan también pull, mergeDefault y gh.js, que reusan trimErr).
export function timedOut(e) {
  return !!(e && e.killed);
}

function trimErr(e) {
  if (timedOut(e)) return 'la operación tardó demasiado y se canceló (¿remoto inalcanzable o red caída?)';
  const s = (e && (e.stderr || e.message)) || '';
  return String(s).split('\n').slice(0, 6).join('\n').slice(0, 800);
}

// `opts` se pasa tal cual al exec: undefined para los comandos locales, NET_OPTS
// (timeout) para los que tocan la red.
async function gitOk(cwd, args, exec, opts) {
  try { await exec('git', ['-C', cwd, ...args], opts); return { ok: true }; }
  catch (e) {
    const r = { ok: false, code: e && e.code, message: trimErr(e) };
    if (timedOut(e)) r.timeout = true; // lo mira push() para no reintentar sobre un remoto colgado
    return r;
  }
}

export async function stage(cwd, rels, exec = defaultExec) {
  const p = safePaths(rels); if (!p) return { ok: false, message: 'paths inválidos' };
  return gitOk(cwd, ['add', '--', ...p], exec);
}

export async function unstage(cwd, rels, exec = defaultExec) {
  const p = safePaths(rels); if (!p) return { ok: false, message: 'paths inválidos' };
  return gitOk(cwd, ['restore', '--staged', '--', ...p], exec);
}

export async function discard(cwd, rels, exec = defaultExec) {
  const p = safePaths(rels); if (!p) return { ok: false, message: 'paths inválidos' };
  return gitOk(cwd, ['restore', '--', ...p], exec);
}

export async function commit(cwd, message, exec = defaultExec) {
  if (typeof message !== 'string' || !message.trim()) return { ok: false, message: 'mensaje vacío' };
  return gitOk(cwd, ['commit', '-m', message], exec);
}

export async function push(cwd, exec = defaultExec) {
  const first = await gitOk(cwd, ['push'], exec, NET_OPTS);
  if (first.ok) return first;
  // Si el primer push venció por timeout, el reintento va a vencer igual y duplica
  // el tiempo que el lock del repo queda tomado: cortamos acá.
  if (first.timeout) return first;
  // Sin upstream: reintentar con -u origin <branch>. El branch se deriva del repo
  // real, no del cacheado en la sesión: tras un checkout o en un sub-repo el de la
  // sesión es el equivocado.
  const branch = await currentBranch(cwd, exec);
  if (!validBranch(branch)) return first;
  return gitOk(cwd, ['push', '-u', 'origin', branch], exec, NET_OPTS);
}

async function conflictResult(cwd, exec) {
  let files = [];
  try {
    const z = await exec('git', ['-C', cwd, 'diff', '--name-only', '--diff-filter=U', '-z']);
    files = String(z).split('\0').filter(Boolean);
  } catch { /* dejar [] */ }
  return { ok: false, conflict: true, files };
}

function isConflict(e) {
  const out = (e && ((e.stdout || '') + (e.stderr || ''))) || '';
  return /CONFLICT|Automatic merge failed|Merge conflict/i.test(out);
}

export async function pull(cwd, exec = defaultExec) {
  try { await exec('git', ['-C', cwd, 'pull', '--no-edit'], NET_OPTS); return { ok: true }; }
  catch (e) { return isConflict(e) ? conflictResult(cwd, exec) : { ok: false, code: e && e.code, message: trimErr(e) }; }
}

export async function mergeDefault(cwd, exec = defaultExec) {
  const def = String(await remoteDefaultBranch(cwd, exec)); // 'origin/main', o la rama actual si no hay origin/HEAD
  // Contrato dual de remoteDefaultBranch (ver REMOTE_PREFIX en git.js): sin
  // origin/HEAD resoluble cae a la rama actual, SIN prefijo de remoto. Pelar por la
  // primera '/' a ciegas ahí hacía que `mergeDefault` en 'main' mergeara main con
  // main (ok:true sin traer nada: el botón "↻ Actualizar" era un no-op silencioso) y
  // que en 'feature/x' intentara `fetch feature x` ("'feature' does not appear to be
  // a git repository"). Mejor avisar que mergear contra una base inventada.
  if (!def.startsWith(REMOTE_PREFIX)) {
    return { ok: false, message: 'no se pudo determinar la rama default del remoto (¿falta configurar el remoto o origin/HEAD?)' };
  }
  const remote = REMOTE_PREFIX.slice(0, -1);
  const name = def.slice(REMOTE_PREFIX.length);
  if (!validBranch(name)) return { ok: false, message: 'rama default inválida' };
  try { await exec('git', ['-C', cwd, 'fetch', remote, name], NET_OPTS); }
  catch (e) { return { ok: false, code: e && e.code, message: trimErr(e) }; }
  // El merge es local: no necesita timeout (no puede colgarse en la red).
  try { await exec('git', ['-C', cwd, 'merge', '--no-edit', def]); return { ok: true }; }
  catch (e) { return isConflict(e) ? conflictResult(cwd, exec) : { ok: false, code: e && e.code, message: trimErr(e) }; }
}

export async function abort(cwd, exec = defaultExec) {
  return gitOk(cwd, ['merge', '--abort'], exec);
}

// 'fetchRemote' y no 'fetch': no pisar el fetch global de Node.
export async function fetchRemote(cwd, exec = defaultExec) {
  return gitOk(cwd, ['fetch', '--all', '--prune'], exec, NET_OPTS);
}

// Amend del último commit. Sin mensaje, mantiene el existente (--no-edit) para
// no abrir un editor en un contexto no interactivo.
export async function amend(cwd, message, exec = defaultExec) {
  const msg = typeof message === 'string' ? message.trim() : '';
  const args = msg ? ['commit', '--amend', '-m', msg] : ['commit', '--amend', '--no-edit'];
  return gitOk(cwd, args, exec);
}

export { defaultExec, validBranch, remoteDefaultBranch, trimErr, gitOk, NET_OPTS };
