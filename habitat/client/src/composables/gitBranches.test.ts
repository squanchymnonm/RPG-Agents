import { describe, it, expect } from 'vitest'
import { groupBranches, canCreatePr } from './gitBranches'

const data = {
  current: 'link',
  default: 'origin/main',
  local: [
    { name: 'link', worktree: '/wt/RPG/link', current: true },
    { name: 'main', worktree: '', current: false },
    { name: 'dante', worktree: '/wt/RPG/dante', current: false },
  ],
  remote: ['origin/main', 'origin/shepard'],
}

const dataTrailingSlash = {
  ...data,
  local: [
    ...data.local.slice(0, 2),
    { name: 'dante', worktree: '/wt/RPG/dante/', current: false },
  ],
}

const dataUpstreamRemote = {
  ...data,
  remote: ['origin/main', 'upstream/foo'],
}

describe('groupBranches', () => {
  it('marca takenBy con el nombre de la sesión que tiene la branch', () => {
    const { local } = groupBranches(data, '')
    expect(local.find((b) => b.name === 'dante')?.takenBy).toBe('dante')
    expect(local.find((b) => b.name === 'main')?.takenBy).toBe('')
  })

  it('no marca takenBy en la branch actual', () => {
    const { local } = groupBranches(data, '')
    expect(local.find((b) => b.name === 'link')?.takenBy).toBe('')
  })

  it('esconde las remotas que ya tienen local', () => {
    const { remote } = groupBranches(data, '')
    expect(remote.map((r) => r.short)).toEqual(['shepard'])
  })

  it('filtra por substring en locales y remotas', () => {
    expect(groupBranches(data, 'dan').local.map((b) => b.name)).toEqual(['dante'])
    expect(groupBranches(data, 'shep').remote.map((r) => r.short)).toEqual(['shepard'])
    expect(groupBranches(data, 'zzz').local).toEqual([])
  })

  it('takenBy no arrastra la barra final del worktree', () => {
    const { local } = groupBranches(dataTrailingSlash, '')
    expect(local.find((b) => b.name === 'dante')?.takenBy).toBe('dante')
  })

  it('remote.short sale bien con un remote que no es origin', () => {
    const { remote } = groupBranches(dataUpstreamRemote, '')
    expect(remote.map((r) => r.short)).toEqual(['foo'])
  })
})

describe('canCreatePr', () => {
  const base = { branch: 'feature/x', default: 'origin/main', ahead: 0, behind: 0, files: [] }

  it('permite cuando la rama difiere del default y no hay nada sin pushear', () => {
    expect(canCreatePr({ ...base, files: [{ rel: 'a.js', status: 'M' }] })).toEqual({ can: true, why: '' })
  })

  it('advierte pero no bloquea si hay commits por delante del default', () => {
    const r = canCreatePr({ ...base, ahead: 2 })
    expect(r.can).toBe(true)
    expect(r.why).toMatch(/sin pushear/)
  })

  it('bloquea si estás en la rama default', () => {
    const r = canCreatePr({ ...base, branch: 'main' })
    expect(r.can).toBe(false)
    expect(r.why).toMatch(/default/)
  })

  it('bloquea sin remoto configurado, con una rama con barras (default cae a currentBranch, sin prefijo origin/)', () => {
    // remoteDefaultBranch sin origin/HEAD resuelto cae a currentBranch(cwd): 'default'
    // termina siendo la misma rama actual, sin el prefijo 'origin/'. Pelar por la
    // primera '/' a ciegas mutilaría 'feature/x' a 'x' y no detectaría que es la
    // misma rama.
    const r = canCreatePr({ ...base, branch: 'feature/x', default: 'feature/x' })
    expect(r.can).toBe(false)
    expect(r.why).toMatch(/default/)
  })
})
