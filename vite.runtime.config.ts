import path from 'path'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

const externalPackages = [
  '@endge/nova',
  '@endge/nova-ui-kit',
  'vue',
]

function isExternal(id: string): boolean {
  return externalPackages.some(pkg => id === pkg || id.startsWith(`${pkg}/`))
}

export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: {
        index: path.resolve(__dirname, 'src/index.ts'),
        'protocol/index': path.resolve(__dirname, 'src/protocol/index.ts'),
      },
      fileName: (_format, entryName) => `${entryName}.js`,
      formats: ['es'],
      name: 'endge-nova-devtools',
    },
    outDir: 'dist/runtime',
    rollupOptions: {
      external: isExternal,
    },
  },
  plugins: [dts({
    include: ['src/index.ts', 'src/runtime/**/*.ts', 'src/protocol/**/*.ts'],
    rollupTypes: false,
    tsconfigPath: './tsconfig.app.json',
    outDir: 'dist/runtime',
  })],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
