import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    'main/index': 'src/main/index.ts',
    'preload/index': 'src/preload/index.ts',
  },
  format: ['cjs'],
  outDir: 'out',
  target: 'node18',
  sourcemap: true,
  minify: false,
  splitting: false,
  clean: true,
  dts: false,
  // Externalize native/Node modules that can't be bundled
  external: [
    'electron',
    'ws',
    'sharp',
    'bufferutil',
    'utf-8-validate',
  ],
  // Do NOT use noExternal — let tsup auto-resolve which deps to bundle
})
