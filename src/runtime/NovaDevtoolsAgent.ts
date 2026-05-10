import {
  NovaNode,
  NovaSurface,
  type NovaApp,
  type NovaBounds,
  type NovaComponentNode,
} from '@endge/nova'
import type { NovaUiStyleInspectionDebug } from '@endge/nova-ui-kit'
import type {
  NovaDevtoolsAppSummary,
  NovaDevtoolsBounds,
  NovaDevtoolsElementPickerState,
  NovaDevtoolsNodeDetails,
  NovaDevtoolsNodeSnapshot,
  NovaDevtoolsRequest,
  NovaDevtoolsResponse,
  NovaDevtoolsStyleTrace,
  NovaDevtoolsTreeSnapshot,
} from '@/protocol'
import { toDevtoolsRecord } from '@/runtime/NovaDevtoolsSerialize'

interface RegisteredNovaApp {
  id: string
  label: string
  app: NovaApp<any>
}

export interface InstallNovaDevtoolsOptions {
  id?: string
  label?: string
}

interface NovaStyleRootApi {
  setStyleSheetSource?: (source: string) => void
  getStyleSheetSource?: () => string
  inspectStyleNode?: (node: string | any) => NovaUiStyleInspectionDebug | null
}

interface NodePatchPayload {
  nodeId: string
  props: Record<string, unknown>
}

interface StyleSheetPayload {
  rootComponentId: string
  source: string
  nodeId?: string
}

interface InspectAtPayload {
  appId: string
  x: number
  y: number
}

/** Runtime-agent, который отдает Nova state в Chrome DevTools panel. */
export class NovaDevtoolsAgent {
  private readonly apps = new Map<string, RegisteredNovaApp>()
  private readonly appIds = new WeakMap<NovaApp<any>, string>()
  private appCounter = 0
  private highlightElement: HTMLDivElement | null = null
  private pickerState: NovaDevtoolsElementPickerState = {
    active: false,
    hoveredNodeId: null,
    selectedNodeId: null,
    updatedAt: 0,
  }
  private pickerDispose: (() => void) | null = null

  /** Регистрирует NovaApp в debug bridge. */
  registerApp(app: NovaApp<any>, options: InstallNovaDevtoolsOptions = {}): () => void {
    const existingId = this.appIds.get(app)
    const id = options.id ?? existingId ?? `nova-app-${++this.appCounter}`
    const label = options.label ?? id

    this.appIds.set(app, id)
    this.apps.set(id, { id, label, app })

    return () => {
      if (this.apps.get(id)?.app === app) {
        this.apps.delete(id)
        this.clearHighlight()
      }
    }
  }

  /** Обрабатывает request от DevTools panel. */
  handle(request: NovaDevtoolsRequest): NovaDevtoolsResponse {
    try {
      switch (request.command) {
        case 'listApps':
          return this.ok(this.listApps())
        case 'getTree':
          return this.ok(this.getTree())
        case 'inspectNode':
          return this.ok(this.inspectNode(String(readPayloadValue(request.payload, 'nodeId') ?? '')))
        case 'inspectAt':
          return this.ok(this.inspectAt(request.payload as unknown as InspectAtPayload))
        case 'startElementPicker':
          this.startElementPicker()
          return this.ok(this.getElementPickerState())
        case 'stopElementPicker':
          this.stopElementPicker()
          return this.ok(this.getElementPickerState())
        case 'getElementPickerState':
          return this.ok(this.getElementPickerState())
        case 'mutateNodeProps':
          return this.ok(this.mutateNodeProps(request.payload as unknown as NodePatchPayload))
        case 'setRootStyleSheet':
          return this.ok(this.setRootStyleSheet(request.payload as unknown as StyleSheetPayload))
        case 'getStyleTrace':
          return this.ok(this.getStyleTrace(String(readPayloadValue(request.payload, 'nodeId') ?? '')))
        case 'highlightNode':
          this.highlightNode(String(readPayloadValue(request.payload, 'nodeId') ?? ''))
          return this.ok(true)
        case 'clearHighlight':
          this.clearHighlight()
          return this.ok(true)
        default:
          return this.fail(`Unknown Nova DevTools command "${request.command}"`)
      }
    } catch (error) {
      return this.fail(error instanceof Error ? error.message : String(error))
    }
  }

