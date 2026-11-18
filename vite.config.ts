import { mkdirSync, writeFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

/** Dev server only: lets /car-sprites.html (src/tools/carSprites.ts) save the cars' top-down pictures. */
function carSprites(): Plugin {
  return {
    name: 'car-sprites',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__car-sprite/', (req, res) => {
        const name = (req.url ?? '').replace(/^\//, '');
        if (req.method !== 'POST' || !/^[a-z0-9-]+(-mask)?\.webp$|^sprites\.json$/.test(name)) {
          res.statusCode = 400;
          res.end();
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          mkdirSync('public/models/top', { recursive: true });
          writeFileSync(`public/models/top/${name}`, Buffer.concat(chunks));
          res.end('ok');
        });
      });
    },
  };
}

// Relative base so the build works when served from a GitHub Pages sub-path.
export default defineConfig({
  base: './',
  plugins: [carSprites()],
  build: {
    rolldownOptions: {
      input: { game: 'index.html', editor: 'editor.html' },
    },
  },
});
