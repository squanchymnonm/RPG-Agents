import type { GitOverview } from './useGit'

export interface BranchRow { name: string; worktree: string; current: boolean }
export interface BranchList { current: string; default: string; local: BranchRow[]; remote: string[] }

// basename tolerante a barras finales: recorta y busca el índice sobre el
// MISMO string (antes se calculaba el índice sobre el recortado pero el
// slice se aplicaba sobre el original, dejando la barra colgando).
const base = (p: string) => {
  const trimmed = p.replace(/\/+$/, '')
  return trimmed.slice(trimmed.lastIndexOf('/') + 1)
}

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
