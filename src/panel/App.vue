<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type {
  NovaDevtoolsNodeDetails,
  NovaDevtoolsStyleTrace,
  NovaDevtoolsTreeSnapshot,
} from '@/protocol'
import { requestNovaDevtools } from '@/panel/NovaDevtoolsClient'
import NovaTreeView from '@/panel/features/tree/NovaTreeView.vue'

const tree = ref<NovaDevtoolsTreeSnapshot>({ apps: [] })
const selectedId = ref<string | null>(null)
const selectedNode = ref<NovaDevtoolsNodeDetails | null>(null)
const styleTrace = ref<NovaDevtoolsStyleTrace | null>(null)
const propsDraft = ref('{}')
const styleDraft = ref('')
const errorMessage = ref('')
const statusMessage = ref('Bridge idle')
const loading = ref(false)

let refreshTimer: number | undefined

const hasRuntime = computed(() => tree.value.apps.length > 0)
const diagnostics = computed(() => styleTrace.value?.diagnostics ?? [])

onMounted(() => {
  void refreshAll()
  refreshTimer = window.setInterval(() => {
    void refreshTree()
  }, 2_000)
})

onBeforeUnmount(() => {
  if (refreshTimer) window.clearInterval(refreshTimer)
  void requestNovaDevtools('clearHighlight').catch(() => undefined)
})

/** Обновляет дерево и текущий selection. */
async function refreshAll(): Promise<void> {
  await refreshTree()
  if (selectedId.value) {
    await inspectNode(selectedId.value)
  }
}

/** Обновляет tree snapshot без чтения тяжелых details. */
async function refreshTree(): Promise<void> {
  try {
    tree.value = await requestNovaDevtools<NovaDevtoolsTreeSnapshot>('getTree')
    errorMessage.value = ''
    statusMessage.value = hasRuntime.value ? 'Connected' : 'Runtime bridge not found'
  } catch (error) {
    tree.value = { apps: [] }
    statusMessage.value = 'Disconnected'
    errorMessage.value = error instanceof Error ? error.message : String(error)
  }
}

/** Выбирает node, подсвечивает ее на canvas и читает детали. */
async function selectNode(nodeId: string): Promise<void> {
  selectedId.value = nodeId
  await inspectNode(nodeId)
  await requestNovaDevtools('highlightNode', { nodeId }).catch(() => undefined)
}

/** Читает details и style trace выбранной node. */
async function inspectNode(nodeId: string): Promise<void> {
  loading.value = true
  try {
    const details = await requestNovaDevtools<NovaDevtoolsNodeDetails | null>('inspectNode', { nodeId })
    selectedNode.value = details
    propsDraft.value = JSON.stringify(details?.props ?? {}, null, 2)
    styleTrace.value = await requestNovaDevtools<NovaDevtoolsStyleTrace | null>('getStyleTrace', { nodeId })
    styleDraft.value = styleTrace.value?.styleSheetSource ?? ''
    errorMessage.value = ''
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    loading.value = false
  }
}

/** Применяет JSON patch props к runtime node. */
async function applyProps(): Promise<void> {
  if (!selectedId.value) return

  try {
    const props = JSON.parse(propsDraft.value) as Record<string, unknown>
    selectedNode.value = await requestNovaDevtools<NovaDevtoolsNodeDetails | null>('mutateNodeProps', {
      nodeId: selectedId.value,
      props,
    })
    statusMessage.value = 'Props applied'
    await refreshAll()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error)
  }
}

/** Применяет source Root.styleSheet к живому Nova UI Kit дереву. */
async function applyStyleSheet(): Promise<void> {
  if (!selectedId.value || !styleTrace.value) return

  try {
    styleTrace.value = await requestNovaDevtools<NovaDevtoolsStyleTrace | null>('setRootStyleSheet', {
      rootComponentId: styleTrace.value.rootComponentId,
      nodeId: selectedId.value,
      source: styleDraft.value,
    })
    statusMessage.value = 'Stylesheet applied'
    await refreshTree()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error)
  }
}
</script>

