import { defineConfig } from 'vite';

// ProtoLab ships as a fully static, offline-capable bundle: no server code, no
// runtime network access. Relative base keeps it loadable from file:// and from
// a future desktop shell (Tauri/Electron) without rewriting asset paths.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0,
    sourcemap: true,
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
