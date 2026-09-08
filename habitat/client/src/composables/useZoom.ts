import { computed, ref } from 'vue'

// Zoom de UI propio: en tablet no hay forma cómoda de usar el zoom del navegador
// (la app fija initial-scale=1), así que lo replicamos con la propiedad CSS `zoom`
// sobre el root. A diferencia de `transform: scale`, `zoom` reflowea de verdad:
// todo sigue ocupando el viewport completo, sin scrollbars ni huecos.
const KEY = 'habitat.zoom'

export const ZOOM_STEPS = [0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]
export const DEFAULT_ZOOM = 1

// Paso siguiente (dir 1) o anterior (dir -1). Si el valor actual no está en la
// escala, salta al vecino en esa dirección. Clampa en los extremos.
export function nextZoom(current: number, dir: 1 | -1): number {
  const steps = dir === 1 ? ZOOM_STEPS : [...ZOOM_STEPS].reverse()
  const found = steps.find((s) => (dir === 1 ? s > current : s < current))
  return found ?? (dir === 1 ? ZOOM_STEPS[ZOOM_STEPS.length - 1] : ZOOM_STEPS[0])
}

export function readInitialZoom(stored: string | null): number {
  const n = Number(stored)
  return ZOOM_STEPS.includes(n) ? n : DEFAULT_ZOOM
}

function storedValue(): string | null {
  return typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null
}

// Singleton a nivel de módulo: el menú y el layout comparten el ref.
const zoom = ref(readInitialZoom(storedValue()))

function apply(z: number) {
  if (typeof document === 'undefined') return
  const style = document.documentElement.style
  if (z === DEFAULT_ZOOM) {
    style.removeProperty('zoom')
    style.removeProperty('--zoom')
    return
  }
  style.setProperty('zoom', String(z))
  // Las unidades de viewport NO se ven afectadas por `zoom`, así que 100dvh
  // termina renderizando 100dvh * z. El CSS divide por --zoom para compensar.
  style.setProperty('--zoom', String(z))
}

function set(z: number) {
  zoom.value = z
  if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, String(z))
  apply(z)
}

apply(zoom.value) // el zoom persistido se aplica al cargar la app

export function useZoom() {
  return {
    zoom,
    zoomPct: computed(() => Math.round(zoom.value * 100)),
    zoomIn: () => set(nextZoom(zoom.value, 1)),
    zoomOut: () => set(nextZoom(zoom.value, -1)),
    resetZoom: () => set(DEFAULT_ZOOM),
    canZoomIn: computed(() => zoom.value < ZOOM_STEPS[ZOOM_STEPS.length - 1]),
    canZoomOut: computed(() => zoom.value > ZOOM_STEPS[0]),
  }
}