  /** Возвращает краткий список подключенных NovaApp. */
  listApps(): Array<NovaDevtoolsAppSummary> {
    return [...this.apps.values()].map(item => ({
      id: item.id,
      label: item.label,
      renderer: String(item.app.mainRendererType),
      width: item.app.width,
      height: item.app.height,
      dpr: item.app.dpr,
      surfaces: item.app.surfaces.length,
      nodes: this.countNodes(item.app),
    }))
  }

  /** Возвращает дерево всех подключенных NovaApp. */
  getTree(): NovaDevtoolsTreeSnapshot {
    return {
      apps: [...this.apps.values()].map(item => this.createAppSnapshot(item)),
    }
  }

  /** Возвращает подробный snapshot node. */
  inspectNode(nodeId: string): NovaDevtoolsNodeDetails | null {
    const resolved = this.findNode(nodeId)
    if (!resolved) return null

    const { appId, node } = resolved
    const snapshot = this.createNodeSnapshot(appId, node, this.resolveDepth(node))

    return {
      ...snapshot,
      parentId: node.parent instanceof NovaNode ? this.createNodeDevtoolsId(appId, node.parent) : null,
      path: this.createNodePath(node),
      props: this.readNodeProps(node),
      local: toDevtoolsRecord((node as unknown as { _localValues?: Record<string, unknown> })._localValues),
      renderPolicy: toDevtoolsRecord(node.renderPolicy),
      renderDirtyFlags: toDevtoolsRecord(node.renderDirtyFlags),
      renderVersions: toDevtoolsRecord(node.renderVersions),
    }
  }

  /** Выполняет hit-test в logical координатах canvas и возвращает найденную node. */
  inspectAt(payload: InspectAtPayload): NovaDevtoolsNodeDetails | null {
    const app = this.apps.get(payload.appId)
    if (!app) return null

    const node = app.app.events.hitTest(payload.x, payload.y)
    if (!node) return null

    return this.inspectNode(this.createNodeDevtoolsId(app.id, node))
  }

  /** Включает режим выбора Nova node прямо на inspected page. */
  startElementPicker(): void {
    this.stopElementPicker(false)

    const handlePointerMove = (event: PointerEvent) => {
      const hit = this.findNodeAtClientPoint(event.clientX, event.clientY)
      const nextNodeId = hit ? this.createNodeDevtoolsId(hit.appId, hit.node) : null

      if (this.pickerState.hoveredNodeId === nextNodeId) return

      this.pickerState = {
        ...this.pickerState,
        active: true,
        hoveredNodeId: nextNodeId,
        updatedAt: Date.now(),
      }

      if (nextNodeId) this.highlightNode(nextNodeId)
      else this.clearHighlight()
    }

    const handleClick = (event: MouseEvent) => {
      const hit = this.findNodeAtClientPoint(event.clientX, event.clientY)
      if (!hit) return

      const nodeId = this.createNodeDevtoolsId(hit.appId, hit.node)
      event.preventDefault()
      event.stopPropagation()
      this.pickerState = {
        active: false,
        hoveredNodeId: nodeId,
        selectedNodeId: nodeId,
        updatedAt: Date.now(),
      }
      this.highlightNode(nodeId)
      this.stopElementPicker(false)
    }

    const blockCanvasPointer = (event: PointerEvent | MouseEvent) => {
      const hit = this.findNodeAtClientPoint(event.clientX, event.clientY)
      if (!hit) return

      event.preventDefault()
      event.stopPropagation()
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') this.stopElementPicker()
    }

    document.addEventListener('pointermove', handlePointerMove, true)
    document.addEventListener('pointerdown', blockCanvasPointer, true)
    document.addEventListener('pointerup', blockCanvasPointer, true)
    document.addEventListener('mousedown', blockCanvasPointer, true)
    document.addEventListener('click', handleClick, true)
    document.addEventListener('keydown', handleKeyDown, true)
    document.documentElement.style.cursor = 'crosshair'

    this.pickerState = {
      active: true,
      hoveredNodeId: null,
      selectedNodeId: null,
      updatedAt: Date.now(),
    }
    this.pickerDispose = () => {
      document.removeEventListener('pointermove', handlePointerMove, true)
      document.removeEventListener('pointerdown', blockCanvasPointer, true)
      document.removeEventListener('pointerup', blockCanvasPointer, true)
      document.removeEventListener('mousedown', blockCanvasPointer, true)
      document.removeEventListener('click', handleClick, true)
      document.removeEventListener('keydown', handleKeyDown, true)
      document.documentElement.style.cursor = ''
    }
  }

