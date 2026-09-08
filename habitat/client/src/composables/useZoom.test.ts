import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ZOOM_STEPS, nextZoom, readInitialZoom, useZoom } from './useZoom'

function memStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  }
}

beforeEach(() => { vi.restoreAllMocks() })

describe('nextZoom', () => {
  it('sube al siguiente paso de la escala', () => {
    expect(nextZoom(1, 1)).toBe(1.1)
  })

  it('baja al paso anterior de la escala', () => {
    expect(nextZoom(1, -1)).toBe(0.9)
  })

  it('clampa en el máximo y en el mínimo', () => {
    const max = ZOOM_STEPS[ZOOM_STEPS.length - 1]
    const min = ZOOM_STEPS[0]
    expect(nextZoom(max, 1)).toBe(max)
    expect(nextZoom(min, -1)).toBe(min)
  })

  it('desde un valor fuera de la escala salta al paso vecino', () => {
    expect(nextZoom(1.05, 1)).toBe(1.1)
    expect(nextZoom(1.05, -1)).toBe(1)
  })
})

describe('readInitialZoom', () => {
  it('usa el valor guardado si es un paso válido', () => {
    expect(readInitialZoom('1.25')).toBe(1.25)
  })

  it('cae a 100% si no hay nada guardado o el valor es inválido', () => {
    expect(readInitialZoom(null)).toBe(1)
    expect(readInitialZoom('rompeme')).toBe(1)
    expect(readInitialZoom('9')).toBe(1)
  })
})

describe('useZoom', () => {
  it('zoomIn/zoomOut mueven el zoom, lo persisten y lo aplican al documento', () => {
    const store = memStorage()
    vi.stubGlobal('localStorage', store)
    const { zoom, zoomIn, zoomOut, resetZoom } = useZoom()
    resetZoom()

    zoomIn()
    expect(zoom.value).toBe(1.1)
    expect(store.getItem('habitat.zoom')).toBe('1.1')
    expect(document.documentElement.style.getPropertyValue('zoom')).toBe('1.1')
    // --zoom deja el factor disponible para el CSS: las alturas en vh hay que
    // dividirlas por él, si no la app no llena la pantalla al alejar.
    expect(document.documentElement.style.getPropertyValue('--zoom')).toBe('1.1')

    zoomOut()
    expect(zoom.value).toBe(1)
    expect(store.getItem('habitat.zoom')).toBe('1')
  })

  it('resetZoom vuelve a 100% y limpia el estilo del documento', () => {
    const store = memStorage()
    vi.stubGlobal('localStorage', store)
    const { zoom, zoomIn, resetZoom } = useZoom()
    zoomIn()
    resetZoom()
    expect(zoom.value).toBe(1)
    expect(document.documentElement.style.getPropertyValue('zoom')).toBe('')
    expect(document.documentElement.style.getPropertyValue('--zoom')).toBe('')
  })
})
