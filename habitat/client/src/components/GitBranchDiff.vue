<script setup lang="ts">
import type { GitStatus, DiffBase } from '../composables/useGit'
const props = defineProps<{ status: GitStatus }>()
const emit = defineEmits<{ (e: 'diff', file: string, base: DiffBase): void }>()
</script>

<template>
  <ul class="g-group">
    <li v-for="f in props.status.overview.files" :key="f.rel">
      <span class="g-st">{{ f.status }}</span>
      <a @click="emit('diff', f.rel, 'branch')">{{ f.rel }}</a>
    </li>
    <li v-if="!props.status.overview.files.length" class="g-muted">
      sin diferencias con {{ props.status.overview.default }}
    </li>
  </ul>
</template>