  /** Отключает режим выбора node на inspected page. */
  stopElementPicker(clearHover = true): void {
    this.pickerDispose?.()
    this.pickerDispose = null
    this.pickerState = {
      active: false,
      hoveredNodeId: clearHover ? null : this.pickerState.hoveredNodeId,
      selectedNodeId: this.pickerState.selectedNodeId,
      updatedAt: Date.now(),
    }
  }

  /** Возвращает состояние page-side picker для DevTools panel polling. */
  getElementPickerState(): NovaDevtoolsElementPickerState {
    return { ...this.pickerState }
  }

  /** Применяет live patch к props/component props выбранной node. */
  mutateNodeProps(payload: NodePatchPayload): NovaDevtoolsNodeDetails | null {
    const resolved = this.findNode(payload.nodeId)
    if (!resolved) return null

    const patch = payload.props ?? {}
    if (isComponentNode(resolved.node)) {
      resolved.node.setProps(patch)
    } else {
      resolved.node.options(patch as any)
      resolved.node.dirty({ update: true, matrix: true, render: true })
    }
    resolved.node.nova.invalidate()
    this.highlightNode(payload.nodeId)

    return this.inspectNode(payload.nodeId)
  }

  /** Применяет новый source Root stylesheet и возвращает свежий style trace. */
  setRootStyleSheet(payload: StyleSheetPayload): NovaDevtoolsStyleTrace | null {
    const root = this.findStyleRootByComponentId(payload.rootComponentId)
    if (!root?.api.setStyleSheetSource) return null

    root.api.setStyleSheetSource(payload.source)
    root.node.nova.invalidate()

    return this.getStyleTrace(payload.nodeId ?? this.createNodeDevtoolsId(root.appId, root.node))
  }

  /** Возвращает style trace для node, если она находится внутри UI Kit Root. */
  getStyleTrace(nodeId: string): NovaDevtoolsStyleTrace | null {
    const resolved = this.findNode(nodeId)
    if (!resolved) return null

    const root = this.findNearestStyleRoot(resolved.node)
    if (!root?.api.inspectStyleNode) return null

    const target = isComponentNode(resolved.node) ? resolved.node.componentId : resolved.node
    const trace = root.api.inspectStyleNode(target)
    return trace ? this.normalizeStyleTrace(trace) : null
  }

  /** Подсвечивает node поверх canvas без вмешательства в render pipeline. */
  highlightNode(nodeId: string): void {
    const resolved = this.findNode(nodeId)
    if (!resolved) {
      this.clearHighlight()
      return
    }

    const bounds = resolved.node.getRenderBounds()
    const element = this.ensureHighlightElement()
    const canvasRect = resolved.node.nova.canvas.element.getBoundingClientRect()
    const scaleX = canvasRect.width / Math.max(1, resolved.node.nova.width)
    const scaleY = canvasRect.height / Math.max(1, resolved.node.nova.height)

    element.style.left = `${canvasRect.left + bounds.x * scaleX}px`
    element.style.top = `${canvasRect.top + bounds.y * scaleY}px`
    element.style.width = `${Math.max(1, bounds.width * scaleX)}px`
    element.style.height = `${Math.max(1, bounds.height * scaleY)}px`
    element.style.display = 'block'
  }

  /** Убирает DOM overlay подсветки. */
  clearHighlight(): void {
    if (this.highlightElement) this.highlightElement.style.display = 'none'
  }

  private findNodeAtClientPoint(clientX: number, clientY: number): { appId: string; node: NovaNode<any> } | null {
    const apps = [...this.apps.values()].reverse()

    for (const item of apps) {
      const canvas = readAppCanvasElement(item.app)
      if (!canvas) continue

      const rect = canvas.getBoundingClientRect()
      if (
        clientX < rect.left
        || clientX > rect.right
        || clientY < rect.top
        || clientY > rect.bottom
      ) {
        continue
      }

      const x = (clientX - rect.left) * (item.app.width / Math.max(1, rect.width))
      const y = (clientY - rect.top) * (item.app.height / Math.max(1, rect.height))
      const node = item.app.events.hitTest(x, y)
      if (node) return { appId: item.id, node }
    }

    return null
  }

