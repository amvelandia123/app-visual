// Tests e2e de la app en Chromium: guiado, libre, teclado, móvil y accesibilidad (ARCHITECTURE §10.5, §11, §12).
import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startEnv, openLab, idle, snapshot, clickAndIdle, typeCommand, assertDomMatchesProjection, devices,
} from '../helpers/browser.js';

let env;
before(async () => { env = await startEnv(); });
after(async () => { await env.close(); });

/** Abre la app, ejecuta `fn` y comprueba al final que no hubo errores del navegador. */
async function withLab(fn, opts) {
  const lab = await openLab(env, opts);
  try {
    await fn(lab.page, lab);
    lab.assertClean();
  } finally {
    await lab.close();
  }
}

describe('modo guiado', () => {
  test('carga inicial: paso 0, sin errores y DOM coherente', () => withLab(async (page) => {
    await assertDomMatchesProjection(page, 'inicial');
    assert.equal(await page.textContent('#console-counter'), '00/10');
    assert.equal(await page.locator('[data-step-item]').count(), 10);
    assert.equal(await page.locator('[data-zone]').count(), 5);
    assert.equal(await page.locator('#btn-prev').isDisabled(), true);
  }));

  test('los 10 pasos con «Siguiente»: el DOM coincide con la proyección tras cada uno', () => withLab(async (page) => {
    for (let i = 1; i <= 10; i++) {
      await clickAndIdle(page, '#btn-next');
      await assertDomMatchesProjection(page, `paso ${i}`);
      const s = await snapshot(page);
      assert.equal(s.step, i);
      assert.equal(await page.textContent('#console-counter'), `${String(i).padStart(2, '0')}/10`);
    }
    assert.equal(await page.locator('#btn-next').isDisabled(), true, 'en el paso 10 «Siguiente» está desactivado');
    assert.equal((await snapshot(page)).state.repo.branches.main, (await snapshot(page)).state.server.branches.main);
  }));

  test('la consola narra los comandos y el panel «¿Qué pasó?» sigue al paso', () => withLab(async (page) => {
    await clickAndIdle(page, '#btn-next');
    assert.match(await page.textContent('#console-log'), /git init/);
    assert.equal(await page.getAttribute('#explain', 'data-explain-command'), 'init');
    assert.match(await page.textContent('#explain'), /Qué hizo/);
    for (let i = 0; i < 6; i++) await clickAndIdle(page, '#btn-next');
    assert.equal(await page.getAttribute('#explain', 'data-explain-command'), 'merge');
  }));

  test('«Anterior» retrocede y el DOM sigue coincidiendo', () => withLab(async (page) => {
    for (let i = 0; i < 8; i++) await clickAndIdle(page, '#btn-next');
    for (let i = 7; i >= 0; i--) {
      await clickAndIdle(page, '#btn-prev');
      assert.equal((await snapshot(page)).step, i);
      await assertDomMatchesProjection(page, `atrás a ${i}`);
    }
    assert.equal(await page.locator('#btn-prev').isDisabled(), true);
  }));

  test('clic en un paso del panel salta a ese paso', () => withLab(async (page) => {
    await page.click('[data-step-item="5"]');
    await idle(page);
    assert.equal((await snapshot(page)).step, 5);
    await assertDomMatchesProjection(page, 'salto a 5');
    assert.equal(await page.getAttribute('[data-step-item="5"]', 'data-status'), 'active');
    assert.equal(await page.getAttribute('[data-step-item="4"]', 'data-status'), 'done');
    assert.equal(await page.getAttribute('[data-step-item="6"]', 'data-status'), 'pending');
    await page.click('[data-step-item="2"]');
    await idle(page);
    assert.equal((await snapshot(page)).step, 2);
    await assertDomMatchesProjection(page, 'salto a 2');
  }));

  test('«Reiniciar» desde el paso 10 devuelve el estado inicial', () => withLab(async (page) => {
    const inicial = await snapshot(page);
    const logInicial = await page.locator('#console-log .log-line').count();
    for (let i = 0; i < 10; i++) await clickAndIdle(page, '#btn-next');
    await clickAndIdle(page, '#btn-reset');
    const s = await snapshot(page);
    assert.deepEqual(s.state, inicial.state);
    assert.equal(s.step, 0);
    assert.equal(await page.textContent('#console-counter'), '00/10');
    assert.equal(await page.locator('#console-log .log-line').count(), logInicial);
    assert.equal(await page.locator('#console-log [data-kind="command"]').count(), 0);
    assert.equal(await page.locator('[data-zone] [data-commit]').count(), 0);
    await assertDomMatchesProjection(page, 'reinicio');
  }));

  test('auto-play: aria-pressed, avanza solo y se detiene al pulsar de nuevo', async () => {
    await withLab(async (page) => {
      await page.click('#btn-play');
      assert.equal(await page.getAttribute('#btn-play', 'aria-pressed'), 'true');
      await page.waitForFunction(() => window.__LAB__.getSnapshot().step >= 1, null, { timeout: 8000 });
      await page.click('#btn-play');
      assert.equal(await page.getAttribute('#btn-play', 'aria-pressed'), 'false');
      await idle(page);
      const antes = (await snapshot(page)).step;
      await page.waitForTimeout(2500); // más que el intervalo del auto-play (1,8 s)
      assert.equal((await snapshot(page)).step, antes, 'tras pausar no debe avanzar');
      await assertDomMatchesProjection(page, 'autoplay');
    });
  });

  test('interactuar (Siguiente) detiene el auto-play', () => withLab(async (page) => {
    await page.click('#btn-play');
    await page.click('#btn-next');
    assert.equal(await page.getAttribute('#btn-play', 'aria-pressed'), 'false');
  }));

  test('con animaciones activas: data-animating pasa a true y vuelve a false; el DOM coincide', () => withLab(async (page) => {
    for (let i = 1; i <= 10; i++) {
      const animating = await page.evaluate(() => { document.getElementById('btn-next').click(); return document.body.dataset.animating; });
      assert.equal(animating, 'true', `paso ${i}: debería estar animando`);
      await idle(page);
      assert.equal(await page.evaluate(() => document.body.dataset.animating), 'false');
      await assertDomMatchesProjection(page, `animado ${i}`);
    }
  }, { reducedMotion: 'no-preference' }));
});

