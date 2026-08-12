<script setup lang="ts">
import { ref, watch, onBeforeUnmount, computed } from 'vue'
import { useGit, type DiffBase, type StashEntry } from '../composables/useGit'
import { parseDiff, type DiffHunk } from '../composables/parseDiff'
import { useSessions } from '../stores/sessions'
import GitWork from './GitWork.vue'
import GitBranchDiff from './GitBranchDiff.vue'
import GitBranches from './GitBranches.vue'
import GitCommits from './GitCommits.vue'
import GitDiff from './GitDiff.vue'
import '../styles/git.css'

const props = defineProps<{ id: string; path: string }>()

const store = useSessions()
const { status, loading, error, loadStatus, loadDiff, loadStash, action } = useGit()

const tab = ref<'work' | 'branches' | 'commits' | 'branch'>('work')
const branchesEl = ref<InstanceType<typeof GitBranches> | null>(null)
const diff = ref<{ file: string; hunks: DiffHunk[]; binary: boolean } | null>(null)
const busy = ref('')
const actionErr = ref('')
const stash = ref<StashEntry[]>([])
// Cuando el checkout falla por árbol sucio, ofrecemos la salida útil en vez de
// dejar al usuario con un error de git.
const retry = ref<{ branch: string } | null>(null)

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

async function stashAndRetry() {
  const branch = retry.value?.branch
  if (!branch) return
  retry.value = null
  const s = await action(props.id, 'stash-push', { path: props.path, message: `auto antes de ir a ${branch}` })
  if (!s.ok) { actionErr.value = s.message || 'no se pudo stashear'; return }
  await run('checkout', { branch })
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
watch(() => [props.id, props.path] as const, () => {
  retry.value = null
  actionErr.value = ''
  refresh()
}, { immediate: true })
onBeforeUnmount(() => { if (t) clearTimeout(t) })

const repoLabel = computed(() => {
  if (!status.value) return null
  const { branch, ahead, behind } = status.value.overview
  return { name: status.value.repo.name || status.value.repo.rel || '·', branch, ahead, behind }
})
defineExpose({ repoLabel, refresh })
</script>

<template>
  <div class="gp">
    <nav class="gp-tabs">
      <button :class="{ on: tab === 'work' }" @click="tab = 'work'">Trabajo</button>
      <button :class="{ on: tab === 'branch' }" @click="tab = 'branch'">Rama</button>
      <button :class="{ on: tab === 'branches' }" @click="tab = 'branches'">Branches</button>
      <button :class="{ on: tab === 'commits' }" @click="tab = 'commits'">Commits</button>
    </nav>

    <p v-if="error" class="g-err">{{ error === 'sin-dir' ? 'sin repo git acá' : error }}</p>
    <p v-if="actionErr" class="g-err">{{ actionErr }}</p>
    <p v-if="retry" class="g-err">
      <button class="g-mini" @click="stashAndRetry">Stashear y reintentar</button>
    </p>
    <p v-if="loading" class="g-muted">cargando…</p>

    <div v-if="status" class="gp-body">
      <GitWork v-if="tab === 'work'" :status="status" :stash="stash" @run="run" @diff="openDiff" />
      <GitBranchDiff v-else-if="tab === 'branch'" :status="status" @diff="openDiff" />
      <GitBranches v-else-if="tab === 'branches'" ref="branchesEl" :id="props.id" :path="props.path" @run="run" />
      <GitCommits v-else :status="status" :id="props.id" :path="props.path" @diff="openDiff" />
    </div>

    <!-- Barra fija: visible desde cualquier sub-pestaña. Es la corrección al
         problema original (los botones estaban enterrados en una pestaña). -->
    <footer v-if="status" class="gp-actions">
      <button class="g-act" :disabled="busy === 'merge-default'"
        @click="run('merge-default', {}, `Traer ${status.overview.default} a la rama?`)">↻ Actualizar</button>
      <button class="g-act" :disabled="busy === 'fetch'" @click="run('fetch')">Fetch</button>
      <button class="g-act" :disabled="busy === 'pull'" @click="run('pull')">Pull</button>
      <button class="g-act" :disabled="busy === 'push'" @click="run('push')">Push</button>
    </footer>

    <GitDiff v-if="diff" :file="diff.file" :hunks="diff.hunks" :binary="diff.binary" @close="diff = null" />
  </div>
</template>

<style scoped>
.gp { position: relative; display: flex; flex-direction: column; min-height: 0; flex: 1; }
.gp-tabs { display: flex; gap: .25rem; padding: .4rem .75rem; }
.gp-tabs button { flex: 1; padding: .35rem; min-height: 40px; background: transparent; color: inherit; border: 1px solid var(--color-line, #3a2e22); border-radius: var(--radius-sm, 4px); cursor: pointer; }
.gp-tabs button.on { background: var(--color-brass, #c79a4b); color: #1a1410; font-weight: 700; }
.gp-body { flex: 1; overflow: auto; padding: .5rem .75rem; }
.gp-actions { display: flex; flex-wrap: wrap; gap: .4rem; padding: .5rem .75rem; border-top: 1px solid var(--color-line, #3a2e22); }
</style>
