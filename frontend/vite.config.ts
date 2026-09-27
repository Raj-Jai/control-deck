import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Stamp the build's asset hash into the service worker.
 *
 * The worker cached the HTML shell cache-first under a fixed cache name, so an
 * already-installed PWA kept being served the previous index.html - which
 * points at asset hashes the rebuild has replaced. The page then 404s on its
 * own assets, or silently runs old code after a deploy. Deriving the cache
 * name from the emitted bundle makes a rebuild invalidate the old cache.
 */
function stampServiceWorker(): Plugin {
  return {
    name: 'sw-cache-stamp',
    apply: 'build',
    enforce: 'post',
    closeBundle() {
      const staticDir = join(process.cwd(), '..', 'static');
      const swPath = join(staticDir, 'service-worker.js');
      if (!existsSync(swPath)) return;

      let stamp = 'dev';
      try {
        const js = readdirSync(join(staticDir, 'assets')).find((f) => f.endsWith('.js'));
        if (js) stamp = js.replace(/^index-/, '').replace(/\.js$/, '');
      } catch {
        // Keep the fallback rather than failing the build.
      }

      const src = readFileSync(swPath, 'utf8');
      if (!src.includes('__BUILD__')) return;
      writeFileSync(swPath, src.replaceAll('__BUILD__', stamp));
    },
  };
}

export default defineConfig({
  plugins: [react(), stampServiceWorker()],
  base: '/static/',
  build: {
    outDir: '../static',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
      '/ws': { target: 'ws://localhost:8080', ws: true, changeOrigin: true },
      '/media-stream': { target: 'http://localhost:8080', changeOrigin: true },
      '/seek': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
});
