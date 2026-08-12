<script setup lang="ts">
import { ref, watch, onBeforeUnmount, computed } from 'vue'
import { useGit, type DiffBase, type StashEntry } from '../composables/useGit'
import { canCreatePr } from '../composables/gitBranches'
import { parseDiff, type DiffHunk } from '../composables/parseDiff'
import { useSessions } from '../stores/sessions'
import GitWork from './GitWork.vue'
import GitBranchDiff from './GitBranchDiff.vue'
import GitBranches from './GitBranches.vue'
import GitCommits from './GitCommits.vue'
import GitDiff from './GitDiff.vue'
import GitIcon from './GitIcon.vue'
import '../styles/git.css'

const props = defineProps<{ id: string; path: string }>()

const store = useSessions()
const { status, loading, error, loadStatus, loadDiff, loadStash, action } = useGit()

// 'branch' (el diff contra el default) dejó de ser pestaña propia: era la misma
// pregunta que 'commits' — "qué tiene mi rama arriba del default" — partida en
// dos lugares. Ahora vive como resumen arriba del historial.
const tab = ref<'work' | 'branches' | 'commits'>('work')
const branchesEl = ref<InstanceType<typeof GitBranches> | null>(null)
const diff = ref<{ file: string; hunks: DiffHunk[]; binary: boolean } | null>(null)
const busy = ref('')
const actionErr = ref('')
const stash = ref<StashEntry[]>([])
// Cuando el checkout falla por árbol sucio, ofrecemos la salida útil en vez de
// dejar al usuario con un error de git.
const retry = ref<{ branch: string } | null>(null)
const prUrl = ref('')

async function refresh() {
  await loadStatus(props.id, props.path)
  stash.value = await loadStash(props.id, props.path)
}

async function openDiff(file: string, base: DiffBase) {
  diff.value = null
  try {
    const r = await loadDiff(props.id, file, base, props.path)
    diff.value = { file, hunks: r.binary ? [] : parseDiff(r.patch), binary: r.binary }
  } catch { actionErr.value = 'no se pudo cargar el diff' }
}

async function run(name: string, payload: Record<string, unknown> = {}, confirmMsg?: string) {
  if (confirmMsg && !confirm(confirmMsg)) return
  busy.value = name; actionErr.value = ''
  const r = await action(props.id, name, { path: props.path, ...payload })
  busy.value = ''
  if (!r.ok) {
    actionErr.value = r.conflict ? `Conflicto en: ${(r.files ?? []).join(', ')}` : (r.message || 'falló')
    retry.value = r.dirty && name === 'checkout' ? { branch: payload.branch as string } : null
  } else {
    retry.value = null
  }
  await refresh()
  await branchesEl.value?.refresh()
}

// El stash va por run(), no por action() directo: así toma `busy` (el botón no admite
// doble click) y limpia el actionErr del checkout que falló — con action() directo ese
// error quedaba visible como si el stash hubiera fallado.
async function stashAndRetry() {
  const branch = retry.value?.branch
  if (!branch) return
  retry.value = null
  await run('stash-push', { message: `auto antes de ir a ${branch}` })
  if (actionErr.value) return // el stash falló: no encadenar el checkout encima
  await run('checkout', { branch })
}

async function doPr() {
  busy.value = 'pr-create'; actionErr.value = ''; prUrl.value = ''
  const r = await action(props.id, 'pr-create', { path: props.path })
  busy.value = ''
  if (r.url) prUrl.value = r.url
  if (!r.ok) actionErr.value = r.message || 'no se pudo crear el PR'
  await refresh()
}

// Refresh live: cada broadcast WS hace store.upsert -> la sesión seleccionada
// cambia de identidad; debounced para no spamear git.
let t: ReturnType<typeof setTimeout> | null = null
function schedule() { if (t) clearTimeout(t); t = setTimeout(refresh, 800) }
watch(() => store.list.find((s) => s.id === props.id), schedule)
// El path lo manda el shell: al navegar a otra carpeta hay que re-scopear.
// Cambiar de sesión o de path invalida cualquier oferta de recuperación pendiente:
// "retry" (y el error que la originó) apuntan a la rama/repo que falló, que ya no
// es el contexto activo — si no se limpia, "Stashear y reintentar" terminaría
// operando sobre el repo/rama nuevos con el nombre de rama del contexto viejo.
// prUrl tiene la misma fuga: es el link del PR del repo/rama anterior, y si no
// se limpia queda visible apuntando a un PR que no tiene nada que ver con el
// repo activo nuevo.
watch(() => [props.id, props.path] as const, () => {
  retry.value = null
  actionErr.value = ''
  prUrl.value = ''
  refresh()
}, { immediate: true })
onBeforeUnmount(() => { if (t) clearTimeout(t) })

