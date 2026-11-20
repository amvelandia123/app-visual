// Panel «¿Qué pasó?»: explica el último comando con los textos de `module.data`.

import { inlineCode } from './console.js';

function block(title, content, cls = '') {
  const box = document.createElement('div');
  box.className = `explain-block ${cls}`.trim();
  const h = document.createElement('h3');
  h.textContent = title;
  box.append(h);
  if (Array.isArray(content)) {
    const ul = document.createElement('ul');
    for (const item of content) {
      const li = document.createElement('li');
      li.append(inlineCode(item));
      ul.append(li);
    }
    box.append(ul);
  } else {
    const p = document.createElement('p');
    p.append(inlineCode(content));
    box.append(p);
  }
  return box;
}

/**
 * @param {{ container: HTMLElement, data: object }} opts `data` = module.data
 */
export function createExplain({ container, data }) {
  let lastKey = null;
  const byId = new Map((data.commands ?? []).map((c) => [c.id, c]));

  /** @param {object} snap snapshot del controlador */
  function update(snap) {
    const res = snap.lastResult ?? null;
    const id = snap.lastCommandId ?? null;
    const key = `${id}|${snap.step}|${snap.mode}|${res?.error?.code ?? ''}|${res?.notes?.join('¦') ?? ''}|${snap.log?.length ?? 0}`;
    if (key === lastKey) return;
    lastKey = key;
    container.dataset.explainCommand = id ?? '';
    container.replaceChildren();

    // Errores detectados antes de saber qué comando era (parser: `git comit`, `cd ..`,
    // comillas sin cerrar): no hay commandId, pero sí hay que explicar qué falló.
    if (!id && res?.error) {
      const err = data.errors?.[res.error.code];
      const title = document.createElement('div');
      title.className = 'explain-title';
      const code = document.createElement('code');
      code.textContent = err?.title ?? 'Comando no válido';
      title.append(code);
      container.append(title);
      const grid = document.createElement('div');
      grid.className = 'explain-grid';
      grid.append(block('Qué falló', err?.explain ?? res.error.message, 'is-error'));
      if (res.hint) grid.append(block('Pista', res.hint, 'is-warn'));
      container.append(grid);
      return;
    }

    if (!id) {
      const p = document.createElement('p');
      p.className = 'explain-intro';
      p.append('Pulsa ', inlineCode('`Siguiente`'), ' para recorrer el escenario guiado, o escribe un comando en la consola (prueba `help`). Aquí verás qué hizo cada comando, por qué se usa y el error típico de quien empieza.');
      container.append(p);
      return;
    }

    const info = byId.get(id) ?? data.extraCommands?.[id] ?? null;
    const step = snap.mode === 'guided' ? snap.lastStep : null;
    if (step?.narration) {
      const lead = document.createElement('p');
      lead.className = 'explain-lead';
      lead.append(inlineCode(step.narration));
      container.append(lead);
    }

    const title = document.createElement('div');
    title.className = 'explain-title';
    const code = document.createElement('code');
    code.textContent = info?.name ?? id;
    title.append(code);
    if (info?.label) {
      const tag = document.createElement('span');
      tag.className = 'explain-tag';
      tag.textContent = info.label;
      title.append(tag);
    }
    container.append(title);

    const grid = document.createElement('div');
    grid.className = 'explain-grid';
    if (res?.error) {
      const err = data.errors?.[res.error.code];
      grid.append(block(err?.title ? 'Qué falló' : 'Error', err?.explain ?? res.error.message, 'is-error'));
    }
    if (info?.what) grid.append(block('Qué hizo', info.what));
    if (info?.why) grid.append(block('Por qué se usa', info.why));
    if (info?.mistake) grid.append(block('Error típico', info.mistake, 'is-warn'));
    if (info?.simplification) grid.append(block('Simplificación', info.simplification, 'is-simpl'));
    if (res?.notes?.length) grid.append(block('Sobre este resultado', res.notes));
    container.append(grid);
  }

  return { update };
}
