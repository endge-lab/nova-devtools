<script setup lang="ts">
import type { NovaDevtoolsNodeSnapshot } from '@/protocol'

defineOptions({ name: 'NovaTreeView' })

defineProps<{
  nodes: Array<NovaDevtoolsNodeSnapshot>
  selectedId: string | null
  focusedId: string | null
}>()

const emit = defineEmits<{
  (event: 'select', nodeId: string): void
  (event: 'focus-node', nodeId: string): void
  (event: 'blur-node', nodeId: string): void
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
        :class="{
          'tree-row-active': node.id === selectedId,
          'tree-row-focused': node.id === focusedId && node.id !== selectedId,
        }"
        :style="{ paddingLeft: `${8 + node.depth * 12}px` }"
        type="button"
        @pointerenter="emit('focus-node', node.id)"
        @pointerleave="emit('blur-node', node.id)"
        @focus="emit('focus-node', node.id)"
        @blur="emit('blur-node', node.id)"
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
        :focused-id="focusedId"
        @select="id => emit('select', id)"
        @focus-node="id => emit('focus-node', id)"
        @blur-node="id => emit('blur-node', id)"
      />
    </li>
  </ol>
</template>
