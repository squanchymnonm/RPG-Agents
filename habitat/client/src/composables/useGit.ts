import { ref } from 'vue'
import type { BranchList } from './gitBranches'

const token = () => new URLSearchParams(location.search).get('token') ?? ''
const authHeaders = (): Record<string, string> => {
  const t = token()
  return t ? { authorization: `Bearer ${t}` } : {}
}

const q = (id: string, path?: string, extra: Record<string, string> = {}) => {
  const p = new URLSearchParams({ id, ...extra })
  if (path) p.set('path', path)
  return p.toString()
}

export interface GitFile { rel: string; status: string; old?: string }
export interface GitOverview { branch: string; default: string; ahead: number; behind: number; files: GitFile[] }
export interface GitCommit { sha: string; shortSha: string; subject: string; pushed: boolean; files: GitFile[] }
export interface GitWorking { staged: GitFile[]; unstaged: GitFile[]; untracked: GitFile[]; conflicted: GitFile[] }
export interface GitRepo { rel: string; name: string }
export interface GitStatus { working: GitWorking; overview: GitOverview; commits: GitCommit[]; repo: GitRepo }
export interface GitActionResult { ok: boolean; conflict?: boolean; files?: string[]; code?: number; message?: string; dirty?: boolean; branch?: string; url?: string }
export interface StashEntry { index: number; message: string }
export interface LogEntry { sha: string; shortSha: string; subject: string; author: string; date: string }
export type DiffBase = 'working' | 'staged' | 'branch' | `commit:${string}`

// Los endpoints git responden 409 con un cuerpo { reason } que dice POR QUÉ no hay
// repo usable: 'sin-sesion', 'sin-repo' (acá no hay repo git) o 'repo-arriba' /
// 'repo-afuera' (hay repo, pero su raíz cae fuera del alcance de la sesión). Sin
// esto el panel decía "sin repo git acá" incluso cuando el repo existía.
async function reason409(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { reason?: string } | null
    return body?.reason || 'sin-repo'
  } catch {
    return 'sin-repo' // 409 sin cuerpo (o cuerpo no-JSON): el genérico de siempre
  }
}

export function useGit() {
  const status = ref<GitStatus | null>(null)
  const loading = ref(false)
  const error = ref('')

  async function loadStatus(id: string, path?: string) {
    loading.value = true
    error.value = ''
    try {
      const res = await fetch(`/git/status?${q(id, path)}`, { headers: authHeaders() })
      if (!res.ok) { error.value = res.status === 409 ? await reason409(res) : `HTTP ${res.status}`; return }
      status.value = (await res.json()) as GitStatus
    } catch {
      error.value = 'sin conexión'
    } finally {
      loading.value = false
    }
  }

  async function loadDiff(id: string, file: string, base: DiffBase, path?: string): Promise<{ binary: boolean; patch: string }> {
    const res = await fetch(`/git/diff?${q(id, path, { file, base })}`, { headers: authHeaders() })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as { binary: boolean; patch: string }
  }

  // Los tres loaders de abajo van con try/catch como loadStatus: sin él, un fetch que
  // rechaza (red caída) escapaba del watcher que los llama como una rejection no
  // manejada y dejaba la pestaña colgada en "cargando…" para siempre.
  async function loadBranches(id: string, path?: string): Promise<BranchList | null> {
    try {
      const res = await fetch(`/git/branches?${q(id, path)}`, { headers: authHeaders() })
      if (!res.ok) { error.value = res.status === 409 ? await reason409(res) : `HTTP ${res.status}`; return null }
      return (await res.json()) as BranchList
    } catch {
      error.value = 'sin conexión'
      return null
    }
  }

  async function loadStash(id: string, path?: string): Promise<StashEntry[]> {
    try {
      const res = await fetch(`/git/stash?${q(id, path)}`, { headers: authHeaders() })
      if (!res.ok) return []
      return (await res.json()) as StashEntry[]
    } catch {
      return []
    }
  }

  async function loadLog(id: string, path?: string, opts: { limit?: number; skip?: number } = {}): Promise<LogEntry[]> {
    const extra: Record<string, string> = {}
    if (opts.limit != null) extra.limit = String(opts.limit)
    if (opts.skip != null) extra.skip = String(opts.skip)
    try {
      const res = await fetch(`/git/log?${q(id, path, extra)}`, { headers: authHeaders() })
      if (!res.ok) return []
      return (await res.json()) as LogEntry[]
    } catch {
      return []
    }
  }

  // El payload lista TODOS los campos que aceptan los endpoints (branch/from/index
  // incluidos): con el tipo viejo pasaban igual por el spread de Record<string,
  // unknown> de los callers, así que un typo en 'branch' no lo atrapaba nadie.
  async function action(
    id: string,
    actionName: string,
    payload: { path?: string; paths?: string[]; message?: string; branch?: string; from?: string; index?: number } = {},
  ): Promise<GitActionResult> {
    const { path, ...rest } = payload
    const res = await fetch(`/git/action?${q(id, path)}`, {
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ action: actionName, ...rest }),
    })
    // 409 = el lock del repo lo tiene otra operación (dos pestañas, dos clientes, o
    // un fetch/push lento en vuelo). "HTTP 409" no le dice nada al usuario en un
    // panel donde todo lo demás está en español y es accionable.
    if (res.status === 409) return { ok: false, message: 'el repo está ocupado con otra operación, probá de nuevo' }
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}` }
    return (await res.json()) as GitActionResult
  }

  return { status, loading, error, loadStatus, loadDiff, loadBranches, loadStash, loadLog, action }
}
