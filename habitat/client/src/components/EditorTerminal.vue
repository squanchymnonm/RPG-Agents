<script setup lang="ts">
import { ref } from 'vue'
import { useTerminal } from '../composables/useTerminal'
import { useTermKeys } from '../composables/useTermKeys'
import TermKeys from './TermKeys.vue'

const props = defineProps<{ id: string }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const termEl = ref<HTMLElement | null>(null)
const idRef = ref<string>(props.id)
const { sendKey } = useTerminal(termEl, idRef, { role: 'edit' })
const { enabled: termKeysEnabled } = useTermKeys()
</script>

<template>
  <div class="ed-overlay">
    <header class="ed-head">
      <span class="ed-title">✎ Editor — nvim</span>
      <TermKeys v-if="termKeysEnabled" dense @press="sendKey" />
      <button class="ed-x" @click="emit('close')" title="Cerrar (nvim sigue vivo)">✕</button>
    </header>
    <div ref="termEl" class="ed-term"></div>
  </div>
</template>

<style scoped>
.ed-overlay { position: absolute; inset: 0; background: var(--color-base, #1a1410); display: flex; flex-direction: column; z-index: 7; }
.ed-head { display: flex; align-items: center; flex-wrap: nowrap; gap: .5rem; padding: .4rem .7rem; border-bottom: 1px solid var(--color-line, #3a2e22); color: var(--color-ink, #e8dcc0); }
.ed-title { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 700; }
.ed-head .ed-x { margin-left: auto; }
.ed-x { cursor: pointer; background: var(--color-raise, #2a2018); color: inherit; border: 1px solid var(--color-line, #3a2e22); border-radius: var(--radius-sm, 4px); padding: .15rem .5rem; }
.ed-term { flex: 1; min-height: 0; padding: 4px; touch-action: none; }
</style>
