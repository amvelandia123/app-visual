// Conecta controlador y vistas: cola de animaciones, controles, auto-play y atajos.

import { createConsole } from './console.js';
import { createStepper } from './stepper.js';
import { createExplain } from './explain.js';

const AUTOPLAY_GAP_MS = 1800;

/**
 * @param {{ module: object, controller: object, view: { render: Function }, doc?: Document }} deps
 */
export function createApp({ module, controller, view, doc = document }) {
  const $ = (id) => doc.getElementById(id);
  const btn = { prev: $('btn-prev'), next: $('btn-next'), play: $('btn-play'), reset: $('btn-reset') };

  // ----- Cola de animaciones -----
  let chain = Promise.resolve();
  let pending = 0;
  let idleWaiters = [];

  function enqueue(transitions) {
    if (!transitions?.length) return;
    pending += 1;
    doc.body.dataset.animating = 'true';
    chain = chain
      .then(async () => {
        for (const t of transitions) await view.render(module.project(t.to), t);
      })
      .catch((err) => console.error(err))
      .finally(() => {
        pending -= 1;
        if (pending === 0) {
          doc.body.dataset.animating = 'false';
          idleWaiters.forEach((r) => r());
          idleWaiters = [];
        }
      });
  }
  const whenIdle = () => (pending === 0 ? Promise.resolve() : new Promise((r) => idleWaiters.push(r)));

  // ----- Paneles -----
  const consolePanel = createConsole({
    log: $('console-log'), counter: $('console-counter'), form: $('command-form'),
    input: $('command-input'), promptLabel: $('prompt-label'),
    onSubmit: (text) => controller.run(text),
    onInteract: () => stopAutoplay(),
  });
  const stepper = createStepper({
    container: $('steps'), commands: module.data.commands,
    onSelect: (n) => { stopAutoplay(); controller.goTo(n); },
  });
  const explain = createExplain({ container: $('explain'), data: module.data });

  function updatePanels(snap) {
    consolePanel.update(snap, module.prompt(snap.state));
    stepper.update(snap);
    explain.update(snap);
    btn.prev.disabled = snap.step <= 0;
    btn.next.disabled = snap.step >= snap.total;
  }

  // ----- Auto-play -----
  let playToken = 0;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function setPlayUi(on) {
    btn.play.setAttribute('aria-pressed', String(on));
    btn.play.querySelector('.play-ico').textContent = on ? '⏸' : '⏵';
    btn.play.querySelector('.play-text').textContent = on ? 'Pausa' : 'Auto-play';
  }

  function stopAutoplay() {
    playToken += 1;
    setPlayUi(false);
  }

  async function startAutoplay() {
    const token = ++playToken;
    setPlayUi(true);
    if (controller.getSnapshot().step >= controller.getSnapshot().total) controller.reset();
    await whenIdle();
    while (token === playToken) {
      const snap = controller.getSnapshot();
      if (snap.step >= snap.total) break;
      await sleep(AUTOPLAY_GAP_MS);
      if (token !== playToken) return;
      controller.next();
      await whenIdle();
    }
    if (token === playToken) stopAutoplay();
  }

  btn.play.addEventListener('click', () => {
    if (btn.play.getAttribute('aria-pressed') === 'true') stopAutoplay();
    else startAutoplay();
  });
  btn.next.addEventListener('click', () => { stopAutoplay(); controller.next(); });
  btn.prev.addEventListener('click', () => { stopAutoplay(); controller.prev(); });
  btn.reset.addEventListener('click', () => { stopAutoplay(); controller.reset(); });

  // Atajos ←/→ (no actúan cuando se está escribiendo).
  function onKey(ev) {
    if (ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
    const t = ev.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (ev.key === 'ArrowRight') { ev.preventDefault(); if (!btn.next.disabled) btn.next.click(); }
    else if (ev.key === 'ArrowLeft') { ev.preventDefault(); if (!btn.prev.disabled) btn.prev.click(); }
  }
  doc.addEventListener('keydown', onKey);

  // Acciones lanzadas desde la vista (✎ editar, ☁ Ana) → modo libre.
  const onViewCommand = (text) => { stopAutoplay(); controller.run(text); };

  const unsubscribe = controller.subscribe((snap, transitions) => {
    updatePanels(snap);
    enqueue(transitions);
  });

  // Estado inicial (sin animación).
  const first = controller.getSnapshot();
  updatePanels(first);
  view.render(module.project(first.state), null);

  return {
    onViewCommand,
    whenIdle,
    destroy() {
      unsubscribe();
      stopAutoplay();
      doc.removeEventListener('keydown', onKey);
    },
  };
}
