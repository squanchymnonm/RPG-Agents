import { currentBranch, remoteDefaultBranch, validBranch, defaultExec } from './git.js';
import { trimErr } from './git-write.js';

// Extrae la URL del *PR*, no la primera URL del texto: gh mete de todo antes
// (banner de "hay una versión nueva de gh", link al manual, etc.) y una URL
// cualquiera ahí adelante ganaría con un regex sin anclar. Anclado a /pull/<n>
// además evita arrastrar puntuación pegada al final ("...).", el paréntesis
// y el punto quedaban dentro del link).
const prUrl = (s) => (String(s).match(/https:\/\/\S*?\/pull\/\d+/) || [null])[0];

// remoteDefaultBranch siempre usa el remoto 'origin' explícitamente (lee/setea
// refs/remotes/origin/HEAD), así que cuando resuelve bien devuelve algo con ese
// prefijo literal ('origin/main'). Si no hay origin/HEAD y tampoco se puede
// resolver, cae a currentBranch(cwd) tal cual, sin prefijo: pelar por la
// primera '/' a ciegas ahí mutila un nombre de rama con barras (p.ej.
// 'feature/x' -> 'x'), que además puede coincidir con una rama real y abrir el
// PR contra una base equivocada.
const REMOTE_PREFIX = 'origin/';

// Crea el PR con gh. No pushea por su cuenta: si falta pushear, el cliente
// deshabilita el botón. Tampoco intenta autenticar desde la web.
export async function prCreate(cwd, exec = defaultExec) {
  const head = await currentBranch(cwd, exec);
  if (!validBranch(head) || head === 'HEAD') return { ok: false, message: 'rama actual inválida (HEAD detached?)' };
  const def = String(await remoteDefaultBranch(cwd, exec)); // 'origin/main', o la rama actual si no hay origin/HEAD
  const base = def.startsWith(REMOTE_PREFIX) ? def.slice(REMOTE_PREFIX.length) : def;
  // Sin origin/HEAD resoluble, remoteDefaultBranch cae a currentBranch(cwd): la
  // misma rama que head. No inventamos una base con eso: mejor avisar que abrir
  // un PR contra sí misma (gh fallaría igual, con un mensaje mucho más críptico).
  if (!validBranch(base) || base === head) {
    return { ok: false, message: 'no se pudo determinar la rama base del PR (¿falta configurar el remoto o origin/HEAD?)' };
  }
  try {
    const out = await exec('gh', ['pr', 'create', '--base', base, '--head', head, '--fill'], { cwd });
    return { ok: true, url: prUrl(out) || '' };
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      return { ok: false, message: 'gh no está instalado' };
    }
    const err = (e && ((e.stderr || '') + (e.stdout || ''))) || '';
    if (/gh auth login|not logged into/i.test(err)) {
      return { ok: false, message: 'gh no autenticado: corré `gh auth login` en la terminal' };
    }
    if (/already exists/i.test(err)) {
      return { ok: false, url: prUrl(err) || '', message: 'ya existe un PR para esta rama' };
    }
    // Fallback genérico: reusar trimErr (ya usado en el resto del server) en vez
    // de reimplementar el recorte con otros límites. A diferencia de `err` (que
    // sólo mira stdout/stderr), trimErr cae a e.message si stderr viene vacío
    // (EACCES, ENOTFOUND, timeout, killed), así el mensaje nunca queda "".
    return { ok: false, message: trimErr(e) };
  }
}
