// Tests e2e de la PWA en Chromium (ARCHITECTURE §16.9): registro, offline, actualización,
// botón instalar, ayuda de iOS, móvil y manifest servido.
import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startEnv, openLab, idle, clickAndIdle, typeCommand, assertDomMatchesProjection, devices } from '../helpers/browser.js';
import { startServer } from '../../scripts/serve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SITE = path.join(ROOT, 'site');
const { computePrecache } = await import(pathToFileURL(path.join(ROOT, 'scripts', 'sync-sw.mjs')).href);
const { files: PRECACHE, version: VERSION } = await computePrecache(SITE);
const ALLOW = { serviceWorkers: 'allow' };

let env;
before(async () => { env = await startEnv(); });
after(async () => { await env.close(); });

/** Espera a que el SW esté activo y controle la página (recargando si hace falta). */
async function waitControlled(page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) {
    await page.reload();
    await page.waitForFunction(() => window.__LAB__ && navigator.serviceWorker.controller);
    await idle(page);
  }
}

describe('registro del service worker', () => {
  test('ready resuelve, la página queda controlada y la caché tiene toda la precaché', async () => {
    const lab = await openLab(env, ALLOW);
    try {
      const { page } = lab;
      await page.evaluate(() => navigator.serviceWorker.ready);
      await page.reload();
      await page.waitForFunction(() => window.__LAB__ && navigator.serviceWorker.controller);
      assert.equal(await page.evaluate(() => navigator.serviceWorker.controller !== null), true);
      assert.deepEqual(await page.evaluate(() => caches.keys()), [`labvisual-${VERSION}`]);
      const urls = await page.evaluate(async (v) => (await (await caches.open(`labvisual-${v}`)).keys()).map((r) => new URL(r.url).pathname), VERSION);
      for (const f of PRECACHE) {
        const p = f === './' ? '/' : `/${f}`;
        assert.ok(urls.includes(p), `la caché no contiene ${p}`);
      }
      assert.equal(await page.evaluate(() => window.__LAB__.pwa.version()), VERSION);
      lab.assertClean();
    } finally { await lab.close(); }
  });
});

describe('offline', () => {
  test('recarga sin red, recorre los 10 pasos, modo libre, fuente cargada y sin errores', async () => {
    const lab = await openLab(env, ALLOW);
    try {
      const { page } = lab;
      await waitControlled(page);
      await lab.page.context().setOffline(true);
      await page.reload();
      await page.waitForFunction(() => window.__LAB__ && document.querySelector('[data-zone="local"]'));
      await idle(page);
      assert.match(await page.title(), /Laboratorio Visual/);
      for (let i = 1; i <= 10; i++) {
        await clickAndIdle(page, '#btn-next');
        if ([3, 7, 10].includes(i)) await assertDomMatchesProjection(page, `offline paso ${i}`);
      }
      assert.equal(await page.textContent('#console-counter'), '10/10');
      const font = await page.evaluate(async () => {
        await document.fonts.ready;
        return [...document.fonts].filter((f) => /JetBrains/i.test(f.family)).map((f) => f.status);
      });
      assert.ok(font.includes('loaded'), `JetBrains Mono no cargó: ${font}`);
      // Modo libre offline
      await clickAndIdle(page, '#btn-reset');
      await typeCommand(page, 'git init');
      await typeCommand(page, 'git status');
      assert.equal(await page.evaluate(() => window.__LAB__.getSnapshot().mode), 'free');
      await assertDomMatchesProjection(page, 'offline libre');
      lab.assertClean();
    } finally { await lab.page.context().setOffline(false).catch(() => {}); await lab.close(); }
  });
});

describe('actualización', () => {
  let tmp; let srv;
  before(async () => {
    tmp = mkdtempSync(path.join(tmpdir(), 'lv-e2e-'));
    cpSync(SITE, tmp, { recursive: true });
    srv = await startServer({ port: 0, root: tmp });
  });
  after(async () => { await srv.close(); rmSync(tmp, { recursive: true, force: true }); });

  test('primera visita: sin aviso ni recarga automática; luego aviso, recarga, versión nueva y caché vieja borrada', async () => {
    const lab = await openLab({ ...env, server: srv }, ALLOW);
    try {
      const { page } = lab;
      await page.evaluate(() => { window.__marker = 1; });
      await page.evaluate(() => navigator.serviceWorker.ready);
      await page.waitForFunction(() => navigator.serviceWorker.controller); // clients.claim()
      await page.waitForTimeout(400);
      assert.equal(await page.evaluate(() => window.__marker), 1, 'la página se recargó sola en la primera visita');
      assert.equal(await page.locator('#update-toast').isVisible(), false, 'aviso en la primera visita');

      const oldVersion = await page.evaluate(() => window.__LAB__.pwa.version());
      const swFile = path.join(tmp, 'sw.js');
      writeFileSync(swFile, readFileSync(swFile, 'utf8').replace(/CACHE_VERSION = '[0-9a-f]+'/, "CACHE_VERSION = 'deadbeef'"));
      await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r.update(); });

      await page.locator('#update-toast').waitFor({ state: 'visible', timeout: 10000 });
      assert.match(await page.textContent('#update-toast'), /Hay una actualización/);
      assert.equal(await page.evaluate(() => window.__marker), 1);

      await page.click('#btn-update-reload');
      await page.waitForFunction(() => window.__marker === undefined && window.__LAB__ && navigator.serviceWorker.controller);
      assert.equal(await page.evaluate(() => window.__LAB__.pwa.version()), 'deadbeef');
      assert.notEqual(oldVersion, 'deadbeef');
      assert.deepEqual(await page.evaluate(() => caches.keys()), ['labvisual-deadbeef']);
      assert.equal(await page.locator('#update-toast').isVisible(), false);
      lab.assertClean();
    } finally { await lab.close(); }
  });
});

