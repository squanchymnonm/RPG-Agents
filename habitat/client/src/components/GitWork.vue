<script setup lang="ts">
import { ref } from 'vue'
import type { GitStatus, GitFile, DiffBase, StashEntry } from '../composables/useGit'

const props = defineProps<{ status: GitStatus; stash: StashEntry[] }>()
const emit = defineEmits<{
  (e: 'run', name: string, payload?: { paths?: string[]; message?: string; index?: number }, confirmMsg?: string): void
  (e: 'diff', file: string, base: DiffBase): void
}>()

const commitMsg = ref('')
const stashMsg = ref('')
function paths(list: GitFile[]) { return list.map((f) => f.rel) }
function doCommit() {
  if (!commitMsg.value.trim()) return
  emit('run', 'commit', { message: commitMsg.value })
  commitMsg.value = ''
}
</script>

<template>
  <div v-if="props.status.working.conflicted.length" class="g-group">
    <h4>En conflicto</h4>
    <ul>
      <li v-for="f in props.status.working.conflicted" :key="f.rel">
        <span class="g-st conf">{{ f.status }}</span> {{ f.rel }}
      </li>
    </ul>
    <button class="g-act g-danger" @click="emit('run', 'abort', {}, 'Abortar el merge en curso?')">Abortar merge</button>
  </div>

  <div class="g-group">
    <h4>Staged ({{ props.status.working.staged.length }})
      <button v-if="props.status.working.staged.length" class="g-mini"
        @click="emit('run', 'unstage', { paths: paths(props.status.working.staged) })">unstage all</button>
    </h4>
    <ul>
      <li v-for="f in props.status.working.staged" :key="f.rel">
        <span class="g-st">{{ f.status }}</span>
        <a @click="emit('diff', f.rel, 'staged')">{{ f.rel }}</a>
        <button class="g-mini" @click="emit('run', 'unstage', { paths: [f.rel] })">−</button>
      </li>
    </ul>
  </div>

  <div class="g-group">
    <h4>Sin stagear ({{ props.status.working.unstaged.length + props.status.working.untracked.length }})</h4>
    <ul>
      <li v-for="f in props.status.working.unstaged" :key="'u' + f.rel">
        <span class="g-st">{{ f.status }}</span>
        <a @click="emit('diff', f.rel, 'working')">{{ f.rel }}</a>
        <button class="g-mini" @click="emit('run', 'stage', { paths: [f.rel] })">+</button>
        <button class="g-mini g-danger"
          @click="emit('run', 'discard', { paths: [f.rel] }, `Descartar cambios de ${f.rel}? No se puede deshacer.`)">⌦</button>
      </li>
      <li v-for="f in props.status.working.untracked" :key="'n' + f.rel">
        <span class="g-st new">?</span>
        <a @click="emit('diff', f.rel, 'working')">{{ f.rel }}</a>
        <button class="g-mini" @click="emit('run', 'stage', { paths: [f.rel] })">+</button>
      </li>
    </ul>
  </div>

  <div class="g-group">
    <h4>Stash ({{ props.stash.length }})
      <button class="g-mini" @click="emit('run', 'stash-push', { message: stashMsg })">guardar</button>
    </h4>
    <input v-model="stashMsg" class="gw-stash-msg" placeholder="etiqueta del stash (opcional)" />
    <ul>
      <li v-for="s in props.stash" :key="s.index">
        <span class="g-st">≡</span>
        <span class="gw-flat">{{ s.message }}</span>
        <button class="g-mini" @click="emit('run', 'stash-apply', { index: s.index })">aplicar</button>
        <button class="g-mini g-danger"
          @click="emit('run', 'stash-drop', { index: s.index }, 'Borrar este stash? No se puede deshacer.')">⌦</button>
      </li>
    </ul>
  </div>

  <div class="g-commit">
    <input v-model="commitMsg" placeholder="mensaje de commit" @keyup.enter="doCommit" />
    <button class="g-act" :disabled="!commitMsg.trim()" @click="doCommit">Commit</button>
  </div>
</template>

<style scoped>
.g-commit { display: flex; gap: .4rem; margin-top: .5rem; }
.g-commit input { flex: 1; padding: .5rem; min-height: 44px; background: var(--color-raise, #2a2018); color: inherit; border: 1px solid var(--color-line, #3a2e22); border-radius: var(--radius-sm, 4px); }
.gw-stash-msg { width: 100%; padding: .4rem; min-height: 36px; background: var(--color-raise, #2a2018); color: inherit; border: 1px solid var(--color-line, #3a2e22); border-radius: var(--radius-sm, 4px); margin-bottom: .3rem; }
.gw-flat { flex: 1; }
</style>
