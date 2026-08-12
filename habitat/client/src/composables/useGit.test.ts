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

  // El 409 lo devuelve el lock por repo cuando otra operación (otra pestaña, otro
  // cliente, o un fetch/push lento en vuelo) lo tiene tomado. El panel mostraba
  // literalmente "HTTP 409" en medio de mensajes en español y accionables.
  it('action traduce el 409 del lock a un mensaje en español', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 409, json: async () => ({}) })))
    const { action } = useGit()
    const r = await action('s1', 'push', {})
    expect(r.ok).toBe(false)
    expect(r.message).not.toMatch(/HTTP/)
    expect(r.message).toMatch(/ocupado/)
  })

  // Antes todo 409 era 'sin-dir' y el panel decía "sin repo git acá" incluso cuando
  // SÍ había repo (sesión arrancada en un subdirectorio: la raíz del repo queda por
  // encima del cwd, fuera del alcance de la sesión).
  it('loadStatus expone el reason del 409 (repo-arriba, no un genérico)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 409, json: async () => ({ reason: 'repo-arriba' }) })))
    const { error, loadStatus } = useGit()
    await loadStatus('s1')
    expect(error.value).toBe('repo-arriba')
  })

  it('loadStatus cae al genérico si el 409 no trae cuerpo JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 409, json: async () => { throw new Error('no json') } })))
    const { error, loadStatus } = useGit()
    await loadStatus('s1')
    expect(error.value).toBe('sin-repo')
  })

  // Sin try/catch, el throw del fetch escapaba del watcher que llama a estos loaders
  // como una rejection no manejada y dejaba la pestaña colgada.
  it('loadBranches, loadStash y loadLog no propagan el throw del fetch', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    const { loadBranches, loadStash, loadLog } = useGit()
    await expect(loadBranches('s1')).resolves.toBeNull()
    await expect(loadStash('s1')).resolves.toEqual([])
    await expect(loadLog('s1')).resolves.toEqual([])
  })
})
