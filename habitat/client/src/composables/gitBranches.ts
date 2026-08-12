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
