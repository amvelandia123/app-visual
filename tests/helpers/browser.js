// Utilidades para los tests e2e (Playwright + servidor estático local).
import assert from 'node:assert/strict';
import { chromium, devices } from 'playwright';
import { startServer } from '../../scripts/serve.mjs';

export { devices };

/** Arranca servidor y navegador; devuelve { server, browser, close }. */
export async function startEnv() {
  const server = await startServer({ port: 0 });
  const browser = await chromium.launch();
  return {
    server,
    browser,
    async close() {
      await browser.close();
      await server.close();
    },
  };
}

/**
 * Abre la app en un contexto nuevo. Recoge console.error y pageerror.
 * @param {{server:{url:string}, browser:import('playwright').Browser}} env
 * @param {object} [opts] opciones de contexto (viewport, reducedMotion, dispositivo…)
 */
export async function openLab(env, opts = {}) {
  const { defaultBrowserType, ...ctxOpts } = opts; // los descriptores de devices lo incluyen
  const context = await env.browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 900 }, ...ctxOpts });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console.error: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  // Sin red: Google Fonts se sustituye por css vacío.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.goto(env.server.url);
  await page.waitForFunction(() => window.__LAB__ && document.querySelector('[data-zone="local"]'));
  await idle(page);
  return {
    page,
    problems,
    /** Afirma que no hubo errores de consola ni excepciones. */
    assertClean() {
      assert.deepEqual(problems, [], `Errores en el navegador:\n${problems.join('\n')}`);
    },
    close: () => context.close(),
  };
}

/** Espera a que termine la cola de animaciones. */
export const idle = (page) => page.waitForFunction(() => document.body.dataset.animating !== 'true', null, { timeout: 20000 });

export const snapshot = (page) => page.evaluate(() => {
  const s = window.__LAB__.getSnapshot();
  return { step: s.step, mode: s.mode, state: s.state, offScript: s.offScript, lastCommandId: s.lastCommandId, total: s.total };
});

/** Pulsa un botón y espera a que acabe la animación. */
export async function clickAndIdle(page, selector) {
  await page.click(selector);
  await idle(page);
}

/** Escribe un comando en la consola y pulsa Enter. */
export async function typeCommand(page, text) {
  await page.fill('#command-input', text);
  await page.press('#command-input', 'Enter');
  await idle(page);
}

/** Lee del DOM todo lo que debe coincidir con la proyección, y calcula lo esperado. */
function collect() {
  const q = (sel) => [...document.querySelectorAll(sel)];
  const snap = window.__LAB__.getSnapshot();
  const p = window.__LAB__.project(snap.state);
  const refsDom = (zone) => q(`[data-zone="${zone}"] [data-ref]`).map((e) => `${e.dataset.ref}>${e.dataset.target}`).sort();
  const refsProj = (g) => g.refs.map((r) => `${r.name}>${r.target}`).sort();
  const pad = (n) => String(n).padStart(2, '0');
  return {
    dom: {
      working: q('[data-zone="working"] [data-file]').map((e) => `${e.dataset.file}:${e.dataset.fileStatus}`).sort(),
      staging: q('[data-zone="staging"] [data-file]').map((e) => `${e.dataset.file}:${e.dataset.fileStatus}`).sort(),
      clean: q('[data-clean-file]').map((e) => e.dataset.cleanFile).sort(),
      stash: q('[data-stash-index]').length,
      localCommits: q('[data-zone="local"] [data-commit]').map((e) => e.dataset.commit).sort(),
      remoteCommits: q('[data-zone="remote"] [data-commit]').map((e) => e.dataset.commit).sort(),
      localRefs: refsDom('local'),
      remoteRefs: refsDom('remote'),
      prompt: document.getElementById('prompt-label').textContent.trim(),
      counter: document.getElementById('console-counter').textContent.trim(),
      steps: q('[data-step-item]').map((e) => e.dataset.status),
      explain: document.getElementById('explain').dataset.explainCommand,
    },
    expected: {
      working: p.working.map((f) => `${f.path}:${f.status}`).sort(),
      staging: p.staging.map((f) => `${f.path}:${f.status}`).sort(),
      clean: [...p.clean].sort(),
      stash: p.stash.length,
      localCommits: p.local.commits.map((c) => c.id).sort(),
      remoteCommits: p.remote.graph.commits.map((c) => c.id).sort(),
      localRefs: refsProj(p.local),
      remoteRefs: refsProj(p.remote.graph),
      prompt: p.prompt,
      counter: snap.mode === 'free' ? 'LIBRE' : `${pad(snap.step)}/${pad(snap.total)}`,
      steps: Array.from({ length: snap.total }, (_, i) => (i + 1 < snap.step ? 'done' : i + 1 === snap.step ? 'active' : 'pending')),
      explain: snap.lastCommandId ?? '',
    },
  };
}

/** Compara el DOM con `window.__LAB__.project(snapshot.state)`. */
export async function assertDomMatchesProjection(page, label = '') {
  const { dom, expected } = await page.evaluate(collect);
  for (const key of Object.keys(expected)) {
    assert.deepEqual(dom[key], expected[key], `${label} DOM≠proyección en '${key}'`);
  }
}
