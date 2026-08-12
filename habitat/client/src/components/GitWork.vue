<script setup lang="ts">
import { ref, computed } from 'vue'
import type { GitStatus, GitFile, DiffBase, StashEntry } from '../composables/useGit'
import GitIcon from './GitIcon.vue'

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
// overview.branch viene vacío cuando HEAD es unborn (`rev-parse --abbrev-ref HEAD`
// falla en un repo sin ningún commit): no hay nada que amendear.
const canAmend = computed(() => !!props.status.overview.branch)

// Todo lo que está sin stagear, trackeado o no: es lo que consume "stagear todo",
// simétrico al "unstage all" que ya existía y no tenía par.
const unstagedAll = computed(() => [
  ...props.status.working.unstaged,
  ...props.status.working.untracked,
])
const nothingToDo = computed(() =>
  !props.status.working.conflicted.length &&
  !props.status.working.staged.length &&
  !unstagedAll.value.length)

// status.commits son los commits en default..HEAD. El aviso estaba invertido:
// con la lista vacía `last` era undefined y `warn` undefined -> amend SIN
// confirmación, y ése es justo el caso en que HEAD está garantizado publicado (no
// hay nada local por encima del default). Ahora se avisa salvo que se sepa
// positivamente que el último commit NO está pusheado.
function doAmend() {
  const last = props.status.commits[0]
  const warn = last && !last.pushed
    ? undefined
    : 'El último commit ya está publicado: el amend reescribe historia y el próximo push va a ser rechazado (habría que forzarlo desde la terminal). Seguir?'
  emit('run', 'amend', { message: commitMsg.value }, warn)
  commitMsg.value = ''
}
</script>

