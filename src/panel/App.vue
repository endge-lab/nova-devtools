<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type {
  NovaDevtoolsElementPickerState,
  NovaDevtoolsNodeDetails,
  NovaDevtoolsSerializable,
  NovaDevtoolsStyleTrace,
  NovaDevtoolsTreeSnapshot,
} from '@/protocol'
import { requestNovaDevtools } from '@/panel/nova-devtools-client'
import {
  filterTreeBySelectedApp,
  normalizeSelectedAppId,
  NOVA_DEVTOOLS_AUTO_APP_ID,
  resolvePickerAppId,
  shouldShowCanvasSelector,
  type NovaDevtoolsAppSelection,
} from '@/panel/nova-devtools-panel-state'
import NovaTreeView from '@/panel/features/tree/NovaTreeView.vue'

const tree = ref<NovaDevtoolsTreeSnapshot>({ apps: [] })
const selectedAppId = ref<NovaDevtoolsAppSelection>(NOVA_DEVTOOLS_AUTO_APP_ID)
const selectedId = ref<string | null>(null)
const focusedId = ref<string | null>(null)
const selectedNode = ref<NovaDevtoolsNodeDetails | null>(null)
const styleTrace = ref<NovaDevtoolsStyleTrace | null>(null)
const propsDraft = ref('{}')
const styleDraft = ref('')
const errorMessage = ref('')
const statusMessage = ref('Bridge idle')
const loading = ref(false)
const inspecting = ref(false)
const shellSplitRef = ref<HTMLElement | null>(null)
const topPanesRef = ref<HTMLElement | null>(null)
const stylesContentRef = ref<HTMLElement | null>(null)
const topPaneRatio = ref(48)
const treePaneRatio = ref(40)
const styleEditorRatio = ref(48)

let refreshTimer: number | undefined
let pickerTimer: number | undefined
let colorApplyTimer: number | undefined
let resizeDispose: (() => void) | undefined

interface StyleInspectorRow {
  source: string
  path: string
  label: string
  value: string
  colorHex: string | null
  declarationKey: string | null
}

const hasRuntime = computed(() => tree.value.apps.length > 0)
const visibleTree = computed(() => filterTreeBySelectedApp(tree.value, selectedAppId.value))
const showCanvasSelector = computed(() => shouldShowCanvasSelector(tree.value.apps))
const diagnostics = computed(() => styleTrace.value?.diagnostics ?? [])
const shellSplitStyle = computed<Record<string, string>>(() => ({
  '--top-pane-size': `${topPaneRatio.value}%`,
}))
const topPanesStyle = computed<Record<string, string>>(() => ({
  '--tree-pane-size': `${treePaneRatio.value}%`,
}))
const stylesContentStyle = computed<Record<string, string>>(() => ({
  '--style-editor-size': `${styleEditorRatio.value}%`,
}))
const styleRows = computed(() => {
  const trace = styleTrace.value
  if (!trace) return []

  return [
    ...flattenStyleRows('Cascade', trace.mergedDeclarations),
    ...flattenStyleRows('Current props', trace.currentProps),
  ]
})

onMounted(() => {
  void refreshAll()
  refreshTimer = window.setInterval(() => {
    void refreshTree()
  }, 2_000)
})

