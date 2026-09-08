<script setup lang="ts">
import type { SpecialKey } from '../composables/useTerminal'

const emit = defineEmits<{ (e: 'press', key: SpecialKey): void }>()

// `dense`: variante chica para cuando la fila vive dentro de una barra de
// herramientas (la barra de la terminal, el header del editor) en vez de
// ocupar su propio renglón.
withDefaults(defineProps<{ dense?: boolean }>(), { dense: false })

// Fila de teclas que Android no tiene: flechas + Enter/Esc/Tab.
const KEYS: { key: SpecialKey; label: string; title: string }[] = [
  { key: 'up', label: '↑', title: 'Flecha arriba' },
  { key: 'down', label: '↓', title: 'Flecha abajo' },
  { key: 'left', label: '←', title: 'Flecha izquierda' },
  { key: 'right', label: '→', title: 'Flecha derecha' },
  { key: 'enter', label: '⏎', title: 'Enter' },
  { key: 'esc', label: 'Esc', title: 'Escape' },
  { key: 'tab', label: 'Tab', title: 'Tab' },
]
</script>

<template>
  <div class="termkeys" :class="{ dense }">
    <button
      v-for="k in KEYS"
      :key="k.key"
      class="tk"
      :title="k.title"
      @pointerdown.prevent
      @click="emit('press', k.key)"
    >{{ k.label }}</button>
  </div>
</template>

<style scoped>
.termkeys { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.tk {
  min-width: 40px; min-height: 34px; padding: 4px 10px;
  background: var(--color-raise, #2a2018); color: var(--color-ink, #e8dcc0);
  border: 1px solid var(--color-line, #3a2e22); border-radius: var(--radius-sm, 4px);
  font-size: 15px; line-height: 1; cursor: pointer; user-select: none;
}
.tk:active { border-color: var(--color-brass, #e0a94b); color: var(--color-brass, #e0a94b); }

/* Variante densa: entra en la barra de la terminal sin engordarla. */
.termkeys.dense { flex-wrap: nowrap; gap: 4px; }
.termkeys.dense .tk {
  min-width: 32px; min-height: 26px; padding: 2px 7px;
  font-size: 13px;
}
</style>
