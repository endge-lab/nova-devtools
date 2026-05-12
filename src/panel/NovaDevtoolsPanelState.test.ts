import { describe, expect, it } from 'vitest'
import type { NovaDevtoolsNodeSnapshot, NovaDevtoolsTreeSnapshot } from '@/protocol'
import {
  filterTreeBySelectedApp,
  normalizeSelectedAppId,
  NOVA_DEVTOOLS_AUTO_APP_ID,
  resolvePickerAppId,
  shouldShowCanvasSelector,
} from '@/panel/NovaDevtoolsPanelState'

describe('NovaDevtoolsPanelState', () => {
  it('hides selector for a single app and normalizes selection to Auto', () => {
    const apps = [createAppSnapshot('app-a')]

    expect(shouldShowCanvasSelector(apps)).toBe(false)
    expect(normalizeSelectedAppId(apps, 'app-a')).toBe(NOVA_DEVTOOLS_AUTO_APP_ID)
  })

  it('keeps Auto tree unfiltered and filters RuntimeTree by selected app', () => {
    const tree: NovaDevtoolsTreeSnapshot = {
      apps: [createAppSnapshot('app-a'), createAppSnapshot('app-b')],
    }

    expect(shouldShowCanvasSelector(tree.apps)).toBe(true)
    expect(filterTreeBySelectedApp(tree, NOVA_DEVTOOLS_AUTO_APP_ID).apps).toHaveLength(2)
    expect(filterTreeBySelectedApp(tree, 'app-b').apps.map(app => app.appId)).toEqual(['app-b'])
  })

  it('resolves picker app id only for explicit canvas selection', () => {
    expect(resolvePickerAppId(NOVA_DEVTOOLS_AUTO_APP_ID)).toBeNull()
    expect(resolvePickerAppId('app-b')).toBe('app-b')
  })
})

function createAppSnapshot(id: string): NovaDevtoolsNodeSnapshot {
  return {
    id,
    appId: id,
    nodeId: id,
    kind: 'app',
    type: 'NovaApp',
    label: id,
    depth: 0,
    childCount: 0,
    flags: {},
    children: [],
  }
}
