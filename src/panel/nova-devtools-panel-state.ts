import type { NovaDevtoolsNodeSnapshot, NovaDevtoolsTreeSnapshot } from '@/protocol'

export const NOVA_DEVTOOLS_AUTO_APP_ID = 'auto'

export type NovaDevtoolsAppSelection = typeof NOVA_DEVTOOLS_AUTO_APP_ID | string

export function shouldShowCanvasSelector(apps: ReadonlyArray<NovaDevtoolsNodeSnapshot>): boolean {
  return apps.length > 1
}

export function normalizeSelectedAppId(
  apps: ReadonlyArray<NovaDevtoolsNodeSnapshot>,
  selectedAppId: NovaDevtoolsAppSelection,
): NovaDevtoolsAppSelection {
  if (apps.length <= 1) return NOVA_DEVTOOLS_AUTO_APP_ID
  if (selectedAppId === NOVA_DEVTOOLS_AUTO_APP_ID) return selectedAppId
  return apps.some(app => app.appId === selectedAppId || app.id === selectedAppId)
    ? selectedAppId
    : NOVA_DEVTOOLS_AUTO_APP_ID
}

export function filterTreeBySelectedApp(
  tree: NovaDevtoolsTreeSnapshot,
  selectedAppId: NovaDevtoolsAppSelection,
): NovaDevtoolsTreeSnapshot {
  if (selectedAppId === NOVA_DEVTOOLS_AUTO_APP_ID) return tree

  return {
    apps: tree.apps.filter(app => app.appId === selectedAppId || app.id === selectedAppId),
  }
}

export function resolvePickerAppId(selectedAppId: NovaDevtoolsAppSelection): string | null {
  return selectedAppId === NOVA_DEVTOOLS_AUTO_APP_ID ? null : selectedAppId
}