const repoLabel = computed(() => {
  if (!status.value) return null
  const { branch, ahead, behind } = status.value.overview
  return { name: status.value.repo.name || status.value.repo.rel || '·', branch, ahead, behind }
})
const pr = computed(() => (status.value ? canCreatePr(status.value.overview) : { can: false, why: '' }))

// Una sola acción primaria por contexto: antes los cinco botones de la barra
// pesaban igual y no había forma de saber cuál correspondía.
//
// Ojo con la señal: `ahead` NO sirve para "falta pushear" — cuenta commits por
// encima de origin/<default>, no contra origin/<branch>, así que con la rama
// pusheada al día `ahead` sigue en 2 o 3. La señal honesta es `pushed` por
// commit, que sale de git. `behind` sí cuenta contra el default, así que sirve
// para decidir "traer el default".
const unpushedCount = computed(() => status.value?.commits.filter((c) => !c.pushed).length ?? 0)
const primary = computed<'push' | 'merge-default' | 'fetch'>(() => {
  const s = status.value
  if (!s) return 'fetch'
  if (unpushedCount.value > 0) return 'push'
  if (s.overview.behind > 0) return 'merge-default'
  return 'fetch'
})

// Lo que espera acción del usuario en la pestaña Cambios: conflictos primero
// (bloquean), después lo que hay para stagear o commitear.
const pendingCount = computed(() => {
  const w = status.value?.working
  if (!w) return 0
  return w.conflicted.length + w.staged.length + w.unstaged.length + w.untracked.length
})
// Traduce el discriminante del 409 (ver reason409 en useGit) a algo que se entienda.
// 'repo-arriba' era el caso mentiroso: el panel decía "sin repo git acá" cuando SÍ
// había repo y el motivo real era que su raíz está fuera del alcance de la sesión.
const errMsg = computed(() => {
  switch (error.value) {
    case 'sin-repo': return 'sin repo git acá'
    case 'sin-sesion': return 'este pod no tiene un directorio asociado'
    case 'repo-arriba': return 'el repo está por encima del directorio de la sesión: fuera de alcance'
    case 'repo-afuera': return 'el repo apunta fuera del directorio de la sesión: fuera de alcance'
    default: return error.value
  }
})
defineExpose({ repoLabel, refresh })
</script>

