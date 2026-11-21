// Tests unitarios de la PWA (ARCHITECTURE §16.9): manifest, iconos, cabecera, service worker y platform.js.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, mkdtempSync, cpSync, writeFileSync, rmSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SITE = path.join(ROOT, 'site');
const read = (rel) => readFileSync(path.join(SITE, rel), 'utf8');
const { computePrecache } = await import(pathToFileURL(path.join(ROOT, 'scripts', 'sync-sw.mjs')).href);
const platform = await import(pathToFileURL(path.join(SITE, 'js/pwa/platform.js')).href);

/** Lee ancho, alto y tipo de color de un PNG (chunk IHDR). */
function pngInfo(file) {
  const b = readFileSync(file);
  assert.equal(b.subarray(1, 4).toString(), 'PNG', `${file} no es PNG`);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), bitDepth: b[24], colorType: b[25], buf: b };
}

/** Primer píxel de un PNG de 8 bits (en la primera fila todos los filtros dejan el primer píxel igual al byte crudo). */
function firstPixel(info) {
  const idat = [];
  for (let o = 8; o < info.buf.length;) {
    const len = info.buf.readUInt32BE(o);
    if (info.buf.subarray(o + 4, o + 8).toString() === 'IDAT') idat.push(info.buf.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  return [...raw.subarray(1, 1 + ({ 6: 4, 2: 3, 0: 1, 4: 2 }[info.colorType] ?? 4))];
}

describe('manifest', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  const bg = /--bg:\s*(#[0-9a-fA-F]{3,8})/.exec(read('css/base.css'))[1].toLowerCase();

  test('campos básicos', () => {
    assert.equal(m.name, 'Laboratorio Visual');
    assert.equal(m.short_name, 'LabVisual');
    assert.equal(m.start_url, './');
    assert.equal(m.scope, './');
    assert.equal(m.display, 'standalone');
    assert.equal(m.orientation, 'any');
    assert.equal(m.lang, 'es');
  });

  test('theme_color y background_color coinciden con --bg', () => {
    assert.equal(m.theme_color.toLowerCase(), bg);
    assert.equal(m.background_color.toLowerCase(), bg);
  });

  test('el theme-color de index.html también coincide con --bg', () => {
    assert.equal(/name="theme-color" content="([^"]+)"/.exec(read('index.html'))[1].toLowerCase(), bg);
  });

  test('iconos: 192 y 512 any PNG y al menos un maskable 512', () => {
    const has = (size, purpose) => m.icons.some((i) => i.sizes === `${size}x${size}` && i.type === 'image/png' && (i.purpose ?? 'any').split(' ').includes(purpose));
    assert.ok(has(192, 'any'));
    assert.ok(has(512, 'any'));
    assert.ok(has(512, 'maskable'));
  });

  test('cada icono existe y las dimensiones reales de los PNG coinciden con sizes', () => {
    for (const icon of m.icons) {
      const file = path.join(SITE, icon.src);
      assert.ok(existsSync(file), `falta ${icon.src}`);
      if (icon.type === 'image/png') {
        const { width, height } = pngInfo(file);
        assert.equal(`${width}x${height}`, icon.sizes, `${icon.src}: tamaño real distinto de sizes`);
      }
    }
  });
});

describe('apple-touch-icon', () => {
  const file = path.join(SITE, 'icons/apple-touch-icon.png');

  test('existe y mide 180x180', () => {
    assert.ok(existsSync(file));
    const { width, height } = pngInfo(file);
    assert.deepEqual([width, height], [180, 180]);
  });

  test('es opaco: sin canal alfa o con alfa 255 en la esquina superior izquierda', () => {
    const info = pngInfo(file);
    assert.equal(info.bitDepth, 8);
    if ([0, 2].includes(info.colorType)) return; // sin canal alfa: opaco
    const px = firstPixel(info);
    // Limitación: solo se comprueba el píxel (0,0); asumimos que el resto del lienzo es igual de opaco.
    assert.equal(px[px.length - 1], 255, `el primer píxel es transparente: ${px}`);
  });
});

describe('index.html', () => {
  const html = read('index.html');
  const tag = (re) => re.exec(html);

  test('enlaza el manifest, el apple-touch-icon y los favicons', () => {
    assert.ok(tag(/<link rel="manifest" href="\.\/manifest\.webmanifest"/));
    assert.ok(tag(/<link rel="apple-touch-icon" href="[^"]*apple-touch-icon\.png"/));
    assert.ok(tag(/<link rel="icon"[^>]*\.svg"/));
    assert.ok(tag(/<link rel="icon"[^>]*\.png"/));
    assert.ok(tag(/<meta name="theme-color"/));
  });

  test('metas de iOS y modo app', () => {
    assert.ok(tag(/name="apple-mobile-web-app-capable" content="yes"/));
    assert.ok(tag(/name="mobile-web-app-capable" content="yes"/));
    assert.ok(tag(/name="apple-mobile-web-app-title" content="LabVisual"/));
    assert.ok(tag(/name="apple-mobile-web-app-status-bar-style" content="[^"]+"/));
  });

  test('el viewport incluye viewport-fit=cover', () => {
    assert.match(tag(/<meta name="viewport" content="([^"]+)"/)[1], /viewport-fit=cover/);
  });

  test('ninguna URL http(s) en href/src de <link> y <script>', () => {
    const tags = html.match(/<(link|script)\b[^>]*>/g) ?? [];
    assert.ok(tags.length > 5);
    for (const t of tags) assert.doesNotMatch(t, /(href|src)\s*=\s*["']?(https?:)?\/\//i, `URL externa en ${t}`);
  });

  test('los CSS no cargan recursos externos (@import/url http)', () => {
    for (const f of readdirSync(path.join(SITE, 'css'))) assert.doesNotMatch(read(`css/${f}`), /(https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}/i, `URL externa en css/${f}`);
  });
});

describe('service worker sincronizado', () => {
  const sw = read('sw.js');
  const block = sw.slice(sw.indexOf('// <precache>'), sw.indexOf('// </precache>'));
  const version = /const CACHE_VERSION = '([^']+)'/.exec(block)[1];
  const list = [...block.slice(block.indexOf('PRECACHE')).matchAll(/'([^']+)'/g)].map((m) => m[1]);

  test('computePrecache coincide con PRECACHE y CACHE_VERSION', async () => {
    const { files, version: v } = await computePrecache(SITE);
    assert.match(version, /^[0-9a-f]{8}$/);
    assert.equal(v, version);
    assert.deepEqual(list, ['./', ...files]);
  });

  test('la precaché es todo site/ menos sw.js, más "./"', () => {
    const all = [];
    const walk = (dir) => { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else all.push(path.relative(SITE, p).split(path.sep).join('/')); } };
    walk(SITE);
    const expected = ['./', ...all.filter((f) => f !== 'sw.js').sort()];
    assert.deepEqual([...list].sort(), [...expected].sort());
    assert.ok(!list.includes('sw.js'));
    assert.ok(list.includes('index.html') && list.includes('manifest.webmanifest'));
  });

  test('todas las rutas de la precaché existen', () => {
    for (const f of list) assert.ok(existsSync(path.join(SITE, f === './' ? 'index.html' : f)), `falta ${f}`);
  });

  test('npm run pwa:check termina con código 0', () => {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'sync-sw.mjs'), '--check'], { stdio: 'pipe' });
  });

  test('regresión: cambiar un byte de un archivo cambia la versión', async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'lv-site-'));
    try {
      cpSync(SITE, tmp, { recursive: true });
      const before = await computePrecache(tmp);
      assert.equal(before.version, version);
      writeFileSync(path.join(tmp, 'css/base.css'), read('css/base.css') + ' ');
      const after = await computePrecache(tmp);
      assert.notEqual(after.version, before.version);
      assert.deepEqual(after.files, before.files);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  });

  test('sw.js no llama a skipWaiting por su cuenta (solo por mensaje)', () => {
    const body = sw.slice(sw.indexOf('// </precache>'));
    const install = /addEventListener\('install'[\s\S]*?\n\}\);/.exec(body)?.[0] ?? '';
    assert.doesNotMatch(install, /skipWaiting/);
  });
});

