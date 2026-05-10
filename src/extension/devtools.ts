declare const chrome: any

chrome.devtools.panels.create(
  'Nova',
  '',
  'src/panel/index.html',
)