onBeforeUnmount(() => {
  if (refreshTimer) window.clearInterval(refreshTimer)
  stopPickerPolling()
  stopResizeTracking()
  if (colorApplyTimer) window.clearTimeout(colorApplyTimer)
  void requestNovaDevtools('stopElementPicker').catch(() => undefined)
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
    selectedAppId.value = normalizeSelectedAppId(tree.value.apps, selectedAppId.value)
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
  focusedId.value = null
  await inspectNode(nodeId)
  await requestNovaDevtools('highlightNode', { nodeId }).catch(() => undefined)
}

/** Подсвечивает node на canvas при наведении в Runtime tree без смены выбранных details. */
function focusNode(nodeId: string): void {
  focusedId.value = nodeId
  void requestNovaDevtools('highlightNode', { nodeId }).catch(() => undefined)
}

/** Возвращает подсветку к выбранной node после ухода курсора с Runtime tree row. */
function blurNode(nodeId: string): void {
  if (focusedId.value !== nodeId) return

  focusedId.value = null

  if (selectedId.value) {
    void requestNovaDevtools('highlightNode', { nodeId: selectedId.value }).catch(() => undefined)
    return
  }

  void requestNovaDevtools('clearHighlight').catch(() => undefined)
}

/** Включает или выключает page-side picker, похожий на Chrome Elements selector. */
async function toggleElementPicker(): Promise<void> {
  try {
    if (inspecting.value) {
      await requestNovaDevtools<NovaDevtoolsElementPickerState>('stopElementPicker')
      inspecting.value = false
      stopPickerPolling()
      return
    }

    const appId = resolvePickerAppId(selectedAppId.value)
    const state = await requestNovaDevtools<NovaDevtoolsElementPickerState>(
      'startElementPicker',
      appId ? { appId } : undefined,
    )
    inspecting.value = state.active
    startPickerPolling()
  } catch (error) {
    inspecting.value = false
    stopPickerPolling()
    errorMessage.value = error instanceof Error ? error.message : String(error)
  }
}

/** Читает hovered/selected node из inspected page во время picker mode. */
async function pollElementPicker(): Promise<void> {
  try {
    const state = await requestNovaDevtools<NovaDevtoolsElementPickerState>('getElementPickerState')
    inspecting.value = state.active
    const nodeId = state.hoveredNodeId ?? state.selectedNodeId

    if (nodeId && nodeId !== selectedId.value) {
      selectedId.value = nodeId
      await inspectNode(nodeId)
    }

    if (!state.active) stopPickerPolling()
  } catch (error) {
    inspecting.value = false
    stopPickerPolling()
    errorMessage.value = error instanceof Error ? error.message : String(error)
  }
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
    await applyStyleSheetSource(styleDraft.value)
    statusMessage.value = 'Stylesheet applied'
    await refreshTree()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error)
  }
}

/** Применяет цвет как stylesheet override для выбранного UI Kit component id. */
function applyColorStyle(row: StyleInspectorRow, color: string): void {
  const trace = styleTrace.value
  if (!trace || !row.declarationKey) return

  const nextSource = appendStyleOverride(styleDraft.value, trace.nodeComponentId, row.declarationKey, color)
  styleDraft.value = nextSource
  statusMessage.value = `Style ${row.declarationKey} changed`

  if (colorApplyTimer) window.clearTimeout(colorApplyTimer)
  colorApplyTimer = window.setTimeout(() => {
    void applyStyleSheetSource(nextSource).catch(error => {
      errorMessage.value = error instanceof Error ? error.message : String(error)
    })
  }, 80)
}

/** Обрабатывает input[type=color] без дополнительного state на каждую строку. */
function handleColorInput(row: StyleInspectorRow, event: Event): void {
  const target = event.target as HTMLInputElement | null
  if (target) applyColorStyle(row, target.value)
}

/** Применяет stylesheet source и обновляет trace для текущей node. */
async function applyStyleSheetSource(source: string): Promise<void> {
  if (!selectedId.value || !styleTrace.value) return

  styleTrace.value = await requestNovaDevtools<NovaDevtoolsStyleTrace | null>('setRootStyleSheet', {
    rootComponentId: styleTrace.value.rootComponentId,
    nodeId: selectedId.value,
    source,
  })
  errorMessage.value = ''
}

function startPickerPolling(): void {
  stopPickerPolling()
  pickerTimer = window.setInterval(() => {
    void pollElementPicker()
  }, 120)
}

function stopPickerPolling(): void {
  if (!pickerTimer) return
  window.clearInterval(pickerTimer)
  pickerTimer = undefined
}

