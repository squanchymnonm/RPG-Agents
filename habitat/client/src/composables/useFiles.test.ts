import { describe, it, expect } from 'vitest'
import { quotePath, limitMB } from './useFiles'

describe('quotePath', () => {
  it('deja el path tal cual si no tiene espacios', () => {
    expect(quotePath('.habitat-uploads/logo.png')).toBe('.habitat-uploads/logo.png')
    expect(quotePath('src/main.ts')).toBe('src/main.ts')
  })
  it('envuelve en comillas si tiene espacios', () => {
    expect(quotePath('.habitat-uploads/mi captura.png')).toBe('".habitat-uploads/mi captura.png"')
  })
})

describe('limitMB', () => {
  it('redondea a MB enteros de 10 para arriba', () => {
    expect(limitMB(25 * 1024 * 1024)).toBe('25 MB')
    expect(limitMB(1024 * 1024 * 1024)).toBe('1024 MB')
  })
  it('usa un decimal para límites chicos', () => {
    expect(limitMB(1024 * 1024)).toBe('1.0 MB')
    expect(limitMB(1536 * 1024)).toBe('1.5 MB')
  })
})
