<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import type { DiffHunk } from '../composables/parseDiff'
import GitIcon from './GitIcon.vue'

defineProps<{ file: string; hunks: DiffHunk[]; binary: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const box = ref<HTMLElement | null>(null)

// Escape cierra el diff, no el explorer entero. Antes este componente no
// escuchaba teclado, así que la tecla llegaba al shell (ProjectExplorer emite
// `close` sin condición) y se cerraba todo de un saque, perdiendo el contexto.
// Va en captura y detiene la propagación para ganarle al handler de arriba.
function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  e.stopPropagation()
  e.preventDefault()
  emit('close')
}
onMounted(() => {
  window.addEventListener('keydown', onKey, true)
  // El foco entra al diálogo: si no, el teclado sigue operando la lista de atrás.
  box.value?.focus()
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true))
</script>

<template>
  <div class="gd-overlay" @click.self="emit('close')">
    <div ref="box" class="gd-box" role="dialog" aria-modal="true" :aria-label="`Diff de ${file}`" tabindex="-1">
      <header>
        <b class="gd-file">{{ file }}</b>
        <button class="g-btn" aria-label="Cerrar el diff" @click="emit('close')">
          <GitIcon name="close" />
        </button>
      </header>
      <p v-if="binary" class="g-muted gd-pad">archivo binario</p>
      <div v-else class="gd-scroll">
        <table v-for="(h, i) in hunks" :key="i" class="gd-table">
          <tbody>
            <tr v-for="(l, j) in h.lines" :key="j" :class="l.type">
              <td class="ln">{{ l.oldNo ?? '' }}</td>
              <td class="ln">{{ l.newNo ?? '' }}</td>
              <td class="code">{{ l.text }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* El scrim tapa de verdad: con 60% el contenido de atrás competía por atención. */
.gd-overlay {
  position: absolute;
  inset: 0;
  z-index: 6;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, .72);
}

/* --color-base y --radius-md no existen en el tema: caía siempre al fallback.
   Los tokens reales son --color-surface / --color-edge / --radius-card. */
.gd-box {
  display: flex;
  flex-direction: column;
  width: 94%;
  height: 90%;
  background: var(--color-surface);
  border: 1px solid var(--color-edge);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-sh2);
}
.gd-box:focus { outline: none; }

.gd-box header {
  display: flex;
  align-items: center;
  gap: var(--g-gap, .5rem);
  justify-content: space-between;
  padding: .5rem .6rem;
  border-bottom: 1px solid var(--color-edge);
}
.gd-file {
  min-width: 0;
  font-family: var(--font-machine);
  font-size: .95rem;
  font-weight: 500;
  overflow-wrap: anywhere;
}

.gd-pad { padding: .6rem; }
.gd-scroll { flex: 1; overflow: auto; }

.gd-table {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--font-machine);
  font-size: .9rem;
}
.gd-table td { padding: 0 .4rem; white-space: pre; vertical-align: top; }
/* Cifras tabulares en los números de línea: si no, la columna cambia de ancho. */
.gd-table .ln {
  width: 1px;
  text-align: right;
  color: var(--color-faint);
  font-variant-numeric: tabular-nums;
  user-select: none;
}
/* Añadido/borrado no se distingue sólo por color: cada línea lleva su signo. */
.gd-table tr.add .code { background: color-mix(in srgb, var(--color-moss) 18%, transparent); }
.gd-table tr.del .code { background: color-mix(in srgb, var(--color-crimson) 18%, transparent); }
.gd-table tr.add .code::before { content: '+ '; color: var(--color-moss); }
.gd-table tr.del .code::before { content: '- '; color: var(--color-crimson); }
</style>
