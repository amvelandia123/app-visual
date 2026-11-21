// Regenera la precaché y la versión dentro de site/sw.js (ARCHITECTURE §16.4).
//   npm run pwa:sync   → reescribe el bloque entre // <precache> y // </precache>
//   npm run pwa:check  → no escribe; sale con código 1 si sw.js está desactualizado
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'site');
const START = '// <precache>';
const END = '// </precache>';

/** Lista recursiva de archivos (rutas relativas con "/"). */
async function walk(dir, base = '') {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...await walk(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

/**
 * Calcula la precaché: todos los archivos de `rootDir` salvo sw.js, en orden alfabético,
 * y la versión (8 hex del SHA-256 de ruta + contenido).
 * @param {string} [rootDir]
 * @returns {Promise<{ files: string[], version: string }>}
 */
export async function computePrecache(rootDir = DEFAULT_ROOT) {
  const files = (await walk(rootDir)).filter((f) => f !== 'sw.js').sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file);
    hash.update('\0');
    hash.update(await readFile(path.join(rootDir, file)));
    hash.update('\0');
  }
  return { files, version: hash.digest('hex').slice(0, 8) };
}

/** Texto del bloque generado (marcadores incluidos). */
function buildBlock({ files, version }) {
  const list = ['./', ...files].map((f) => `  '${f}',`).join('\n');
  return `${START}\nconst CACHE_VERSION = '${version}';\nconst PRECACHE = [\n${list}\n];\n${END}`;
}

/** Devuelve el texto de sw.js con el bloque regenerado. */
export function applyBlock(source, precache) {
  const a = source.indexOf(START);
  const b = source.indexOf(END);
  if (a < 0 || b < a) throw new Error('sw.js no contiene los marcadores // <precache> … // </precache>');
  return source.slice(0, a) + buildBlock(precache) + source.slice(b + END.length);
}

async function main() {
  const check = process.argv.includes('--check');
  const swPath = path.join(DEFAULT_ROOT, 'sw.js');
  const current = await readFile(swPath, 'utf8');
  const precache = await computePrecache(DEFAULT_ROOT);
  const next = applyBlock(current, precache);
  if (check) {
    if (next !== current) {
      console.error('✖ site/sw.js está desactualizado. Ejecuta «npm run pwa:sync» y vuelve a intentarlo.');
      process.exit(1);
    }
    console.log(`✔ site/sw.js sincronizado (versión ${precache.version}, ${precache.files.length + 1} entradas).`);
    return;
  }
  if (next !== current) await writeFile(swPath, next);
  console.log(`✔ sw.js ${next !== current ? 'actualizado' : 'sin cambios'}: versión ${precache.version}, ${precache.files.length + 1} entradas.`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}
