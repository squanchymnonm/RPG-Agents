import { describe, it, expect } from 'vitest'
import { groupBranches } from './gitBranches'

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
})