<template>
  <!-- Zona 1: conflictos. Van primero porque bloquean todo lo demás. -->
  <section v-if="props.status.working.conflicted.length" class="g-group gw-conflict">
    <h4>
      En conflicto
      <span class="g-count">{{ props.status.working.conflicted.length }}</span>
    </h4>
    <ul>
      <li v-for="f in props.status.working.conflicted" :key="f.rel">
        <span class="g-st conf">{{ f.status }}</span>
        <span class="g-flat">{{ f.rel }}</span>
      </li>
    </ul>
    <button class="g-btn danger" @click="emit('run', 'abort', {}, 'Abortar el merge en curso?')">
      Abortar merge
    </button>
  </section>

  <!-- Zona 2: los cambios. Nada que hacer acá es un estado legítimo y se dice. -->
  <p v-if="nothingToDo" class="g-empty">
    El árbol está limpio: no hay cambios sin commitear.
  </p>

  <template v-else>
    <section v-if="props.status.working.staged.length" class="g-group">
      <h4>
        Staged
        <span class="g-count">{{ props.status.working.staged.length }}</span>
        <button class="g-btn gw-bulk"
          @click="emit('run', 'unstage', { paths: paths(props.status.working.staged) })">
          <GitIcon name="minus" />
          quitar todo
        </button>
      </h4>
      <ul>
        <li v-for="f in props.status.working.staged" :key="f.rel">
          <span class="g-st">{{ f.status }}</span>
          <a @click="emit('diff', f.rel, 'staged')">{{ f.rel }}</a>
          <button class="g-btn" :aria-label="`Quitar ${f.rel} del stage`"
            @click="emit('run', 'unstage', { paths: [f.rel] })">
            <GitIcon name="minus" />
          </button>
        </li>
      </ul>
    </section>

    <section v-if="unstagedAll.length" class="g-group">
      <h4>
        Sin stagear
        <span class="g-count">{{ unstagedAll.length }}</span>
        <!-- El simétrico de "quitar todo", que antes no existía. -->
        <button class="g-btn gw-bulk" @click="emit('run', 'stage', { paths: paths(unstagedAll) })">
          <GitIcon name="plus" />
          stagear todo
        </button>
      </h4>
      <ul>
        <li v-for="f in props.status.working.unstaged" :key="'u' + f.rel">
          <span class="g-st">{{ f.status }}</span>
          <a @click="emit('diff', f.rel, 'working')">{{ f.rel }}</a>
          <button class="g-btn" :aria-label="`Stagear ${f.rel}`"
            @click="emit('run', 'stage', { paths: [f.rel] })">
            <GitIcon name="plus" />
          </button>
          <!-- Descartar es irreversible: color semántico, icono explícito (antes
               era un ⌦ que no se entendía) y separado del + para no tocarlo
               apuntando al de al lado. -->
          <button class="g-btn danger g-danger-sep" :aria-label="`Descartar cambios de ${f.rel}`"
            @click="emit('run', 'discard', { paths: [f.rel] }, `Descartar cambios de ${f.rel}? No se puede deshacer.`)">
            <GitIcon name="trash" />
          </button>
        </li>
        <li v-for="f in props.status.working.untracked" :key="'n' + f.rel">
          <span class="g-st new">?</span>
          <a @click="emit('diff', f.rel, 'working')">{{ f.rel }}</a>
          <button class="g-btn" :aria-label="`Stagear ${f.rel}`"
            @click="emit('run', 'stage', { paths: [f.rel] })">
            <GitIcon name="plus" />
          </button>
        </li>
      </ul>
    </section>
  </template>

  <!-- Zona 3: commit. Anclada abajo del contenido, es el cierre del flujo. -->
  <section class="gw-commit">
    <input v-model="commitMsg" class="g-input" placeholder="mensaje de commit" @keyup.enter="doCommit" />
    <div class="gw-commit-row">
      <button class="g-btn" :class="{ primary: !!commitMsg.trim() }" :disabled="!commitMsg.trim()"
        @click="doCommit">
        <GitIcon name="check" />
        Commit
      </button>
      <button class="g-btn" :disabled="!canAmend"
        :title="canAmend ? 'reescribe el último commit' : 'el repo todavía no tiene commits'"
        @click="doAmend">amend</button>
    </div>
  </section>

  <!-- Zona 4: stash. Herramienta lateral, no parte del flujo principal. -->
  <section class="g-group gw-stash">
    <h4>
      <GitIcon name="stack" />
      Stash
      <span class="g-count">{{ props.stash.length }}</span>
    </h4>
    <div class="gw-stash-new">
      <input v-model="stashMsg" class="g-input" placeholder="etiqueta (opcional)" />
      <button class="g-btn" @click="emit('run', 'stash-push', { message: stashMsg })">guardar</button>
    </div>
    <ul>
      <li v-for="s in props.stash" :key="s.index">
        <span class="g-flat">{{ s.message }}</span>
        <button class="g-btn" @click="emit('run', 'stash-apply', { index: s.index })">aplicar</button>
        <button class="g-btn danger g-danger-sep" :aria-label="`Borrar el stash ${s.message}`"
          @click="emit('run', 'stash-drop', { index: s.index }, 'Borrar este stash? No se puede deshacer.')">
          <GitIcon name="trash" />
        </button>
      </li>
      <li v-if="!props.stash.length" class="g-muted">nada guardado</li>
    </ul>
  </section>
</template>

<style scoped>
/* Los conflictos se marcan con borde, no sólo con el color de la letra de
   estado: el color solo no alcanza para comunicar "esto está bloqueado". */
.gw-conflict {
  padding: .6rem;
  border: 1px solid var(--color-crimson);
  border-radius: var(--radius-card);
  background: color-mix(in srgb, var(--color-crimson) 10%, transparent);
}

/* Las acciones masivas van al final del encabezado, no pegadas al título. */
.gw-bulk { margin-left: auto; }

.gw-commit {
  display: flex;
  flex-direction: column;
  gap: var(--g-gap);
  margin: 1rem 0;
  padding-top: 1rem;
  border-top: 1px solid var(--color-edge);
}
.gw-commit .g-input { width: 100%; }
.gw-commit-row { display: flex; gap: var(--g-gap); }
.gw-commit-row .g-btn { flex: 1; }

.gw-stash-new { display: flex; gap: var(--g-gap); margin-bottom: var(--g-gap); }
.gw-stash-new .g-input { flex: 1; min-width: 0; }
</style>
