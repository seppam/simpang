import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

// The console is served by the gateway under /console (see src/app.ts), so every built
// asset URL is prefixed with this base. In dev, /admin and /oauth go to the gateway on :3000.
export default defineConfig({
  base: '/console/',
  plugins: [vue()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/admin': 'http://localhost:3000',
      '/oauth': 'http://localhost:3000',
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
  },
});
