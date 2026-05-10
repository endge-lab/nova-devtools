import fs from 'fs'
import path from 'path'
import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'

function copyStaticExtensionAssetsPlugin(): Plugin {
  return {
    name: 'nova-devtools-copy-static-extension-assets',
    closeBundle() {
      const assets = [
        {
          from: path.resolve(__dirname, 'src/extension/manifest.json'),
          to: path.resolve(__dirname, 'dist/extension/manifest.json'),
        },
        {
          from: path.resolve(__dirname, '../../public/nova-logo.png'),
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