function flattenStyleRows(
  source: string,
  value: Record<string, NovaDevtoolsSerializable>,
  prefix = '',
): Array<StyleInspectorRow> {
  const rows: Array<StyleInspectorRow> = []

  for (const [key, childValue] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (childValue && typeof childValue === 'object' && !Array.isArray(childValue)) {
      rows.push(...flattenStyleRows(source, childValue as Record<string, NovaDevtoolsSerializable>, path))
      continue
    }

    const textValue = formatStyleValue(childValue)
    rows.push({
      source,
      path,
      label: path.split('.').at(-1) ?? path,
      value: textValue,
      colorHex: normalizeColorInputValue(textValue),
      declarationKey: resolveStyleDeclarationKey(path),
    })
  }

  return rows
}

function formatStyleValue(value: NovaDevtoolsSerializable): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function normalizeColorInputValue(value: string): string | null {
  const hex = value.trim()
  const shortHexMatch = hex.match(/^#([0-9a-f]{3})$/i)
  if (shortHexMatch) {
    const [, source] = shortHexMatch
    return `#${source.split('').map(item => item + item).join('')}`
  }
  const fullHexMatch = hex.match(/^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i)
  if (fullHexMatch) return `#${fullHexMatch[1]}`

  const rgbMatch = hex.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i)
  if (!rgbMatch) return null

  const [, red, green, blue] = rgbMatch
  return `#${[red, green, blue]
    .map(channel => Math.max(0, Math.min(255, Number(channel))).toString(16).padStart(2, '0'))
    .join('')}`
}

function resolveStyleDeclarationKey(path: string): string | null {
  const declarationKeys: Record<string, string> = {
    'inheritedText.color': 'color',
    'box.background': 'background',
    'box.border.color': 'borderColor',
    'visual.accentColor': 'accentColor',
    'visual.trackColor': 'trackColor',
    'visual.thumbColor': 'thumbColor',
    'visual.hoverBackground': 'hoverBackground',
    'visual.pressedBackground': 'pressedBackground',
    'visual.activeBackground': 'activeBackground',
  }

  return declarationKeys[path] ?? null
}

