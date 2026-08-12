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