describe('modo libre', () => {
  const SECUENCIA = [
    'git init', 'git status', 'git add .', 'git commit -m "uno"', 'git branch f', 'git switch f', 'edit app.js',
    'git commit -am "dos"', 'git switch main', 'git merge f', 'edit cart.js', 'git stash',
    'git remote add origin https://github.com/equipo/tienda.git', 'git push -u origin main', 'ana-push', 'git pull',
    'git stash pop', 'git commit -am "tres"', 'git push',
  ];

  test('secuencia válida con los 10 comandos: el DOM coincide tras cada uno', () => withLab(async (page) => {
    for (const c of SECUENCIA) {
      await typeCommand(page, c);
      const snap = await page.evaluate(() => window.__LAB__.getSnapshot().lastResult);
      assert.equal(snap.ok, true, `'${c}' debía ir bien`);
      assert.equal(await page.textContent('#console-counter'), 'LIBRE');
      await assertDomMatchesProjection(page, c);
    }
    const s = await snapshot(page);
    assert.equal(s.mode, 'free');
    assert.equal(s.state.repo.branches.main, s.state.server.branches.main);
    assert.equal(s.state.repo.stash.length, 0);
    assert.equal(await page.locator('[data-sync]').getAttribute('data-ahead'), '0');
  }));

  test('el prompt cambia con la rama', () => withLab(async (page) => {
    assert.equal((await page.textContent('#prompt-label')).trim(), '~/tienda $');
    await typeCommand(page, 'git init');
    assert.equal((await page.textContent('#prompt-label')).trim(), '(main) $');
    await typeCommand(page, 'git add .');
    await typeCommand(page, 'git commit -m "a"');
    await typeCommand(page, 'git switch -c dev');
    assert.equal((await page.textContent('#prompt-label')).trim(), '(dev) $');
  }));

  /** Ejecuta un comando erróneo y comprueba error pintado, estado intacto y panel de explicación. */
  async function errorCase(page, text) {
    const antes = JSON.stringify((await snapshot(page)).state);
    const nLog = await page.locator('#console-log .log-error').count();
    await typeCommand(page, text);
    assert.ok((await page.locator('#console-log .log-error').count()) > nLog, `'${text}' debe pintar líneas de error`);
    assert.equal(JSON.stringify((await snapshot(page)).state), antes, 'el estado no cambia');
    await assertDomMatchesProjection(page, text);
    return page.evaluate(() => ({
      result: window.__LAB__.getSnapshot().lastResult.error?.code,
      explain: document.getElementById('explain').innerText,
      hasErrorBlock: !!document.querySelector('#explain .is-error'),
    }));
  }

  test('git comit → sugerencia «commit» y explicación del error', () => withLab(async (page) => {
    const r = await errorCase(page, 'git comit');
    assert.equal(r.result, 'UNKNOWN_COMMAND');
    assert.match(await page.textContent('#console-log'), /El comando más parecido es\s*commit/);
    assert.ok(r.hasErrorBlock, '#explain debe mostrar la explicación del error (§10.2)');
  }));

  test('git push sin remoto → NO_REMOTE explicado', () => withLab(async (page) => {
    for (const c of ['git init', 'git add .', 'git commit -m "a"']) await typeCommand(page, c);
    const r = await errorCase(page, 'git push');
    assert.equal(r.result, 'NO_REMOTE');
    assert.ok(r.hasErrorBlock);
    assert.match(await page.textContent('#console-log'), /git remote add/);
    assert.equal(await page.getAttribute('#explain', 'data-explain-command'), 'push');
  }));

  test('git commit sin -m → NEEDS_MESSAGE explicado', () => withLab(async (page) => {
    for (const c of ['git init', 'git add .']) await typeCommand(page, c);
    const r = await errorCase(page, 'git commit');
    assert.equal(r.result, 'NEEDS_MESSAGE');
    assert.ok(r.hasErrorBlock);
  }));

  test('cd .. (no es git) → NOT_GIT explicado', () => withLab(async (page) => {
    const r = await errorCase(page, 'cd ..');
    assert.equal(r.result, 'NOT_GIT');
    assert.ok(r.hasErrorBlock, '#explain debe mostrar la explicación del error (§10.2)');
  }));

  test('git status sin repo → NOT_A_REPO con 💡 hint', () => withLab(async (page) => {
    const r = await errorCase(page, 'git status');
    assert.equal(r.result, 'NOT_A_REPO');
    assert.ok(r.hasErrorBlock);
    assert.ok(await page.locator('#console-log .log-hint').count() > 0);
  }));

  test('comilla sin cerrar → BAD_SYNTAX', () => withLab(async (page) => {
    const r = await errorCase(page, 'git commit -m "abc');
    assert.equal(r.result, 'BAD_SYNTAX');
    assert.ok(r.hasErrorBlock, '#explain debe mostrar la explicación del error (§10.2)');
  }));

  test('historial: ↑ recupera comandos anteriores y ↓ vuelve', () => withLab(async (page) => {
    await typeCommand(page, 'git init');
    await typeCommand(page, 'git status');
    await page.focus('#command-input');
    await page.press('#command-input', 'ArrowUp');
    assert.equal(await page.inputValue('#command-input'), 'git status');
    await page.press('#command-input', 'ArrowUp');
    assert.equal(await page.inputValue('#command-input'), 'git init');
    await page.press('#command-input', 'ArrowDown');
    assert.equal(await page.inputValue('#command-input'), 'git status');
    await page.press('#command-input', 'ArrowDown');
    assert.equal(await page.inputValue('#command-input'), '');
  }));

  test('la entrada vacía no hace nada', () => withLab(async (page) => {
    await page.focus('#command-input');
    await page.press('#command-input', 'Enter');
    assert.equal((await snapshot(page)).mode, 'guided');
  }));

  test('clear vacía la consola', () => withLab(async (page) => {
    await typeCommand(page, 'help');
    assert.ok(await page.locator('#console-log .log-line').count() > 3);
    await typeCommand(page, 'clear');
    assert.equal(await page.locator('#console-log .log-line').count(), 0);
  }));

  test('el botón ✎ de un archivo limpio ejecuta «edit <archivo>»', () => withLab(async (page) => {
    for (const c of ['git init', 'git add .', 'git commit -m "a"']) await typeCommand(page, c);
    await clickAndIdle(page, '[data-clean-file="app.js"] [data-edit]');
    const s = await snapshot(page);
    assert.equal(s.state.worktree['app.js'], 'app.js@v2');
    assert.equal(await page.locator('[data-zone="working"] [data-file="app.js"]').getAttribute('data-file-status'), 'modified');
    assert.match(await page.textContent('#console-log'), /edit app\.js/);
    await assertDomMatchesProjection(page, 'edit');
  }));

  test('el botón «Simular push de Ana» ejecuta ana-push', () => withLab(async (page) => {
    for (const c of ['git init', 'git add .', 'git commit -m "a"', 'git remote add origin https://github.com/equipo/tienda.git', 'git push -u origin main']) await typeCommand(page, c);
    const antes = (await snapshot(page)).state.server.branches.main;
    await clickAndIdle(page, '[data-ana-push]');
    const s = await snapshot(page);
    assert.notEqual(s.state.server.branches.main, antes);
    assert.equal(s.state.objects[s.state.server.branches.main].author, 'Ana');
    assert.equal(await page.locator(`[data-zone="remote"] [data-commit="${s.state.server.branches.main}"]`).count(), 1);
    assert.equal(await page.locator(`[data-zone="local"] [data-commit="${s.state.server.branches.main}"]`).count(), 0, 'no se ve en local hasta fetch');
    await assertDomMatchesProjection(page, 'ana');
  }));

  test('Ana sin remoto publicado muestra el error didáctico', () => withLab(async (page) => {
    await clickAndIdle(page, '[data-ana-push]');
    assert.ok(await page.locator('#console-log .log-error').count() > 0);
  }));

  test('tras modo libre, «Siguiente» vuelve al guion', () => withLab(async (page) => {
    await clickAndIdle(page, '#btn-next');
    await typeCommand(page, 'touch extra.js');
    await clickAndIdle(page, '#btn-next');
    const s = await snapshot(page);
    assert.equal(s.step, 2);
    assert.equal(s.mode, 'guided');
    assert.equal('extra.js' in s.state.worktree, false);
    await assertDomMatchesProjection(page, 'vuelta al guion');
  }));

  test('con animaciones activas, la secuencia libre también deja el DOM coherente', () => withLab(async (page) => {
    for (const c of SECUENCIA.slice(0, 14)) {
      await typeCommand(page, c);
      await assertDomMatchesProjection(page, c);
    }
  }, { reducedMotion: 'no-preference' }));
});

