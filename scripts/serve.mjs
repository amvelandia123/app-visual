// Servidor estático mínimo y sin dependencias para desarrollo local y tests e2e.
// Sirve la carpeta `site/` (la misma que se publica en GitHub Pages).
//
// Uso:  node scripts/serve.mjs            → http://localhost:4173
//       PORT=8080 node scripts/serve.mjs
// En tests: import { startServer } from '../../scripts/serve.mjs'; const srv = await startServer({ port: 0 });

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'site');

// Tipos MIME necesarios para un sitio estático con ES modules.
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Arranca el servidor estático.
 * @param {{ port?: number, root?: string, host?: string }} [options] port 0 = puerto libre aleatorio
 * @returns {Promise<{ url: string, port: number, close: () => Promise<void> }>}
 */
export function startServer({ port = 4173, root = DEFAULT_ROOT, host = '127.0.0.1' } = {}) {
  const server = http.createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      // Evita salir de la carpeta raíz (path traversal).
      let filePath = path.normalize(path.join(root, urlPath));
      if (!filePath.startsWith(root)) {
        res.writeHead(403).end('Prohibido');
        return;
      }
      const info = await stat(filePath).catch(() => null);
      if (info?.isDirectory()) filePath = path.join(filePath, 'index.html');
      const body = await readFile(filePath);
      const type = MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('No encontrado');
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const actualPort = server.address().port;
      resolve({
        url: `http://${host}:${actualPort}/`,
        port: actualPort,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

// Ejecución directa desde la línea de comandos.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = Number(process.env.PORT) || 4173;
  const { url } = await startServer({ port });
  console.log(`Laboratorio Visual disponible en ${url}  (Ctrl+C para parar)`);
}
