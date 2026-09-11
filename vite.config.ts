import { defineConfig } from 'vite'
import webExtension from 'vite-plugin-web-extension'

export default defineConfig({
  root: 'src',
  // icons/ を static assets として dist/ にコピーする
  publicDir: 'public',
  plugins: [
    webExtension({
      additionalInputs: ['content/styles.css'],
    }),
  ],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
})