describe('teclado', () => {
  test('ArrowRight/ArrowLeft con el foco fuera del input cambian de paso', () => withLab(async (page) => {
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('ArrowRight');
    await idle(page);
    await page.keyboard.press('ArrowRight');
    await idle(page);
    assert.equal((await snapshot(page)).step, 2);
    await page.keyboard.press('ArrowLeft');
    await idle(page);
    assert.equal((await snapshot(page)).step, 1);
    await assertDomMatchesProjection(page, 'teclado');
  }));

  test('con el foco en el input, las flechas no cambian de paso', () => withLab(async (page) => {
    await page.focus('#command-input');
    await page.keyboard.type('git');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowLeft');
    assert.equal((await snapshot(page)).step, 0);
    assert.equal(await page.inputValue('#command-input'), 'git');
  }));

  test('Enter en el campo ejecuta el comando', () => withLab(async (page) => {
    await page.focus('#command-input');
    await page.keyboard.type('git init');
    await page.keyboard.press('Enter');
    await idle(page);
    assert.ok((await snapshot(page)).state.repo);
    assert.equal(await page.inputValue('#command-input'), '');
  }));

  test('todos los controles son alcanzables con Tab', () => withLab(async (page) => {
    await page.evaluate(() => document.activeElement?.blur());
    const visitados = new Set();
    for (let i = 0; i < 80; i++) {
      await page.keyboard.press('Tab');
      const id = await page.evaluate(() => {
        const a = document.activeElement;
        return a && a !== document.body ? (a.id || (a.dataset?.stepItem ? `step-${a.dataset.stepItem}` : a.tagName)) : null;
      });
      if (id) visitados.add(id);
    }
    for (const id of ['command-input', 'btn-prev', 'btn-next', 'btn-play', 'btn-reset']) {
      // btn-prev está desactivado en el paso 0 y no recibe foco: se comprueba aparte.
      if (id === 'btn-prev') continue;
      assert.ok(visitados.has(id), `Tab no llega a #${id}`);
    }
    for (let n = 1; n <= 10; n++) assert.ok(visitados.has(`step-${n}`), `Tab no llega al paso ${n}`);
    await clickAndIdle(page, '#btn-next');
    await clickAndIdle(page, '#btn-next');
    await page.focus('#btn-reset');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-prev');
  }));

  test('Enter/Espacio sobre «Siguiente» con el teclado lo activa', () => withLab(async (page) => {
    await page.focus('#btn-next');
    await page.keyboard.press('Enter');
    await idle(page);
    assert.equal((await snapshot(page)).step, 1);
    await page.keyboard.press('Space');
    await idle(page);
    assert.equal((await snapshot(page)).step, 2);
  }));
});

