import { copyFileSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, normalizePath, type Plugin } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const serverSrc = resolve(here, '../server/src');
// Forward-slash ids: a module imported both via this plugin and normally must be one instance.
const local = (f: string) => normalizePath(resolve(here, 'src/local', f));

/**
 * Offline build: the API route modules from server/ are bundled into the app,
 * with their Node-only dependencies swapped for browser equivalents.
 */
function offlineBackend(): Plugin {
  const swaps: Record<string, string> = {
    [resolve(serverSrc, 'db.ts')]: local('server-db.ts'),
    [resolve(serverSrc, 'auth.ts')]: local('server-auth.ts'),
  };
  const bare: Record<string, string> = {
    express: local('express-shim.ts'),
    'node:crypto': local('crypto-shim.ts'),
    pdfkit: normalizePath(resolve(here, '../node_modules/pdfkit/js/pdfkit.standalone.js')),
    exceljs: normalizePath(resolve(here, '../node_modules/exceljs/dist/exceljs.min.js')),
  };
  return {
    name: 'flagtrack-offline-backend',
    enforce: 'pre',
    async resolveId(source, importer, opts) {
      if (!importer || !resolve(importer).startsWith(serverSrc)) return null;
      if (bare[source]) return bare[source];
      const r = await this.resolve(source, importer, { ...opts, skipSelf: true });
      return r && swaps[resolve(r.id)] ? swaps[resolve(r.id)] : null;
    },
  };
}

/** Server-mode build: replaces the offline backend with a stub (keeps Node-only code out). */
function serverModeStub(): Plugin {
  return {
    name: 'flagtrack-local-stub',
    enforce: 'pre',
    async resolveId(source, importer, opts) {
      if (!source.endsWith('local/backend')) return null;
      const r = await this.resolve(source, importer, { ...opts, skipSelf: true });
      return r ? local('backend-stub.ts') : null;
    },
  };
}

/** Injects the list of built files into sw.js so the whole app works offline. */
function precacheManifest(outDir: string): Plugin {
  return {
    name: 'flagtrack-precache',
    apply: 'build',
    closeBundle() {
      const root = resolve(here, outDir);
      const files: string[] = [];
      const walk = (d: string) => {
        for (const f of readdirSync(d)) {
          const p = join(d, f);
          if (statSync(p).isDirectory()) walk(p);
          else if (!/\.(map|txt)$/.test(f) && f !== 'sw.js') files.push(relative(root, p).replace(/\\/g, '/'));
        }
      };
      walk(root);
      const sw = join(root, 'sw.js');
      const version = Date.now().toString(36);
      writeFileSync(sw, readFileSync(sw, 'utf8').replace('self.__PRECACHE__', JSON.stringify(files)).replace('__BUILD_VERSION__', version));
      // Static hosts (e.g. GitHub Pages) serve 404.html for unknown paths: SPA fallback.
      copyFileSync(join(root, 'index.html'), join(root, '404.html'));
    },
  };
}

export default defineConfig(({ mode }) => {
  const isLocal = mode === 'offline';
  const outDir = isLocal ? 'dist-offline' : 'dist';
  return {
    base: process.env.VITE_BASE ?? '/',
    plugins: [react(), isLocal ? offlineBackend() : serverModeStub(), precacheManifest(outDir)],
    define: { 'import.meta.env.VITE_LOCAL': JSON.stringify(isLocal ? 'true' : 'false') },
    server: {
      port: 5173,
      proxy: { '/api': 'http://localhost:3001' },
      fs: { allow: [resolve(here, '..')] },
    },
    optimizeDeps: isLocal ? { include: ['pdfkit/js/pdfkit.standalone.js', 'exceljs/dist/exceljs.min.js'] } : undefined,
    build: {
      outDir,
      chunkSizeWarningLimit: 2500,
    },
  };
});
