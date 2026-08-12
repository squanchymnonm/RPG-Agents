import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import GitPanel from './GitPanel.vue'
import GitBranches from './GitBranches.vue'

// Respuestas mínimas para que el panel llegue a mostrar contenido sin
// depender del server real.
const statusBody = {
  working: { staged: [], unstaged: [], untracked: [], conflicted: [] },
  overview: { branch: 'main', default: 'origin/main', ahead: 0, behind: 0, files: [] },
  commits: [],
  repo: { rel: '', name: 'repo' },
}
const branchesBody = {
  current: 'main',
  default: 'origin/main',
  local: [{ name: 'main', worktree: '', current: true }, { name: 'feature-x', worktree: '', current: false }],
  remote: [],
}

// Stub de fetch que responde según el endpoint pedido. El checkout SIEMPRE
// falla por árbol sucio (dirty:true), que es lo que dispara "retry".
function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
    if (url.includes('/git/status')) return { ok: true, status: 200, json: async () => statusBody }
    if (url.includes('/git/stash')) return { ok: true, status: 200, json: async () => [] }
    if (url.includes('/git/branches')) return { ok: true, status: 200, json: async () => branchesBody }
    if (url.includes('/git/action')) {
      const body = JSON.parse(init.body)
      if (body.action === 'checkout') {
        return { ok: true, status: 200, json: async () => ({ ok: false, dirty: true, message: 'árbol sucio' }) }
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) }
    }
    return { ok: true, status: 200, json: async () => ({}) }
  }))
}

describe('GitPanel — retry de checkout sucio', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    stubFetch()
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('un checkout que falla por árbol sucio muestra "Stashear y reintentar", y el refresh() interno de run() no lo borra', async () => {
    const w = mount(GitPanel, { props: { id: 's1', path: '' } })
    await flushPromises()

    // Vamos a la pestaña Branches: es la que emite 'checkout'.
    const tabs = w.findAll('.gp-tabs button')
    const branchesTab = tabs.find((b) => b.text() === 'Branches')
    await branchesTab!.trigger('click')
    await flushPromises()

    // Simulamos lo mismo que produciría un click en una rama: GitBranches emite
    // 'run' con el checkout, que index.js/GitPanel.run() procesa.
    w.findComponent(GitBranches).vm.$emit('run', 'checkout', { branch: 'feature-x' })
    await flushPromises()

    expect(w.text()).toContain('Stashear y reintentar')
    expect(w.text()).toContain('árbol sucio')
  })

  it('cambiar de path limpia "retry" y el error viejo (no queda apuntando a un repo/rama que ya no es el activo)', async () => {
    const w = mount(GitPanel, { props: { id: 's1', path: '' } })
    await flushPromises()

    const tabs = w.findAll('.gp-tabs button')
    const branchesTab = tabs.find((b) => b.text() === 'Branches')
    await branchesTab!.trigger('click')
    await flushPromises()

    w.findComponent(GitBranches).vm.$emit('run', 'checkout', { branch: 'feature-x' })
    await flushPromises()
    expect(w.text()).toContain('Stashear y reintentar') // precondición: quedó pendiente

    // El usuario navega a otro path sin tocar el botón de recuperación.
    await w.setProps({ path: 'otro/repo' })
    await flushPromises()

    expect(w.text()).not.toContain('Stashear y reintentar')
    expect(w.text()).not.toContain('árbol sucio')
  })

  it('cambiar de sesión (id) también limpia "retry"', async () => {
    const w = mount(GitPanel, { props: { id: 's1', path: '' } })
    await flushPromises()

    const tabs = w.findAll('.gp-tabs button')
    const branchesTab = tabs.find((b) => b.text() === 'Branches')
    await branchesTab!.trigger('click')
    await flushPromises()

    w.findComponent(GitBranches).vm.$emit('run', 'checkout', { branch: 'feature-x' })
    await flushPromises()
    expect(w.text()).toContain('Stashear y reintentar')

    await w.setProps({ id: 's2' })
    await flushPromises()

    expect(w.text()).not.toContain('Stashear y reintentar')
  })
})
