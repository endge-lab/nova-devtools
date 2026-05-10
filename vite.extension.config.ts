import fs from 'fs'
import path from 'path'
import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'

function copyManifestPlugin(): Plugin {
  return {
    name: 'nova-devtools-copy-manifest',
    closeBundle() {
      const from = path.resolve(__dirname, 'src/extension/manifest.json')
      const to = path.resolve(__dirname, 'dist/extension/manifest.json')
      fs.mkdirSync(path.dirname(to), { recursive: true })
      fs.copyFileSync(from, to)
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
  plugins: [vue(), copyManifestPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