  private createAppSnapshot(item: RegisteredNovaApp): NovaDevtoolsNodeSnapshot {
    return {
      id: item.id,
      appId: item.id,
      nodeId: item.id,
      kind: 'app',
      type: 'NovaApp',
      label: item.label,
      depth: 0,
      childCount: item.app.surfaces.length,
      bounds: { x: 0, y: 0, width: item.app.width, height: item.app.height },
      flags: {},
      children: item.app.surfaces.map(surface => this.createNodeSnapshot(item.id, surface, 1)),
    }
  }

  private createNodeSnapshot(appId: string, node: NovaNode<any>, depth: number): NovaDevtoolsNodeSnapshot {
    const componentId = isComponentNode(node) ? node.componentId : undefined
    const isSurface = node instanceof NovaSurface

    return {
      id: this.createNodeDevtoolsId(appId, node),
      appId,
      nodeId: node.id,
      kind: isSurface ? 'surface' : 'node',
      type: isSurface ? 'Surface' : node.__type,
      label: this.createNodeLabel(node),
      componentId,
      lifecycleState: node.lifecycleState,
      depth,
      childCount: node.children.length,
      bounds: normalizeBounds(node.getWorldBounds()),
      renderBounds: normalizeBounds(node.getRenderBounds()),
      flags: {
        active: node.active,
        visible: node.visible,
        interactive: node.interactive,
        selected: node.selected,
        focused: node.focused,
        renderFrameDirty: node.renderFrameDirty,
      },
      children: node.children
        .filter((child): child is NovaNode<any> => child instanceof NovaNode)
        .map(child => this.createNodeSnapshot(appId, child, depth + 1)),
    }
  }

  private createNodeLabel(node: NovaNode<any>): string {
    if (node instanceof NovaSurface) return `surface:${node.name}`
    if (isComponentNode(node)) return `${node.descriptor.name}#${node.componentId}`
    return `${node.__type} ${node.id}`
  }

  private readNodeProps(node: NovaNode<any>): Record<string, any> {
    const base = {
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      scaleX: node.scaleX,
      scaleY: node.scaleY,
      rotation: node.rotation,
      opacity: node.opacity,
      active: node.localActive,
      visible: node.localVisible,
      interactive: node.interactive,
      cursor: node.cursor,
      zIndex: node.weight,
    }

    if (isComponentNode(node)) {
      return toDevtoolsRecord({
        ...base,
        ...node.getProps(),
      })
    }

    return toDevtoolsRecord(base)
  }

  private findNode(devtoolsId: string): { appId: string; node: NovaNode<any> } | null {
    const [appId, nodeId] = this.parseNodeDevtoolsId(devtoolsId)
    const app = this.apps.get(appId)
    if (!app) return null

    for (const surface of app.app.surfaces) {
      const found = this.findNodeInSubtree(surface, nodeId)
      if (found) return { appId, node: found }
    }

    return null
  }

  private findNodeInSubtree(root: NovaNode<any>, nodeId: string): NovaNode<any> | null {
    if (root.id === nodeId) return root

    for (const child of root.children) {
      if (!(child instanceof NovaNode)) continue
      const found = this.findNodeInSubtree(child, nodeId)
      if (found) return found
    }

    return null
  }

  private findNearestStyleRoot(node: NovaNode<any>): { appId: string; node: NovaNode<any>; api: NovaStyleRootApi } | null {
    let current: unknown = node
    while (current instanceof NovaNode) {
      const api = readStyleRootApi(current)
      if (api) {
        const appId = this.appIds.get(current.nova)
        return appId ? { appId, node: current, api } : null
      }
      current = current.parent
    }

    return null
  }

  private findStyleRootByComponentId(componentId: string): { appId: string; node: NovaNode<any>; api: NovaStyleRootApi } | null {
    for (const item of this.apps.values()) {
      const node = item.app.components.get(componentId)
      if (!node) continue
      const api = readStyleRootApi(node)
      if (api) return { appId: item.id, node, api }
    }

    return null
  }

