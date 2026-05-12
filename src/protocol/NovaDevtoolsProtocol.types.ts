export type NovaDevtoolsCommand =
  | 'listApps'
  | 'getTree'
  | 'inspectNode'
  | 'inspectAt'
  | 'startElementPicker'
  | 'stopElementPicker'
  | 'getElementPickerState'
  | 'mutateNodeProps'
  | 'setRootStyleSheet'
  | 'getStyleTrace'
  | 'highlightNode'
  | 'clearHighlight'

export type NovaDevtoolsNodeKind = 'app' | 'surface' | 'node'

export type NovaDevtoolsSerializable =
  | null
  | string
  | number
  | boolean
  | Array<NovaDevtoolsSerializable>
  | { [key: string]: NovaDevtoolsSerializable }

export interface NovaDevtoolsBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface NovaDevtoolsAppSummary {
  id: string
  label: string
  renderer: string
  width: number
  height: number
  dpr: number
  surfaces: number
  nodes: number
}

export interface NovaDevtoolsNodeSnapshot {
  id: string
  appId: string
  nodeId: string
  kind: NovaDevtoolsNodeKind
  type: string
  label: string
  componentId?: string
  lifecycleState?: string
  depth: number
  childCount: number
  bounds?: NovaDevtoolsBounds
  renderBounds?: NovaDevtoolsBounds
  flags: {
    active?: boolean
    visible?: boolean
    interactive?: boolean
    selected?: boolean
    focused?: boolean
    renderFrameDirty?: boolean
  }
  children: Array<NovaDevtoolsNodeSnapshot>
}

export interface NovaDevtoolsTreeSnapshot {
  apps: Array<NovaDevtoolsNodeSnapshot>
}

export interface NovaDevtoolsNodeDetails extends NovaDevtoolsNodeSnapshot {
  parentId: string | null
  path: Array<string>
  props: Record<string, NovaDevtoolsSerializable>
  local: Record<string, NovaDevtoolsSerializable>
  renderPolicy: Record<string, NovaDevtoolsSerializable>
  renderDirtyFlags: Record<string, NovaDevtoolsSerializable>
  renderVersions: Record<string, NovaDevtoolsSerializable>
}

export interface NovaDevtoolsStyleRuleSnapshot {
  selector: string
  specificity: number
  order: number
  declarations: Record<string, NovaDevtoolsSerializable>
}

export interface NovaDevtoolsStyleTrace {
  rootComponentId: string
  nodeComponentId: string
  nodeType: string
  styleSheetSource: string
  matchedRules: Array<NovaDevtoolsStyleRuleSnapshot>
  mergedDeclarations: Record<string, NovaDevtoolsSerializable>
  baselineProps: Record<string, NovaDevtoolsSerializable>
  currentProps: Record<string, NovaDevtoolsSerializable>
  appliedKeys: Array<string>
  diagnostics: Array<Record<string, NovaDevtoolsSerializable>>
}

export interface NovaDevtoolsElementPickerState {
  active: boolean
  appId: string | null
  hoveredNodeId: string | null
  selectedNodeId: string | null
  updatedAt: number
}

export interface NovaDevtoolsRequest<TPayload = Record<string, unknown>> {
  command: NovaDevtoolsCommand
  payload?: TPayload
}

export interface NovaDevtoolsResponse<TResult = unknown> {
  ok: boolean
  result?: TResult
  error?: string
}