<template>
  <div class="gp">
    <!-- Tres pestañas, todas en español: antes eran cuatro y mezclaba idiomas
         (Trabajo | Rama | Branches | Commits). El contador de cambios va en la
         pestaña porque es el dato que decide si entrar. -->
    <nav class="gp-tabs" role="tablist" aria-label="Vistas de git">
      <button role="tab" :aria-selected="tab === 'work'" :class="{ on: tab === 'work' }" @click="tab = 'work'">
        Cambios
        <span v-if="pendingCount" class="g-count">{{ pendingCount }}</span>
      </button>
      <button role="tab" :aria-selected="tab === 'branches'" :class="{ on: tab === 'branches' }" @click="tab = 'branches'">
        Ramas
      </button>
      <button role="tab" :aria-selected="tab === 'commits'" :class="{ on: tab === 'commits' }" @click="tab = 'commits'">
        Historial
      </button>
    </nav>

    <p v-if="error" class="g-err">{{ errMsg }}</p>
    <p v-if="actionErr" class="g-err">{{ actionErr }}</p>
    <p v-if="prUrl" class="gp-pr"><a :href="prUrl" target="_blank" rel="noopener">{{ prUrl }}</a></p>
    <!-- La salida del checkout que falló por árbol sucio. No es un error nuevo:
         es la acción de recuperación del error de arriba, así que va pegada. -->
    <p v-if="retry" class="gp-retry">
      <button class="g-btn" :disabled="!!busy" @click="stashAndRetry">
        <GitIcon name="stack" />
        Stashear y reintentar
      </button>
    </p>
    <p v-if="loading" class="g-muted gp-loading">cargando…</p>

    <div v-if="status" class="gp-body">
      <GitWork v-if="tab === 'work'" :status="status" :stash="stash" @run="run" @diff="openDiff" />
      <GitBranches v-else-if="tab === 'branches'" ref="branchesEl" :id="props.id" :path="props.path" @run="run" />
      <template v-else>
        <!-- El diff contra el default encabeza el historial: es el resumen de
             "qué cambia mi rama", y los commits son el detalle de lo mismo. -->
        <section class="g-group">
          <h4>
            Contra {{ status.overview.default }}
            <span class="g-count">{{ status.overview.files.length }}</span>
          </h4>
          <GitBranchDiff :status="status" @diff="openDiff" />
        </section>
        <GitCommits :status="status" :id="props.id" :path="props.path" @diff="openDiff" />
      </template>
    </div>

    <!-- Barra fija: visible desde cualquier sub-pestaña. Es la corrección al
         problema original (los botones estaban enterrados en una pestaña).
         Una sola acción va marcada como primaria según el estado del repo; el
         resto queda secundario, y el PR aparte porque es la única que sale
         hacia afuera (crea algo en GitHub). -->
    <footer v-if="status" class="gp-actions">
      <button class="g-btn" :class="{ primary: primary === 'merge-default' }" :disabled="busy === 'merge-default'"
        @click="run('merge-default', {}, `Traer ${status.overview.default} a la rama?`)">
        <GitIcon name="merge" />
        Actualizar
        <span v-if="status.overview.behind" class="g-count">{{ status.overview.behind }}</span>
      </button>
      <button class="g-btn" :class="{ primary: primary === 'fetch' }" :disabled="busy === 'fetch'"
        @click="run('fetch')">
        <GitIcon name="refresh" />
        Fetch
      </button>
      <button class="g-btn" :disabled="busy === 'pull'" @click="run('pull')">
        <GitIcon name="download" />
        Pull
      </button>
      <button class="g-btn" :class="{ primary: primary === 'push' }" :disabled="busy === 'push'"
        @click="run('push')">
        <GitIcon name="upload" />
        Push
        <span v-if="unpushedCount" class="g-count">{{ unpushedCount }}</span>
      </button>
      <button class="g-btn gp-pr-btn" :disabled="busy === 'pr-create' || !pr.can" :title="pr.why"
        @click="doPr">
        <GitIcon name="pr" />
        PR
      </button>
    </footer>

    <GitDiff v-if="diff" :file="diff.file" :hunks="diff.hunks" :binary="diff.binary" @close="diff = null" />
  </div>
</template>

<style scoped>
.gp { position: relative; display: flex; flex-direction: column; min-height: 0; flex: 1; }

/* Pestañas: 44px como todo lo tocable (antes 40) y 8px de separación. */
.gp-tabs { display: flex; gap: var(--g-gap); padding: var(--g-gap) var(--g-pad); }
.gp-tabs button {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: .4rem;
  min-height: var(--g-target);
  padding: 0 .5rem;
  font-family: var(--font-system);
  font-size: .95rem;
  color: var(--color-dim);
  background: transparent;
  border: 1px solid var(--color-edge);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: color 160ms ease-out, border-color 160ms ease-out;
}
.gp-tabs button:hover { color: var(--color-ink-2); border-color: var(--color-edge-soft); }
/* La pestaña activa no se marca sólo por color: además lleva el peso y el
   borde brass, y aria-selected para el lector de pantalla. */
.gp-tabs button.on {
  color: var(--color-brass);
  border-color: var(--color-brass);
  font-weight: 600;
  background: color-mix(in srgb, var(--color-brass) 12%, transparent);
}
.gp-tabs button.on .g-count { color: var(--color-brass); }

.gp-body { flex: 1; overflow: auto; padding: var(--g-gap) var(--g-pad); }

.gp-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--g-gap);
  padding: var(--g-gap) var(--g-pad);
  border-top: 1px solid var(--color-edge);
  background: var(--color-surface);
}
/* El PR empuja a la derecha: es la única acción que sale hacia afuera, y
   separarla evita tocarla apuntando a Push. */
.gp-pr-btn { margin-left: auto; }

.gp-retry { margin: 0 0 var(--g-gap); }
.gp-loading { padding: 0 var(--g-pad); }

.gp-pr { padding: 0 var(--g-pad); font-size: .9rem; overflow-wrap: anywhere; }
.gp-pr a { color: var(--color-brass); font-family: var(--font-machine); }

/* Tablet en vertical y teléfono: las acciones no caben en una fila sin
   apretarse, así que se reparten en dos columnas de target completo. */
@media (max-width: 640px) {
  .gp-actions > .g-btn { flex: 1 1 calc(50% - var(--g-gap)); }
  .gp-pr-btn { margin-left: 0; }
}
</style>
