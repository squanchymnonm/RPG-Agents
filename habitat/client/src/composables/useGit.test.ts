import { describe, it, expect, vi, afterEach } from 'vitest'
import { useGit } from './useGit'

afterEach(() => { vi.unstubAllGlobals() })

describe('useGit', () => {
  it('loadStatus manda el path y expone repo', async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      urls.push(u)
      return {
        ok: true, status: 200,
        json: async () => ({
          working: { staged: [], unstaged: [], untracked: [], conflicted: [] },
          overview: { branch: 'link', default: 'origin/main', ahead: 0, behind: 0, files: [] },
          commits: [], repo: { rel: 'back', name: 'back' },
        }),
      }
    }))
    const { status, loadStatus } = useGit()
    await loadStatus('s1', 'back/src')
    expect(urls[0]).toContain('path=back%2Fsrc')
    expect(status.value?.repo.name).toBe('back')
  })

  it('action manda el path en la query, no en el body', async () => {
    let calledUrl = ''
    let body: any = null
    vi.stubGlobal('fetch', vi.fn(async (u: string, init: any) => {
      calledUrl = u
      body = JSON.parse(init.body)
      return { ok: true, status: 200, json: async () => ({ ok: true }) }
    }))
    const { action } = useGit()
    const r = await action('s1', 'merge-default', { path: 'back' })
    expect(r.ok).toBe(true)
    expect(calledUrl).toContain('path=back')
    expect(body).toEqual({ action: 'merge-default' })
  })
})
