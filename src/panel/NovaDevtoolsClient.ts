import type { NovaDevtoolsCommand, NovaDevtoolsRequest, NovaDevtoolsResponse } from '@/protocol'

declare const chrome: any

/** Выполняет команду в inspected page через window.__NOVA_DEVTOOLS__. */
export function requestNovaDevtools<TResult>(
  command: NovaDevtoolsCommand,
  payload?: Record<string, unknown>,
): Promise<TResult> {
  const request: NovaDevtoolsRequest = { command, payload }
  const expression = `window.__NOVA_DEVTOOLS__ ? window.__NOVA_DEVTOOLS__.handle(${JSON.stringify(request)}) : { ok: false, error: 'Nova DevTools runtime bridge is not installed on this page.' }`

  return new Promise((resolve, reject) => {
    chrome.devtools.inspectedWindow.eval(expression, (response: NovaDevtoolsResponse<TResult>, exceptionInfo: { value?: string; description?: string }) => {
      if (exceptionInfo) {
        reject(new Error(exceptionInfo.value ?? exceptionInfo.description ?? 'DevTools eval failed'))
        return
      }
      if (!response?.ok) {
        reject(new Error(response?.error ?? 'Nova DevTools command failed'))
        return
      }
      resolve(response.result as TResult)
    })
  })
}
