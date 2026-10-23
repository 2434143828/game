import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  server: {
    host: '127.0.0.1', port: 5173, strictPort: true,
    // Generated originals and evidence are not source modules. Ignoring them
    // also prevents Windows EBUSY while the image tool writes a large PNG.
    watch: { ignored: ['**/art-production/**', '**/outputs/**', '**/docs/art-brief-work/**', '**/docs/*evidence*/**', '**/public/art/generated/**'] },
  },
  build: { rollupOptions: { output: { manualChunks: { phaser: ['phaser'] } } } },
});