describe('accesibilidad básica', () => {
  test('lang="es", landmarks y regiones aria-live', () => withLab(async (page) => {
    assert.equal(await page.getAttribute('html', 'lang'), 'es');
    for (const sel of ['body > header', 'main', 'body > footer']) assert.equal(await page.locator(sel).count(), 1, sel);
    for (const sel of ['#console-log', '#explain']) {
      const live = await page.getAttribute(sel, 'aria-live');
      const role = await page.getAttribute(sel, 'role');
      assert.ok(live === 'polite' || live === 'assertive' || role === 'log' || role === 'status', `${sel} sin región live`);
    }
    assert.equal(await page.getAttribute('#console-log', 'aria-live'), 'polite');
    assert.equal(await page.getAttribute('#explain', 'aria-live'), 'polite');
    assert.match(await page.getAttribute('#console-counter', 'aria-label'), /Paso 0 de 10/);
    await clickAndIdle(page, '#btn-next');
    assert.match(await page.getAttribute('#console-counter', 'aria-label'), /Paso 1 de 10/);
  }));

  test('todos los botones y el input tienen nombre accesible (en cada fase)', () => withLab(async (page) => {
    const check = () => page.evaluate(() => [...document.querySelectorAll('button, input')].map((b) => {
      const name = (b.getAttribute('aria-label') || b.textContent || '').trim()
        || (b.id && document.querySelector(`label[for="${b.id}"]`)?.textContent.trim()) || b.getAttribute('title') || '';
      return name ? null : `${b.tagName}#${b.id}.${b.className}`;
    }).filter(Boolean));
    assert.deepEqual(await check(), []);
    for (const c of ['git init', 'git add .', 'git commit -m "a"']) await typeCommand(page, c);
    assert.deepEqual(await check(), [], 'tras crear archivos limpios (botones ✎)');
  }));

  test('foco visible: los botones muestran contorno al recibir foco por teclado', () => withLab(async (page) => {
    await page.keyboard.press('Tab'); // skip-link
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      const o = await page.evaluate(() => {
        const cs = getComputedStyle(document.activeElement);
        return { id: document.activeElement.id || document.activeElement.className, style: cs.outlineStyle, width: parseFloat(cs.outlineWidth), shadow: cs.boxShadow };
      });
      assert.ok((o.style !== 'none' && o.width > 0) || (o.shadow && o.shadow !== 'none'), `sin foco visible en ${o.id}`);
    }
  }));

  test('el estado no se comunica solo por color: pasos con ✓ y texto sr-only; archivos con letra', () => withLab(async (page) => {
    await clickAndIdle(page, '#btn-next');
    await clickAndIdle(page, '#btn-next');
    assert.match(await page.textContent('[data-step-item="1"]'), /✓/);
    assert.match(await page.textContent('[data-step-item="1"]'), /completado/);
    assert.match(await page.textContent('[data-step-item="2"]'), /paso actual/);
    assert.equal(await page.getAttribute('[data-step-item="2"]', 'aria-current'), 'step');
    assert.match(await page.textContent('[data-zone="working"] [data-file="app.js"]'), /U/);
  }));

  test('prefers-reduced-motion: sin animaciones, la cola no deja body animando', () => withLab(async (page) => {
    await clickAndIdle(page, '#btn-next');
    assert.equal(await page.evaluate(() => document.body.dataset.animating), 'false');
  }, { reducedMotion: 'reduce' }));
});

