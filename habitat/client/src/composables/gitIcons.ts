// Un solo set de iconos para el panel de git: misma caja (24×24), mismo trazo
// (1.5, abierto) y heredan el color del botón. Antes había glifos de texto
// sueltos y de familias distintas (⌦ ≡ ↻ − + ✓ ●): dependen de la fuente del
// sistema, no se pueden tematizar, y ⌦ no se entendía.

export type IconName =
  | 'plus' | 'minus' | 'close' | 'trash' | 'stack' | 'check' | 'dot'
  | 'refresh' | 'download' | 'upload' | 'merge' | 'pr' | 'branch'

// Mantener el trazo abierto (fill: none) y sin detalles a menos de 2px: a 20px
// de render se empastan.
export const ICON_PATHS: Record<IconName, string> = {
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  stack: 'M4 8l8-4 8 4-8 4-8-4M4 12l8 4 8-4M4 16l8 4 8-4',
  check: 'M4 12l5 5L20 6',
  dot: 'M12 12h.01',
  refresh: 'M20 11a8 8 0 10-2.3 5.7M20 5v6h-6',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  upload: 'M12 20V9M7 13l5-5 5 5M5 4h14',
  merge: 'M7 6v7a4 4 0 004 4h6M17 13l3 4-3 4M7 4a2 2 0 100 4 2 2 0 000-4',
  pr: 'M7 7v10M7 3a2 2 0 100 4 2 2 0 000-4M7 17a2 2 0 100 4 2 2 0 000-4M17 12v5M17 17a2 2 0 100 4 2 2 0 000-4M17 12a5 5 0 00-5-5H9',
  branch: 'M7 5v14M7 1a2 2 0 100 4 2 2 0 000-4M17 6a2 2 0 100 4 2 2 0 000-4M17 10v1a4 4 0 01-4 4H7',
}
