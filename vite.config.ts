import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.BASE_PATH ?? '/cartograph/',
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
} as never);