describe('platform.js', () => {
  const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
  const UA_IPAD = 'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 Version/16.0 Mobile/15E148 Safari/604.1';
  const UA_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15';
  const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36';

  test('isIOS', () => {
    assert.equal(platform.isIOS({ userAgent: UA_IPHONE, platform: 'iPhone', maxTouchPoints: 5 }), true);
    assert.equal(platform.isIOS({ userAgent: UA_IPAD, platform: 'iPad', maxTouchPoints: 5 }), true);
    assert.equal(platform.isIOS({ userAgent: UA_MAC, platform: 'MacIntel', maxTouchPoints: 5 }), true, 'iPadOS se identifica como Mac táctil');
    assert.equal(platform.isIOS({ userAgent: UA_MAC, platform: 'MacIntel', maxTouchPoints: 0 }), false);
    assert.equal(platform.isIOS({ userAgent: UA_ANDROID, platform: 'Linux armv8l', maxTouchPoints: 5 }), false);
    assert.equal(platform.isIOS(), false);
  });

  test('isStandalone', () => {
    const mm = (v) => () => ({ matches: v });
    assert.equal(platform.isStandalone({ matchMedia: mm(true), navigator: {} }), true);
    assert.equal(platform.isStandalone({ matchMedia: mm(false), navigator: {} }), false);
    assert.equal(platform.isStandalone({ matchMedia: mm(false), navigator: { standalone: true } }), true);
    assert.equal(platform.isStandalone({ matchMedia: mm(false), navigator: { standalone: false } }), false);
    assert.equal(platform.isStandalone({}), false);
    assert.equal(platform.isStandalone({ matchMedia: () => { throw new Error('x'); } }), false);
  });

  test('isNativeApp', () => {
    assert.equal(platform.isNativeApp({ Capacitor: { isNativePlatform: () => true } }), true);
    assert.equal(platform.isNativeApp({ Capacitor: { isNativePlatform: () => false } }), false);
    assert.equal(platform.isNativeApp({ Capacitor: {} }), false);
    assert.equal(platform.isNativeApp({}), false);
    assert.equal(platform.isNativeApp(undefined), false);
  });
});

describe('CSS de zonas seguras', () => {
  test('usa env(safe-area-inset-*) en los cuatro lados', () => {
    const css = readdirSync(path.join(SITE, 'css')).map((f) => read(`css/${f}`)).join('\n');
    for (const side of ['top', 'bottom', 'left', 'right']) assert.ok(css.includes(`env(safe-area-inset-${side}`), `falta ${side}`);
  });
});
