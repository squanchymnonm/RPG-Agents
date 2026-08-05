<script setup lang="ts">
import type { GitStatus, DiffBase } from '../composables/useGit'
const props = defineProps<{ status: GitStatus }>()
const emit = defineEmits<{ (e: 'diff', file: string, base: DiffBase): void }>()
</script>

<template>
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

<style scoped>
.gc-row { border-bottom: 1px dashed var(--color-line, #3a2e22); padding: .4rem 0; font-size: .85rem; }
.gc-row code { color: var(--color-brass, #c79a4b); }
.gc-row .subj { opacity: .9; }
.gc-dot { display: inline-block; width: 1.2em; }
.gc-dot.pushed { color: #5fb36b; }
</style>
