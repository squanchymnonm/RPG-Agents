<script setup lang="ts">
import type { DiffHunk } from '../composables/parseDiff'

defineProps<{ file: string; hunks: DiffHunk[]; binary: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()
</script>

<template>
  <div class="gd-overlay" @click.self="emit('close')">
    <div class="gd-box">
      <header><b>{{ file }}</b><button class="gd-x" @click="emit('close')">✕</button></header>
      <p v-if="binary" class="gd-muted">archivo binario</p>
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
.gd-overlay { position: absolute; inset: 0; background: rgba(0,0,0,.6); display: flex; align-items: center; justify-content: center; z-index: 6; }
.gd-box { width: 94%; height: 90%; background: var(--color-base, #1a1410); border: 1px solid var(--color-line, #3a2e22); border-radius: var(--radius-md, 6px); display: flex; flex-direction: column; }
.gd-box header { display: flex; align-items: center; justify-content: space-between; padding: .4rem .6rem; border-bottom: 1px solid var(--color-line, #3a2e22); }
.gd-x { cursor: pointer; background: var(--color-raise, #2a2018); color: inherit; border: 1px solid var(--color-line, #3a2e22); border-radius: var(--radius-sm, 4px); padding: .15rem .5rem; }
.gd-muted { opacity: .6; font-size: .82rem; }
.gd-scroll { flex: 1; overflow: auto; }
.gd-table { width: 100%; border-collapse: collapse; font-family: ui-monospace, monospace; font-size: .8rem; }
.gd-table td { padding: 0 .4rem; white-space: pre; vertical-align: top; }
.gd-table .ln { color: #6b5d49; text-align: right; user-select: none; width: 1px; }
.gd-table tr.add .code { background: rgba(95,179,107,.16); }
.gd-table tr.del .code { background: rgba(210,85,63,.16); }
.gd-table tr.add .code::before { content: '+ '; color: #5fb36b; }
.gd-table tr.del .code::before { content: '- '; color: #d2553f; }
</style>
