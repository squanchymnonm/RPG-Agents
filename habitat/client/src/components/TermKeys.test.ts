import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TermKeys from './TermKeys.vue'

describe('TermKeys', () => {
  it('emite la tecla presionada', async () => {
    const w = mount(TermKeys)
    await w.findAll('button')[0].trigger('click')
    expect(w.emitted('press')?.[0]).toEqual(['up'])
  })

  it('por defecto no usa la variante densa', () => {
    const w = mount(TermKeys)
    expect(w.get('.termkeys').classes()).not.toContain('dense')
  })

  it('con dense agrega la clase para achicar las teclas dentro de una barra', () => {
    const w = mount(TermKeys, { props: { dense: true } })
    expect(w.get('.termkeys').classes()).toContain('dense')
  })
})