<template>
  <main class="devtools-shell">
    <header class="devtools-header">
      <div>
        <h1>Nova</h1>
        <p>{{ statusMessage }}</p>
      </div>
      <button
        class="toolbar-button"
        type="button"
        @click="refreshAll"
      >
        Refresh
      </button>
    </header>

    <section
      v-if="errorMessage"
      class="error-strip"
    >
      {{ errorMessage }}
    </section>

    <section class="devtools-split">
      <div class="top-panes">
        <aside class="tree-pane">
          <div class="pane-title">
            Runtime tree
          </div>
          <NovaTreeView
            v-if="hasRuntime"
            :nodes="tree.apps"
            :selected-id="selectedId"
            @select="selectNode"
          />
          <div
            v-else
            class="empty-state"
          >
            Open a page with installed Nova DevTools runtime bridge.
          </div>
        </aside>

        <section class="details-pane">
          <div class="pane-title">
            Node
          </div>
          <div
            v-if="selectedNode"
            class="details-stack"
          >
            <div class="node-summary">
              <strong>{{ selectedNode.label }}</strong>
              <span>{{ selectedNode.type }}</span>
              <span v-if="selectedNode.componentId">#{{ selectedNode.componentId }}</span>
            </div>

            <dl class="metric-grid">
              <div>
                <dt>Bounds</dt>
                <dd>{{ selectedNode.bounds?.x }}, {{ selectedNode.bounds?.y }} / {{ selectedNode.bounds?.width }}x{{ selectedNode.bounds?.height }}</dd>
              </div>
              <div>
                <dt>Children</dt>
                <dd>{{ selectedNode.childCount }}</dd>
              </div>
              <div>
                <dt>Lifecycle</dt>
                <dd>{{ selectedNode.lifecycleState }}</dd>
              </div>
              <div>
                <dt>Flags</dt>
                <dd>{{ selectedNode.flags.visible ? 'visible' : 'hidden' }} · {{ selectedNode.flags.interactive ? 'interactive' : 'static' }}</dd>
              </div>
            </dl>

            <label class="editor-label">
              Props JSON
              <textarea
                v-model="propsDraft"
                class="code-editor"
                spellcheck="false"
              />
            </label>

            <button
              class="primary-button"
              type="button"
              :disabled="loading"
              @click="applyProps"
            >
              Apply props
            </button>
          </div>
          <div
            v-else
            class="empty-state"
          >
            Select a Nova node.
          </div>
        </section>
      </div>

      <section class="styles-pane">
        <div class="pane-title">
          Nova Styles
        </div>
        <div
          v-if="styleTrace"
          class="styles-split-content"
        >
          <div class="style-editor-pane">
            <label class="editor-label">
              Root.styleSheet
              <textarea
                v-model="styleDraft"
                class="style-editor"
                spellcheck="false"
              />
            </label>

            <button
              class="primary-button"
              type="button"
              @click="applyStyleSheet"
            >
              Apply stylesheet
            </button>
          </div>

          <div class="style-trace-pane">
            <section
              v-if="diagnostics.length"
              class="diagnostics"
            >
              <div
                v-for="diagnostic in diagnostics"
                :key="`${diagnostic.code}-${diagnostic.line}-${diagnostic.column}`"
                class="diagnostic-row"
              >
                <strong>{{ diagnostic.severity }}</strong>
                <span>{{ diagnostic.message }}</span>
              </div>
            </section>

            <section class="rules-list">
              <h2>Matched rules</h2>
              <article
                v-for="rule in styleTrace.matchedRules"
                :key="`${rule.selector}-${rule.order}`"
                class="rule-row"
              >
                <header>
                  <strong>{{ rule.selector }}</strong>
                  <span>{{ rule.specificity }} / {{ rule.order }}</span>
                </header>
                <pre>{{ JSON.stringify(rule.declarations, null, 2) }}</pre>
              </article>
            </section>
          </div>
        </div>
        <div
          v-else
          class="empty-state"
        >
          Selected node is outside Nova UI Kit Root.
        </div>
      </section>
    </section>
  </main>
</template>
