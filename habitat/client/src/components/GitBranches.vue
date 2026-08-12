<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useGit } from '../composables/useGit'
import { groupBranches, type BranchList } from '../composables/gitBranches'

const props = defineProps<{ id: string; path: string }>()
const emit = defineEmits<{
  (e: 'run', name: string, payload?: Record<string, unknown>, confirmMsg?: string): void
}>()

const { loadBranches } = useGit()
const data = ref<BranchList | null>(null)
const filter = ref('')
const creating = ref(false)
const newName = ref('')
const newFrom = ref<'default' | 'HEAD'>('default')

async function refresh() { data.value = await loadBranches(props.id, props.path) }
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
      <input v-model="filter" class="gb-find" placeholder="buscar rama" />
      <button class="g-mini" @click="creating = !creating">+ nueva</button>
    </div>

    <div v-if="creating" class="gb-new">
      <input v-model="newName" placeholder="nombre de la rama" @keyup.enter="doCreate" />
      <select v-model="newFrom">
        <option value="default">desde {{ data?.default }}</option>
        <option value="HEAD">desde HEAD</option>
      </select>
      <button class="g-act" :disabled="!newName.trim()" @click="doCreate">Crear</button>
    </div>

    <ul class="g-group">
      <li v-for="b in groups.local" :key="b.name">
        <span class="g-st">{{ b.current ? '*' : '' }}</span>
        <a v-if="!b.current && !b.takenBy" @click="doCheckout(b.name)">{{ b.name }}</a>
        <span v-else class="gb-flat">{{ b.name }}</span>
        <span v-if="b.current" class="g-muted">(actual)</span>
        <span v-else-if="b.takenBy" class="g-muted">abierta en {{ b.takenBy }}</span>
      </li>
      <li v-if="!groups.local.length" class="g-muted">sin ramas locales que coincidan</li>
    </ul>

    <h4 v-if="groups.remote.length">remotas</h4>
    <ul class="g-group">
      <li v-for="r in groups.remote" :key="r.name">
        <span class="g-st"></span>
        <span class="gb-flat">{{ r.name }}</span>
        <button class="g-mini" @click="emit('run', 'branch-create', { branch: r.short, from: 'HEAD' })">crear local</button>
      </li>
    </ul>
  </div>
  <p v-else class="g-muted">cargando ramas…</p>
</template>

<style scoped>
.gb-top { display: flex; gap: .4rem; margin-bottom: .5rem; }
.gb-find { flex: 1; padding: .4rem; background: var(--color-raise, #2a2018); color: inherit; border: 1px solid var(--color-line, #3a2e22); border-radius: var(--radius-sm, 4px); }
.gb-new { display: flex; flex-wrap: wrap; gap: .4rem; margin-bottom: .6rem; }
.gb-new input { flex: 1; min-width: 8rem; padding: .4rem; background: var(--color-raise, #2a2018); color: inherit; border: 1px solid var(--color-line, #3a2e22); border-radius: var(--radius-sm, 4px); }
.gb-new select { padding: .4rem; background: var(--color-raise, #2a2018); color: inherit; border: 1px solid var(--color-line, #3a2e22); border-radius: var(--radius-sm, 4px); }
.gb-flat { flex: 1; word-break: break-all; }
</style>
