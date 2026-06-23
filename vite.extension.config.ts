import fs from 'fs'
import path from 'path'
import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'

function copyStaticExtensionAssetsPlugin(): Plugin {
  return {
    name: 'nova-devtools-copy-static-extension-assets',
    /**
     * Закрывает presentation-состояние текущего класса.
     */
    closeBundle() {
      const assets = [
        {
          from: path.resolve(__dirname, 'src/extension/manifest.json'),
          to: path.resolve(__dirname, 'dist/extension/manifest.json'),
        },
        {
          from: resolveNovaLogoPath(),
          to: path.resolve(__dirname, 'dist/extension/icons/nova-logo.png'),
        },
      ]

      for (const asset of assets) {
        fs.mkdirSync(path.dirname(asset.to), { recursive: true })
        fs.copyFileSync(asset.from, asset.to)
      }
    },
  }
}

function resolveNovaLogoPath(): string {
  const candidates = [
    path.resolve(__dirname, '../../apps/egorkozelskij-nova-docs/public/nova-logo.png'),
    path.resolve(__dirname, '../../public/nova-logo.png'),
  ]
  const logoPath = candidates.find(candidate => fs.existsSync(candidate))
  if (!logoPath) throw new Error('Cannot find nova-logo.png for Nova DevTools extension build.')
  return logoPath
}

export default defineConfig({
  base: './',
  build: {
    emptyOutDir: true,
    outDir: 'dist/extension',
    rollupOptions: {
      input: {
        devtools: path.resolve(__dirname, 'src/extension/devtools.html'),
        panel: path.resolve(__dirname, 'src/panel/index.html'),
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
  plugins: [vue(), copyStaticExtensionAssetsPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