function appendStyleOverride(source: string, componentId: string, key: string, value: string): string {
  const marker = `/* Nova DevTools override: ${componentId} ${key} */`
  const selector = `#${componentId}`
  const block = [
    marker,
    `${selector} {`,
    `  ${key}: ${value};`,
    '}',
  ].join('\n')
  const existingBlock = new RegExp(
    `\\n?${escapeRegExp(marker)}\\n${escapeRegExp(selector)}\\s*\\{[\\s\\S]*?\\}\\n?`,
    'm',
  )

  if (existingBlock.test(source)) {
    return source.replace(existingBlock, `\n${block}\n`)
  }

  const trimmed = source.trimEnd()

  return `${trimmed}\n\n${block}\n`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function startVerticalResize(event: PointerEvent): void {
  startResizeTracking(event, shellSplitRef.value, 'vertical', ratio => {
    topPaneRatio.value = ratio
  })
}

function startTopColumnsResize(event: PointerEvent): void {
  startResizeTracking(event, topPanesRef.value, 'horizontal', ratio => {
    treePaneRatio.value = ratio
  })
}

function startStyleColumnsResize(event: PointerEvent): void {
  startResizeTracking(event, stylesContentRef.value, 'horizontal', ratio => {
    styleEditorRatio.value = ratio
  })
}

function startResizeTracking(
  event: PointerEvent,
  container: HTMLElement | null,
  axis: 'horizontal' | 'vertical',
  update: (ratio: number) => void,
): void {
  if (!container) return

  event.preventDefault()
  stopResizeTracking()
  const move = (moveEvent: PointerEvent) => {
    const rect = container.getBoundingClientRect()
    const size = axis === 'horizontal' ? rect.width : rect.height
    const start = axis === 'horizontal' ? rect.left : rect.top
    const pointer = axis === 'horizontal' ? moveEvent.clientX : moveEvent.clientY

    update(resolveResizeRatio(pointer - start, size))
  }

  const up = () => {
    document.removeEventListener('pointermove', move)
    document.removeEventListener('pointerup', up)
    document.body.classList.remove('devtools-resizing')
    resizeDispose = undefined
  }
  resizeDispose = up

  document.body.classList.add('devtools-resizing')
  document.addEventListener('pointermove', move)
  document.addEventListener('pointerup', up)
  move(event)
}

function stopResizeTracking(): void {
  resizeDispose?.()
  resizeDispose = undefined
  document.body.classList.remove('devtools-resizing')
}

function resolveResizeRatio(offset: number, size: number): number {
  if (size <= 0) return 50

  const minRatio = Math.min(35, Math.max(12, 160 / size * 100))
  const maxRatio = 100 - minRatio
  const ratio = offset / size * 100

  return Math.max(minRatio, Math.min(maxRatio, ratio))
}
</script>

<template>
  <main class="devtools-shell">
    <header class="devtools-header">
      <div>
        <h1>Nova</h1>
        <p>{{ statusMessage }}</p>
      </div>
      <div class="devtools-toolbar">
        <select
          v-if="showCanvasSelector"
          v-model="selectedAppId"
          class="canvas-selector"
          title="Select Nova canvas"
        >
          <option :value="NOVA_DEVTOOLS_AUTO_APP_ID">
            Auto
          </option>
          <option
            v-for="app in tree.apps"
            :key="app.appId"
            :value="app.appId"
          >
            {{ app.label }}
          </option>
        </select>
        <button
          class="toolbar-button picker-button"
          :class="{ 'picker-button-active': inspecting }"
          type="button"
          title="Select Nova element on canvas"
          @click="toggleElementPicker"
        >
          <span class="picker-crosshair" />
          Select
        </button>
        <button
          class="toolbar-button"
          type="button"
          @click="refreshAll"
        >
          Refresh
        </button>
      </div>
    </header>

    <section
      v-if="errorMessage"
      class="error-strip"
    >
      {{ errorMessage }}
    </section>

    <section
      ref="shellSplitRef"
      class="devtools-split"
      :style="shellSplitStyle"
    >
      <div
        ref="topPanesRef"
        class="top-panes"
        :style="topPanesStyle"
      >
        <aside class="tree-pane">
          <div class="pane-title">
            Runtime tree
          </div>
          <NovaTreeView
            v-if="hasRuntime"
            :nodes="visibleTree.apps"
            :selected-id="selectedId"
            :focused-id="focusedId"
            @select="selectNode"
            @focus-node="focusNode"
            @blur-node="blurNode"
          />
          <div
            v-else
            class="empty-state"
          >
            Open a page with installed Nova DevTools runtime bridge.
          </div>
        </aside>

        <div
          class="split-resizer split-resizer-vertical"
          role="separator"
          aria-orientation="vertical"
          title="Resize tree and node panes"
          @pointerdown="startTopColumnsResize"
        />

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

      <div
        class="split-resizer split-resizer-horizontal"
        role="separator"
        aria-orientation="horizontal"
        title="Resize top and styles panes"
        @pointerdown="startVerticalResize"
      />

      <section class="styles-pane">
        <div class="pane-title">
          Nova Styles
        </div>
        <div
          v-if="styleTrace"
          ref="stylesContentRef"
          class="styles-split-content"
          :style="stylesContentStyle"
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

          <div
            class="split-resizer split-resizer-vertical split-resizer-styles"
            role="separator"
            aria-orientation="vertical"
            title="Resize stylesheet and computed styles panes"
            @pointerdown="startStyleColumnsResize"
          />

          <div class="style-trace-pane">
            <section
              v-if="styleRows.length"
              class="computed-styles"
            >
              <h2>Computed styles</h2>
              <div
                v-for="row in styleRows"
                :key="`${row.source}-${row.path}`"
                class="style-value-row"
              >
                <span class="style-value-source">{{ row.source }}</span>
                <span class="style-value-name">{{ row.path }}</span>
                <label
                  v-if="row.colorHex && row.declarationKey"
                  class="color-control"
                >
                  <input
                    :value="row.colorHex"
                    type="color"
                    @input="handleColorInput(row, $event)"
                  >
                  <span
                    class="color-swatch"
                    :style="{ background: row.colorHex }"
                  />
                  <span>{{ row.value }}</span>
                </label>
                <span
                  v-else
                  class="style-value-text"
                >
                  {{ row.value }}
                </span>
              </div>
            </section>

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
