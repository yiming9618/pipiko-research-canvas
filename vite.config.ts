/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  // Relative paths so the site works under any GitHub Pages address.
  base: './',
  plugins: [react()],
  test: {
    include: ['src/**/*.test.ts'],
  },
})
