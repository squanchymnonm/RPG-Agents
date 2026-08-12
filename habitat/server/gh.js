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
