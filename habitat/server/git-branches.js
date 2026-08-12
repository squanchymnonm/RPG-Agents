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
