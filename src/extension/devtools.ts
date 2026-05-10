declare const chrome: any

chrome.devtools.panels.create(
  'Nova',
  'icons/nova-logo.png',
  'src/panel/index.html',
)
