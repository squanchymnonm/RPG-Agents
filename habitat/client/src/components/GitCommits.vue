<script setup lang="ts">
import { ref, watch } from 'vue'
import { useGit, type GitStatus, type DiffBase, type LogEntry } from '../composables/useGit'
import GitIcon from './GitIcon.vue'

const props = defineProps<{ status: GitStatus; id: string; path: string }>()
const emit = defineEmits<{ (e: 'diff', file: string, base: DiffBase): void }>()

const { loadLog } = useGit()
const showAll = ref(false)
const log = ref<LogEntry[]>([])
const skip = ref(0)
const atEnd = ref(false)
const loadingMore = ref(false)
const PAGE = 50
// Generación del contexto (id/path). Cada loadMore() en vuelo recuerda con qué
// generación arrancó; si el contexto cambió mientras esperaba la respuesta del
// server, la descarta al volver en vez de aplicarla — si no, un fetch viejo que
// llega después del reset pisa o mezcla el log con commits de otro repo.
const gen = ref(0)

async function loadMore() {
  if (loadingMore.value) return // ya hay una carga en curso: no reentrar (evita duplicar página)
  loadingMore.value = true
  const myGen = gen.value
  const mySkip = skip.value // capturado ahora: no leer skip.value de nuevo tras el await
  const rows = await loadLog(props.id, props.path, { limit: PAGE, skip: mySkip })
  if (myGen !== gen.value) return // el contexto cambió mientras esperábamos: descartar sin tocar el estado
  log.value = mySkip === 0 ? rows : [...log.value, ...rows]
  skip.value = mySkip + rows.length
  atEnd.value = rows.length < PAGE
  loadingMore.value = false
}

// Al cambiar de repo se descarta lo cargado: el historial es de otro repo.
// Se libera el guard de reentrancia: una carga vieja en vuelo para el repo
// anterior ya no cuenta como "en curso" para el contexto nuevo.
watch(() => [props.id, props.path] as const, () => {
  gen.value++
  log.value = []; skip.value = 0; atEnd.value = false
  loadingMore.value = false
  if (showAll.value) loadMore()
})
watch(showAll, (on) => { if (on && !log.value.length) loadMore() })
</script>

<template>
  <!-- Dos alcances del mismo historial. El botón dice a dónde te lleva, no
       dónde estás, y el encabezado nombra el alcance actual. -->
  <section class="g-group">
    <h4>
      {{ showAll ? 'Historial completo' : `Commits sobre ${props.status.overview.default}` }}
      <button class="g-btn gc-toggle" @click="showAll = !showAll">
        {{ showAll ? 'sólo mi rama' : 'historial completo' }}
      </button>
    </h4>

    <template v-if="showAll">
      <div v-for="c in log" :key="c.sha" class="gc-row">
        <div class="gc-head">
          <code class="gc-sha">{{ c.shortSha }}</code>
          <span class="gc-subj">{{ c.subject }}</span>
        </div>
        <div class="g-muted gc-meta">{{ c.author }} · {{ c.date }}</div>
      </div>
      <p v-if="!log.length && !loadingMore" class="g-empty">sin commits en este repo</p>
      <button v-if="!atEnd" class="g-btn gc-more" :disabled="loadingMore" @click="loadMore">
        {{ loadingMore ? 'cargando…' : 'cargar más' }}
      </button>
      <p v-else-if="log.length" class="g-muted">fin del historial</p>
    </template>

    <template v-else>
      <div v-for="c in props.status.commits" :key="c.sha" class="gc-row">
        <div class="gc-head">
          <!-- Pusheado o no: icono + title, no sólo el color del glifo. -->
          <span class="gc-state" :class="{ pushed: c.pushed }" :title="c.pushed ? 'pusheado' : 'sin pushear'">
            <GitIcon :name="c.pushed ? 'check' : 'dot'" />
          </span>
          <code class="gc-sha">{{ c.shortSha }}</code>
          <span class="gc-subj">{{ c.subject }}</span>
        </div>
        <ul>
          <li v-for="f in c.files" :key="c.sha + f.rel">
            <span class="g-st">{{ f.status }}</span>
            <a @click="emit('diff', f.rel, `commit:${c.sha}`)">{{ f.rel }}</a>
          </li>
        </ul>
      </div>
      <p v-if="!props.status.commits.length" class="g-empty">
        Tu rama no tiene commits por encima de {{ props.status.overview.default }}.
      </p>
    </template>
  </section>
</template>

<style scoped>
.gc-toggle { margin-left: auto; }

.gc-row {
  padding: .5rem 0;
  font-size: 1rem;
  border-bottom: 1px solid var(--color-line);
}
.gc-head { display: flex; align-items: center; gap: var(--g-gap); }

/* El sha va en monoespaciada con cifras tabulares: no baila al refrescar. */
.gc-sha {
  flex: none;
  font-family: var(--font-machine);
  font-variant-numeric: tabular-nums;
  font-size: .9rem;
  color: var(--color-brass);
}
.gc-subj { flex: 1; min-width: 0; color: var(--color-ink); overflow-wrap: anywhere; }
.gc-meta { margin-top: .15rem; padding-left: .25rem; }

.gc-state { flex: none; display: inline-flex; color: var(--color-dim); }
.gc-state.pushed { color: var(--color-moss); }

.gc-more { margin-top: var(--g-gap); }
</style>
