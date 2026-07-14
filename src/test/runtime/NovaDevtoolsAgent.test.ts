import { describe, expect, it } from 'vitest'
import type { NovaApp } from '@endge/nova'
import type { NovaDevtoolsElementPickerState } from '@/protocol'
import { NovaDevtoolsAgent } from '@/runtime/NovaDevtoolsAgent'

describe('NovaDevtoolsAgent', () => {
  it('registers the same NovaApp idempotently and keeps the latest id/label', () => {
    const agent = new NovaDevtoolsAgent()
    const app = createFakeApp()

    const disposeFirst = agent.registerApp(app, { id: 'first', label: 'First' })
    const disposeSecond = agent.registerApp(app, { id: 'second', label: 'Second' })

    expect(agent.listApps().map(item => ({ id: item.id, label: item.label }))).toEqual([
      { id: 'second', label: 'Second' },
    ])

    disposeFirst()
    expect(agent.listApps()).toHaveLength(1)

    disposeSecond()
    expect(agent.listApps()).toHaveLength(0)
  })

  it('stores explicit app id in picker state for selected-canvas mode', () => {
    const agent = new NovaDevtoolsAgent()

    const response = agent.handle({
      command: 'startElementPicker',
      payload: { appId: 'canvas-b' },
    })

    expect(response.ok).toBe(true)
    expect(response.result as NovaDevtoolsElementPickerState).toMatchObject({
      active: true,
      appId: 'canvas-b',
    })

    agent.handle({ command: 'stopElementPicker' })
  })
})

function createFakeApp(): NovaApp<any> {
  return {
    mainRendererType: '2d',
    width: 320,
    height: 240,
    dpr: 1,
    surfaces: [],
  } as unknown as NovaApp<any>
}
