import type { NovaApp } from '@endge/nova'
import { NovaDevtoolsAgent, type InstallNovaDevtoolsOptions } from '@/runtime/NovaDevtoolsAgent'
import type { NovaDevtoolsRequest, NovaDevtoolsResponse } from '@/protocol'

export interface NovaDevtoolsGlobalHook {
  version: string
  handle: (request: NovaDevtoolsRequest) => NovaDevtoolsResponse
  registerApp: (app: NovaApp<any>, options?: InstallNovaDevtoolsOptions) => () => void
}

declare global {
  interface Window {
    __NOVA_DEVTOOLS__?: NovaDevtoolsGlobalHook
  }
}

const NOVA_DEVTOOLS_VERSION = '0.1.0'

let agent: NovaDevtoolsAgent | null = null

/** Возвращает singleton-agent и публикует bridge на window. */
export function getNovaDevtoolsAgent(): NovaDevtoolsAgent {
  if (agent) return agent

  agent = new NovaDevtoolsAgent()
  if (typeof window !== 'undefined') {
    window.__NOVA_DEVTOOLS__ = {
      version: NOVA_DEVTOOLS_VERSION,
      handle: request => agent!.handle(request),
      registerApp: (app, options) => agent!.registerApp(app, options),
    }
  }

  return agent
}

/** Регистрирует NovaApp в runtime bridge для Chrome DevTools panel. */
export function installNovaDevtools(app: NovaApp<any>, options: InstallNovaDevtoolsOptions = {}): () => void {
  if (typeof window === 'undefined') return () => {}

  return getNovaDevtoolsAgent().registerApp(app, options)
}
