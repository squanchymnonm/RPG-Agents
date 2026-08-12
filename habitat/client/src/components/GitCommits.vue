<script setup lang="ts">
import { ref, watch } from 'vue'
import { useGit, type GitStatus, type DiffBase, type LogEntry } from '../composables/useGit'

const props = defineProps<{ status: GitStatus; id: string; path: string }>()
const emit = defineEmits<{ (e: 'diff', file: string, base: DiffBase): void }>()

const { loadLog } = useGit()
const showAll = ref(false)
const log = ref<LogEntry[]>([])
const skip = ref(0)
const atEnd = ref(false)
const loadingMore = ref(false)
const PAGE = 50

async function loadMore() {
  loadingMore.value = true
  const rows = await loadLog(props.id, props.path, { limit: PAGE, skip: skip.value })
  log.value = skip.value === 0 ? rows : [...log.value, ...rows]
  skip.value += rows.length
  atEnd.value = rows.length < PAGE
  loadingMore.value = false
}

// Al cambiar de repo se descarta lo cargado: el historial es de otro repo.
watch(() => [props.id, props.path] as const, () => {
  log.value = []; skip.value = 0; atEnd.value = false
  if (showAll.value) loadMore()
})
watch(showAll, (on) => { if (on && !log.value.length) loadMore() })
</script>

<template>
  <div class="gc-toggle">
    <button class="g-mini" @click="showAll = !showAll">
      {{ showAll ? 'sólo mi rama' : 'historial completo' }}
    </button>
  </div>

  <template v-if="showAll">
    <div v-for="c in log" :key="c.sha" class="gc-row">
      <code>{{ c.shortSha }}</code> <span class="gc-subj">{{ c.subject }}</span>
      <div class="g-muted">{{ c.author }} · {{ c.date }}</div>
    </div>
    <p v-if="!log.length && !loadingMore" class="g-muted">sin commits</p>
    <button v-if="!atEnd" class="g-act" :disabled="loadingMore" @click="loadMore">
      {{ loadingMore ? 'cargando…' : 'cargar más' }}
    </button>
    <p v-else class="g-muted">fin del historial</p>
  </template>

  <template v-else>
    <div v-for="c in props.status.commits" :key="c.sha" class="gc-row">
      <span class="gc-dot" :class="{ pushed: c.pushed }" :title="c.pushed ? 'pusheado' : 'sin pushear'">
        {{ c.pushed ? '✓' : '●' }}
      </span>
      <code>{{ c.shortSha }}</code> <span class="subj">{{ c.subject }}</span>
      <ul>
        <li v-for="f in c.files" :key="c.sha + f.rel">
          <span class="g-st">{{ f.status }}</span>
          <a @click="emit('diff', f.rel, `commit:${c.sha}`)">{{ f.rel }}</a>
        </li>
      </ul>
    </div>
    <p v-if="!props.status.commits.length" class="g-muted">sin commits sobre {{ props.status.overview.default }}</p>
  </template>
</template>

<style scoped>
.gc-toggle { margin-bottom: .5rem; }
.gc-row { border-bottom: 1px dashed var(--color-line, #3a2e22); padding: .4rem 0; font-size: .85rem; }
.gc-row code { color: var(--color-brass, #c79a4b); }
.gc-row .subj, .gc-row .gc-subj { opacity: .9; }
.gc-dot { display: inline-block; width: 1.2em; }
.gc-dot.pushed { color: #5fb36b; }
</style>