  private normalizeStyleTrace(trace: NovaUiStyleInspectionDebug): NovaDevtoolsStyleTrace {
    return {
      rootComponentId: trace.rootComponentId,
      nodeComponentId: trace.nodeComponentId,
      nodeType: trace.nodeType,
      styleSheetSource: trace.styleSheetSource,
      matchedRules: trace.matchedRules.map(rule => ({
        selector: rule.selector,
        specificity: rule.specificity,
        order: rule.order,
        declarations: toDevtoolsRecord(rule.declarations),
      })),
      mergedDeclarations: toDevtoolsRecord(trace.mergedDeclarations),
      baselineProps: toDevtoolsRecord(trace.baselineProps),
      currentProps: toDevtoolsRecord(trace.currentProps),
      appliedKeys: trace.appliedKeys,
      diagnostics: trace.diagnostics.map(item => toDevtoolsRecord(item)),
    }
  }

  private countNodes(app: NovaApp<any>): number {
    let count = 0
    for (const surface of app.surfaces) {
      surface.traverseAll(() => {
        count += 1
      })
    }
    return count
  }

  private createNodePath(node: NovaNode<any>): Array<string> {
    const path: Array<string> = []
    let current: unknown = node
    while (current instanceof NovaNode) {
      path.unshift(this.createNodeLabel(current))
      current = current.parent
    }
    return path
  }

  private resolveDepth(node: NovaNode<any>): number {
    let depth = 0
    let current = node.parent
    while (current instanceof NovaNode) {
      depth += 1
      current = current.parent
    }
    return depth + 1
  }

  private createNodeDevtoolsId(appId: string, node: NovaNode<any>): string {
    return `${appId}::${node.id}`
  }

  private parseNodeDevtoolsId(devtoolsId: string): [string, string] {
    const separator = devtoolsId.indexOf('::')
    if (separator < 0) return ['', devtoolsId]
    return [devtoolsId.slice(0, separator), devtoolsId.slice(separator + 2)]
  }

  private ensureHighlightElement(): HTMLDivElement {
    if (this.highlightElement) return this.highlightElement

    const element = document.createElement('div')
    element.style.position = 'fixed'
    element.style.zIndex = '2147483647'
    element.style.pointerEvents = 'none'
    element.style.border = '2px solid #22d3ee'
    element.style.boxShadow = '0 0 0 1px rgba(2, 6, 23, 0.8), 0 0 0 9999px rgba(2, 6, 23, 0.08)'
    element.style.borderRadius = '3px'
    element.style.display = 'none'
    document.documentElement.appendChild(element)
    this.highlightElement = element
    return element
  }

  private ok<TResult>(result: TResult): NovaDevtoolsResponse<TResult> {
    return { ok: true, result }
  }

  private fail(error: string): NovaDevtoolsResponse {
    return { ok: false, error }
  }
}

function isComponentNode(node: unknown): node is NovaComponentNode<any, any, any, any, any> {
  return !!node
    && typeof node === 'object'
    && 'componentId' in node
    && 'getProps' in node
    && 'setProps' in node
}

function readStyleRootApi(node: NovaNode<any>): NovaStyleRootApi | null {
  if (!('getApi' in node) || typeof node.getApi !== 'function') return null

  const api = node.getApi() as NovaStyleRootApi
  return typeof api.inspectStyleNode === 'function' || typeof api.setStyleSheetSource === 'function'
    ? api
    : null
}

function readAppCanvasElement(app: NovaApp<any>): HTMLCanvasElement | null {
  const canvas = (app as unknown as { canvas?: { element?: HTMLCanvasElement } }).canvas
  return canvas?.element instanceof HTMLCanvasElement ? canvas.element : null
}

function normalizeBounds(bounds: NovaBounds): NovaDevtoolsBounds {
  return {
    x: round(bounds.x),
    y: round(bounds.y),
    width: round(bounds.width),
    height: round(bounds.height),
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function readPayloadValue(payload: unknown, key: string): unknown {
  return payload && typeof payload === 'object'
    ? (payload as Record<string, unknown>)[key]
    : undefined
}
