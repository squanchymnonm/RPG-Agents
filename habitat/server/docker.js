import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { normalize, sep } from 'node:path';

const run = promisify(execFile);
const defaultExec = async (file, args) => (await run(file, args)).stdout;

// Un container de compose siempre lleva el proyecto y el directorio desde donde se
// levantó. Ese working_dir es lo que nos deja atribuir un stack a una sesión: si cae
// dentro del worktree, lo levantó esa sesión. TAB literal como separador (ni el nombre
// de proyecto ni un path razonable lo contienen).
export const PS_FORMAT = '{{.Label "com.docker.compose.project"}}\t{{.Label "com.docker.compose.project.working_dir"}}';

// Path normalizado y sin barra final. '' / basura => '' (nunca un path utilizable).
const norm = (p) => {
  const s = String(p || '').trim();
  if (!s) return '';
  const n = normalize(s);
  if (n === '.' || n === '..' || n.startsWith(`..${sep}`)) return '';
  return n.length > 1 && n.endsWith(sep) ? n.slice(0, -1) : n;
};

// ¿`dir` está dentro de `parent`? Contención real por segmento: /a/b NO contiene a /a/bc.
const inside = (dir, parent, { strict = false } = {}) => {
  const d = norm(dir);
  const p = norm(parent);
  if (!d || !p || p === sep) return false;
  if (d === p) return !strict;
  return d.startsWith(p + sep);
};

// Stacks de compose visibles para el daemon (containers vivos y parados), uno por
// proyecto. Best-effort: sin docker instalado o sin daemon, [].
export async function listStacks(exec = defaultExec) {
  let out;
  try {
    out = await exec('docker', ['ps', '-a', '--format', PS_FORMAT]);
  } catch {
    return [];
  }
  const seen = new Set();
  const stacks = [];
  for (const line of String(out).split('\n')) {
    const [project, dir] = line.split('\t');
    const p = (project || '').trim();
    const d = norm(dir);
    if (!p || !d || seen.has(p)) continue;
    seen.add(p);
    stacks.push({ project: p, dir: d });
  }
  return stacks;
}

// Nombres de proyecto de los stacks levantados dentro de `dir` (o de un subdirectorio).
export async function stacksForDir(dir, exec = defaultExec) {
  if (!norm(dir)) return [];
  const stacks = await listStacks(exec);
  return stacks.filter((s) => inside(s.dir, dir)).map((s) => s.project);
}

// `docker compose down` por nombre de proyecto: compose resuelve containers y red por
// labels, así que no necesita el docker-compose.yml (clave: al cerrar la sesión el
// worktree se borra y el archivo se va con él). SIN -v: los volúmenes con datos quedan.
export async function composeDown(project, exec = defaultExec) {
  try {
    await exec('docker', ['compose', '-p', project, 'down', '--remove-orphans']);
    return true;
  } catch {
    return false;
  }
}

// Baja los stacks de un worktree. `root` (WORKTREES_DIR) es el cerco: sólo tocamos algo
// estrictamente dentro de él, para no bajar jamás un stack de producción ni el entorno
// de desarrollo del repo principal. Devuelve los proyectos bajados.
export async function downForDir(dir, { root, exec = defaultExec, dryRun = false } = {}) {
  if (!inside(dir, root, { strict: true })) return [];
  const projects = await stacksForDir(dir, exec);
  if (dryRun) return projects;
  const done = [];
  for (const p of projects) {
    if (await composeDown(p, exec)) done.push(p);
  }
  return done;
}

// Barrido de huérfanos: stacks que viven bajo `root` pero cuyo worktree ya no existe en
// disco (sesión cerrada antes de tener esta limpieza, o caída del server). Doble
// condición —dentro del root Y directorio inexistente— para no tocar una sesión viva.
export async function downOrphans(root, { exec = defaultExec, exists = existsSync } = {}) {
  if (!norm(root)) return [];
  const stacks = await listStacks(exec);
  const done = [];
  for (const s of stacks) {
    if (!inside(s.dir, root, { strict: true })) continue;
    if (exists(s.dir)) continue;
    if (await composeDown(s.project, exec)) done.push(s.project);
  }
  return done;
}
