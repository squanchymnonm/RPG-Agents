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
