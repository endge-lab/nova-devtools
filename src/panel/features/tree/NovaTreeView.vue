<script setup lang="ts">
import type { NovaDevtoolsNodeSnapshot } from '@/protocol'

defineOptions({ name: 'NovaTreeView' })

defineProps<{
  nodes: Array<NovaDevtoolsNodeSnapshot>
  selectedId: string | null
}>()

const emit = defineEmits<{
  (event: 'select', nodeId: string): void
}>()
</script>

<template>
  <ol class="tree-list">
    <li
      v-for="node in nodes"
      :key="node.id"
      class="tree-item"
    >
      <button
        class="tree-row"
        :class="{ 'tree-row-active': node.id === selectedId }"
        :style="{ paddingLeft: `${8 + node.depth * 12}px` }"
        type="button"
        @click="emit('select', node.id)"
      >
        <span class="tree-kind">{{ node.kind }}</span>
        <span class="tree-label">{{ node.label }}</span>
        <span
          v-if="node.childCount"
          class="tree-count"
        >{{ node.childCount }}</span>
      </button>

      <NovaTreeView
        v-if="node.children.length"
        :nodes="node.children"
        :selected-id="selectedId"
        @select="id => emit('select', id)"
      />
    </li>
  </ol>
</template>