describe('botón instalar', () => {
  test('oculto sin evento; con beforeinstallprompt sintético se muestra y al pulsar llama a prompt()', async () => {
    const lab = await openLab(env);
    try {
      const { page } = lab;
      assert.equal(await page.locator('#btn-install').isVisible(), false);
      await page.evaluate(() => {
        const e = new Event('beforeinstallprompt', { cancelable: true });
        e.prompt = () => { window.__prompted = (window.__prompted ?? 0) + 1; return Promise.resolve(); };
        e.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' });
        window.__prevented = !window.dispatchEvent(e);
      });
      assert.equal(await page.evaluate(() => window.__prevented), true, 'debe hacer preventDefault()');
      await page.locator('#btn-install').waitFor({ state: 'visible' });
      await page.click('#btn-install');
      assert.equal(await page.evaluate(() => window.__prompted), 1);
      await page.locator('#btn-install').waitFor({ state: 'hidden' });
      lab.assertClean();
    } finally { await lab.close(); }
  });

  test('con el evento appinstalled el botón se oculta', async () => {
    const lab = await openLab(env);
    try {
      const { page } = lab;
      await page.evaluate(() => {
        const e = new Event('beforeinstallprompt', { cancelable: true });
        e.prompt = () => Promise.resolve(); e.userChoice = Promise.resolve({ outcome: 'dismissed' });
        window.dispatchEvent(e);
      });
      await page.locator('#btn-install').waitFor({ state: 'visible' });
      await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
      await page.locator('#btn-install').waitFor({ state: 'hidden' });
    } finally { await lab.close(); }
  });
});

describe('iOS', () => {
  test('iPhone 13: botón visible, ayuda con instrucciones, Escape la cierra y el foco vuelve al botón', async () => {
    const lab = await openLab(env, { ...devices['iPhone 13'], reducedMotion: 'reduce' });
    try {
      const { page } = lab;
      assert.equal(await page.locator('#btn-install').isVisible(), true);
      await page.click('#btn-install');
      await page.locator('#install-help').waitFor({ state: 'visible' });
      assert.match(await page.textContent('#install-help'), /Añadir a pantalla de inicio/);
      await page.keyboard.press('Escape');
      await page.locator('#install-help').waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'btn-install');
      lab.assertClean();
    } finally { await lab.close(); }
  });
});

describe('móvil con la PWA', () => {
  test('360x740: sin scroll horizontal y el aviso de actualización no tapa «Siguiente»', async () => {
    const lab = await openLab(env, { ...ALLOW, viewport: { width: 360, height: 740 } });
    try {
      const { page } = lab;
      await waitControlled(page);
      const noScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      assert.equal(await noScroll(), true, 'scroll horizontal');
      await page.evaluate(() => { document.getElementById('update-toast').hidden = false; });
      assert.equal(await noScroll(), true, 'scroll horizontal con el aviso');
      const t = await page.locator('#update-toast').boundingBox();
      const b = await page.locator('#btn-next').boundingBox();
      assert.ok(t && b);
      const overlap = t.x < b.x + b.width && t.x + t.width > b.x && t.y < b.y + b.height && t.y + t.height > b.y;
      assert.equal(overlap, false, `el aviso tapa «Siguiente»: toast=${JSON.stringify(t)} btn=${JSON.stringify(b)}`);
      lab.assertClean();
    } finally { await lab.close(); }
  });
});

describe('manifest servido', () => {
  test('el link resuelve a /manifest.webmanifest y devuelve JSON con name', async () => {
    const lab = await openLab(env);
    try {
      const { page } = lab;
      const href = await page.evaluate(() => document.querySelector('link[rel=manifest]').href);
      assert.equal(href, new URL('manifest.webmanifest', env.server.url).href);
      const m = await page.evaluate(async (h) => { const r = await fetch(h); return { ok: r.ok, type: r.headers.get('content-type'), json: await r.json() }; }, href);
      assert.equal(m.ok, true);
      assert.match(m.type, /manifest\+json|json/);
      assert.equal(m.json.name, 'Laboratorio Visual');
    } finally { await lab.close(); }
  });
});
