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
export interface GitActionResult { ok: boolean; conflict?: boolean; files?: string[]; code?: number; message?: string; dirty?: boolean; branch?: string }
export interface StashEntry { index: number; message: string }
export interface LogEntry { sha: string; shortSha: string; subject: string; author: string; date: string }
export type DiffBase = 'working' | 'staged' | 'branch' | `commit:${string}`

export function useGit() {
  const status = ref<GitStatus | null>(null)
  const loading = ref(false)
  const error = ref('')

  async function loadStatus(id: string, path?: string) {
    loading.value = true
    error.value = ''
    try {
      const res = await fetch(`/git/status?${q(id, path)}`, { headers: authHeaders() })
      if (!res.ok) { error.value = res.status === 409 ? 'sin-dir' : `HTTP ${res.status}`; return }
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

  async function loadBranches(id: string, path?: string): Promise<BranchList | null> {
    const res = await fetch(`/git/branches?${q(id, path)}`, { headers: authHeaders() })
    if (!res.ok) return null
    return (await res.json()) as BranchList
  }

  async function loadStash(id: string, path?: string): Promise<StashEntry[]> {
    const res = await fetch(`/git/stash?${q(id, path)}`, { headers: authHeaders() })
    if (!res.ok) return []
    return (await res.json()) as StashEntry[]
  }

  async function loadLog(id: string, path?: string, opts: { limit?: number; skip?: number } = {}): Promise<LogEntry[]> {
    const extra: Record<string, string> = {}
    if (opts.limit != null) extra.limit = String(opts.limit)
    if (opts.skip != null) extra.skip = String(opts.skip)
    const res = await fetch(`/git/log?${q(id, path, extra)}`, { headers: authHeaders() })
    if (!res.ok) return []
    return (await res.json()) as LogEntry[]
  }

  async function action(
    id: string,
    actionName: string,
    payload: { path?: string; paths?: string[]; message?: string } = {},
  ): Promise<GitActionResult> {
    const { path, ...rest } = payload
    const res = await fetch(`/git/action?${q(id, path)}`, {
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ action: actionName, ...rest }),
    })
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}` }
    return (await res.json()) as GitActionResult
  }

  return { status, loading, error, loadStatus, loadDiff, loadBranches, loadStash, loadLog, action }
}
