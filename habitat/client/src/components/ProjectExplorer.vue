<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import ProjectFiles from './ProjectFiles.vue'

const props = defineProps<{ id: string }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'opened'): void }>()

const path = ref('')
const files = ref<InstanceType<typeof ProjectFiles> | null>(null)

function onKey(e: KeyboardEvent) { if (e.key === 'Escape') emit('close') }
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="pe-overlay">
    <header class="pe-head">
      <span class="pe-title">🗂 Proyecto</span>
      <nav class="pe-crumbs">
        <button class="pe-crumb" @click="path = ''">{{ files?.listing?.root || '~' }}</button>
        <template v-for="c in files?.listing?.breadcrumbs || []" :key="c.rel">
          <span class="pe-sep">/</span>
          <button class="pe-crumb" @click="path = c.rel">{{ c.name }}</button>
        </template>
      </nav>
      <button class="pe-x" @click="emit('close')" title="Cerrar">✕</button>
    </header>

    <ProjectFiles ref="files" :id="props.id" :path="path"
      @navigate="(rel) => (path = rel)" @opened="emit('opened')" />
  </div>
</template>

<style scoped>
.pe-overlay { position: absolute; inset: 0; background: var(--color-base, #1a1410); color: var(--color-ink, #e8dcc0); display: flex; flex-direction: column; z-index: 5; }
.pe-head { display: flex; align-items: center; gap: .6rem; padding: .5rem .75rem; border-bottom: 1px solid var(--color-line, #3a2e22); }
.pe-title { font-weight: 700; }
.pe-crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; flex: 1; overflow: hidden; }
.pe-crumb { background: none; border: none; color: var(--color-brass, #c79a4b); cursor: pointer; font-family: ui-monospace, monospace; }
.pe-sep { color: var(--color-line, #3a2e22); }
.pe-x { cursor: pointer; background: var(--color-raise, #2a2018); color: inherit; border: 1px solid var(--color-line, #3a2e22); border-radius: var(--radius-sm, 4px); padding: .15rem .5rem; }
</style>
