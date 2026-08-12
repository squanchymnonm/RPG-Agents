<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useGit } from '../composables/useGit'
import { groupBranches, type BranchList } from '../composables/gitBranches'
import GitIcon from './GitIcon.vue'

const props = defineProps<{ id: string; path: string }>()
const emit = defineEmits<{
  (e: 'run', name: string, payload?: Record<string, unknown>, confirmMsg?: string): void
}>()

const { loadBranches } = useGit()
const data = ref<BranchList | null>(null)
const failed = ref(false)
const filter = ref('')
const creating = ref(false)
const newName = ref('')
const newFrom = ref<'default' | 'HEAD'>('default')

// `failed` distingue "todavía cargando" de "no se pudo cargar": sin él, con la red
// caída la pestaña quedaba en "cargando ramas…" para siempre.
async function refresh() {
  failed.value = false
  const r = await loadBranches(props.id, props.path)
  data.value = r
  failed.value = r === null
}
watch(() => [props.id, props.path] as const, refresh, { immediate: true })

const groups = computed(() => (data.value ? groupBranches(data.value, filter.value) : null))

function doCheckout(branch: string) { emit('run', 'checkout', { branch }) }
function doCreate() {
  if (!newName.value.trim()) return
  emit('run', 'branch-create', { branch: newName.value.trim(), from: newFrom.value })
  newName.value = ''; creating.value = false
}
defineExpose({ refresh })
</script>

<template>
  <div v-if="groups">
    <div class="gb-top">
      <input v-model="filter" class="g-input gb-find" placeholder="buscar rama" aria-label="Buscar rama" />
      <button class="g-btn" :aria-expanded="creating" @click="creating = !creating">
        <GitIcon name="plus" />
        nueva
      </button>
    </div>

    <div v-if="creating" class="gb-new">
      <input v-model="newName" class="g-input" placeholder="nombre de la rama" @keyup.enter="doCreate" />
      <select v-model="newFrom" class="g-select" aria-label="Punto de partida de la rama nueva">
        <option value="default">desde {{ data?.default }}</option>
        <option value="HEAD">desde HEAD</option>
      </select>
      <button class="g-btn" :class="{ primary: !!newName.trim() }" :disabled="!newName.trim()"
        @click="doCreate">Crear</button>
    </div>

    <ul class="g-group">
      <li v-for="b in groups.local" :key="b.name" :class="{ 'gb-current': b.current }">
        <!-- La rama actual no se marca sólo con un asterisco: lleva icono, el
             fondo del item y la etiqueta "actual". -->
        <span class="g-st">
          <GitIcon v-if="b.current" name="branch" />
        </span>
        <a v-if="!b.current && !b.takenBy" @click="doCheckout(b.name)">{{ b.name }}</a>
        <span v-else class="g-flat">{{ b.name }}</span>
        <span v-if="b.current" class="gb-tag">actual</span>
        <span v-else-if="b.takenBy" class="g-muted">abierta en {{ b.takenBy }}</span>
      </li>
      <li v-if="!groups.local.length" class="g-muted">
        {{ filter.trim() ? 'ninguna rama local coincide con el filtro' : 'sin ramas locales' }}
      </li>
    </ul>

    <h4 v-if="groups.remote.length">remotas</h4>
    <ul v-if="groups.remote.length" class="g-group">
      <!-- checkout, no branch-create: `git switch <short>` DWIMea la rama remota
           (la crea local siguiendo a origin/<short>, con SU contenido). Con
           branch-create/from:HEAD la rama nueva salía del HEAD local, sin el trabajo
           de la remota y sin upstream — y como groupBranches esconde las remotas que
           ya tienen local homónima, la remota real desaparecía de la lista. -->
      <li v-for="r in groups.remote" :key="r.name">
        <span class="g-st"></span>
        <span class="g-flat">{{ r.name }}</span>
        <button class="g-btn" :title="`crear la rama local ${r.short} siguiendo a ${r.name}`"
          @click="doCheckout(r.short)">
          <GitIcon name="download" />
          traer
        </button>
      </li>
    </ul>
  </div>
  <p v-else-if="failed" class="g-err">no se pudieron cargar las ramas</p>
  <p v-else class="g-muted">cargando ramas…</p>
</template>

<style scoped>
.gb-top { display: flex; gap: var(--g-gap); margin-bottom: var(--g-gap); }
.gb-find { flex: 1; min-width: 0; }

.gb-new {
  display: flex;
  flex-wrap: wrap;
  gap: var(--g-gap);
  margin-bottom: .75rem;
  padding: .6rem;
  border: 1px solid var(--color-edge);
  border-radius: var(--radius-card);
  background: var(--color-surface);
}
.gb-new .g-input { flex: 1; min-width: 9rem; }

.gb-current { background: color-mix(in srgb, var(--color-brass) 10%, transparent); }
.gb-current .g-st { color: var(--color-brass); }

/* Etiqueta de la rama actual: texto, no sólo color. */
.gb-tag {
  flex: none;
  padding: .1rem .45rem;
  font-family: var(--font-system);
  font-size: .8rem;
  color: var(--color-brass);
  border: 1px solid var(--color-brass);
  border-radius: 999px;
}
</style>
