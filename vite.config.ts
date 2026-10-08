import { defineConfig } from 'vite';

// Relative base so the build works when served from a GitHub Pages sub-path.
export default defineConfig({
  base: './',
  build: {
    rolldownOptions: {
      input: { game: 'index.html', editor: 'editor.html' },
    },
  },
});