describe('móvil', () => {
  const perfiles = {
    '360×740': { viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true },
    'iPhone 13': devices['iPhone 13'],
  };

  for (const [nombre, opts] of Object.entries(perfiles)) {
    test(`${nombre}: sin scroll horizontal en los pasos 0, 7 y 10 y recorrido completo`, () => withLab(async (page) => {
      const sinScroll = async (etq) => {
        const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, bw: document.body.scrollWidth }));
        assert.ok(m.sw <= m.iw, `${nombre} ${etq}: scrollWidth ${m.sw} > innerWidth ${m.iw}`);
      };
      await sinScroll('paso 0');
      for (let i = 1; i <= 10; i++) {
        await clickAndIdle(page, '#btn-next');
        await assertDomMatchesProjection(page, `${nombre} paso ${i}`);
        if (i === 7 || i === 10) await sinScroll(`paso ${i}`);
      }
      assert.equal((await snapshot(page)).step, 10);
    }, opts));

    test(`${nombre}: los controles están visibles dentro del viewport y son clicables`, () => withLab(async (page) => {
      const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
      for (const sel of ['#btn-next', '#btn-play', '#btn-reset', '#command-input']) {
        const loc = page.locator(sel);
        await loc.scrollIntoViewIfNeeded();
        assert.equal(await loc.isVisible(), true, sel);
        const b = await loc.boundingBox();
        assert.ok(b.x >= 0 && b.x + b.width <= vp.w + 0.5, `${sel} se sale por los lados`);
        assert.ok(b.y >= 0 && b.y + b.height <= vp.h + 0.5, `${sel} no cabe en el viewport vertical (y=${b.y}, h=${b.height}, vh=${vp.h})`);
      }
      await page.tap('#btn-next');
      await idle(page);
      assert.equal((await snapshot(page)).step, 1);
      await page.tap('#btn-prev');
      await idle(page);
      assert.equal((await snapshot(page)).step, 0);
      // El área táctil mínima razonable (≥ 32 px de alto).
      const h = (await page.locator('#btn-next').boundingBox()).height;
      assert.ok(h >= 32, `#btn-next demasiado bajo: ${h}px`);
    }, opts));

    test(`${nombre}: se puede escribir un comando en modo libre`, () => withLab(async (page) => {
      await page.fill('#command-input', 'git init');
      await page.press('#command-input', 'Enter');
      await idle(page);
      assert.ok((await snapshot(page)).state.repo);
      await assertDomMatchesProjection(page, 'móvil libre');
    }, opts));
  }

  test('360×740: ninguna zona desborda el ancho de la página', () => withLab(async (page) => {
    for (let i = 0; i < 7; i++) await clickAndIdle(page, '#btn-next');
    const rotos = await page.evaluate(() => [...document.querySelectorAll('[data-zone], .panel, .controls, header, main')]
      .filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1).map((e) => e.className || e.tagName));
    assert.deepEqual(rotos, []);
  }, { viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true }));
});
