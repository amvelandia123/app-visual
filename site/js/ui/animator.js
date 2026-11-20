// Animador FLIP genérico (§10.4). Trabaja con elementos `[data-anim-key]`.
// - capture(root): mide y guarda los elementos antes de renderizar.
// - play(before, opts): tras renderizar, anima las diferencias con Web Animations API.
// Los vuelos entre zonas usan un clon fantasma en una capa `position: fixed`.

const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
/** Prefijos de clave que pueden "volar" de una zona a otra. */
const FLYING = ['file:', 'commit:'];

/** @returns {boolean} true si el usuario pide reducir el movimiento */
export function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Duración por tipo de transición (ms). */
export function durationFor(kind) {
  if (kind === 'pre') return 400;
  if (kind === 'command') return 700;
  return 0;
}

function zoneOf(el) {
  return el.closest('[data-zone]')?.dataset.zone ?? '';
}

function flies(key) {
  return FLYING.some((p) => key.startsWith(p));
}

function getLayer() {
  let layer = document.getElementById('fx-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'fx-layer';
    layer.setAttribute('aria-hidden', 'true');
    document.body.appendChild(layer);
  }
  return layer;
}

/** Crea un clon fantasma posicionado sobre `rect`. */
function makeGhost(sourceEl, rect) {
  const ghost = sourceEl.cloneNode(true);
  ghost.removeAttribute('id');
  ghost.removeAttribute('data-anim-key');
  ghost.removeAttribute('data-file');
  ghost.removeAttribute('data-clean-file');
  ghost.removeAttribute('data-commit');
  ghost.classList.add('ghost');
  ghost.classList.remove('fx-glow', 'fx-land');
  Object.assign(ghost.style, {
    left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`,
    visibility: 'visible', opacity: '1',
  });
  getLayer().appendChild(ghost);
  return ghost;
}

/**
 * Mide todos los elementos animables.
 * @param {HTMLElement} root
 */
export function capture(root) {
  return [...root.querySelectorAll('[data-anim-key]')].map((el) => ({
    key: el.dataset.animKey,
    zone: zoneOf(el),
    rect: el.getBoundingClientRect(),
    clean: el.hasAttribute('data-clean-file'),
    node: el.cloneNode(true),
  }));
}

const safeFinished = (anim) => anim.finished.catch(() => {});

/**
 * Reproduce las animaciones entre el estado capturado y el DOM actual.
 * @param {HTMLElement} root
 * @param {ReturnType<typeof capture>} before
 * @param {{ kind?: string }} [opts]
 * @returns {Promise<void>}
 */
export async function play(root, before, opts = {}) {
  const kind = opts.kind ?? null;
  const dur = durationFor(kind);
  if (!before || prefersReducedMotion()) return;

  if (kind === 'jump' || kind === 'reset') {
    // Sin vuelos: fundido corto del escenario.
    const a = root.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' });
    await safeFinished(a);
    return;
  }
  if (!dur) return;

  const after = [...root.querySelectorAll('[data-anim-key]')].map((el) => ({
    el, key: el.dataset.animKey, zone: zoneOf(el), rect: el.getBoundingClientRect(), clean: el.hasAttribute('data-clean-file'),
  }));
  const byKeyZone = new Map();
  const byKey = new Map();
  for (const rec of before) {
    const kz = `${rec.key}|${rec.zone}`;
    if (!byKeyZone.has(kz)) byKeyZone.set(kz, rec);
    if (!byKey.has(rec.key)) byKey.set(rec.key, []);
    byKey.get(rec.key).push(rec);
  }
  const newKeyZones = new Set(after.map((a) => `${a.key}|${a.zone}`));
  const newKeys = new Set(after.map((a) => a.key));

  const anims = [];
  const restore = [];
  let flights = 0;
  const appearing = [];

  // Nodo de commit nuevo en el repositorio local: destino de los archivos que se "guardan".
  const newLocalCommit = after.find((a) => a.key.startsWith('commit:') && a.zone === 'local' && !byKeyZone.has(`${a.key}|local`));

  const fly = (ghostSource, from, toRect, { toEl = null, shrink = false, fade = false, delay = 0 } = {}) => {
    const ghost = makeGhost(ghostSource, from);
    const dx = toRect.left + toRect.width / 2 - (from.left + from.width / 2);
    const dy = toRect.top + toRect.height / 2 - (from.top + from.height / 2);
    const endScale = shrink ? 0.35 : 1;
    const a = ghost.animate(
      [
        { transform: 'translate(0,0) scale(1)', opacity: 1, filter: 'drop-shadow(0 0 0 rgba(61,255,162,0))' },
        { transform: `translate(${dx / 2}px, ${dy / 2 - 22}px) scale(1.07)`, opacity: 1, filter: 'drop-shadow(0 0 10px rgba(61,255,162,.8))', offset: 0.5 },
        { transform: `translate(${dx}px, ${dy}px) scale(${endScale})`, opacity: fade || shrink ? 0.15 : 1, filter: 'drop-shadow(0 0 0 rgba(61,255,162,0))' },
      ],
      { duration: dur * 0.85, delay, easing: EASE, fill: 'both' },
    );
    flights++;
    if (toEl) {
      toEl.style.visibility = 'hidden';
      restore.push(toEl);
    }
    anims.push(
      safeFinished(a).then(() => {
        ghost.remove();
        if (toEl) {
          toEl.style.visibility = '';
          toEl.classList.add('fx-land');
          setTimeout(() => toEl.classList.remove('fx-land'), 600);
        }
      }),
    );
  };

  // 1) Elementos presentes ahora: deslizar, volar desde otra zona o aparecer.
  for (const cur of after) {
    const same = byKeyZone.get(`${cur.key}|${cur.zone}`);
    if (same) {
      const dx = same.rect.left - cur.rect.left;
      const dy = same.rect.top - cur.rect.top;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        const a = cur.el.animate(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
          { duration: dur * 0.85, easing: EASE },
        );
        anims.push(safeFinished(a));
      } else if (cur.clean && !same.clean && newLocalCommit && cur.zone === 'working') {
        // `commit -a`: el archivo modificado "viaja" al nuevo commit aunque no pasara por STAGING.
        const src = before.find((b) => b.key === cur.key && b.zone === cur.zone);
        fly(src.node, src.rect, newLocalCommit.rect, { shrink: true });
      }
      continue;
    }
    const sources = flies(cur.key) ? (byKey.get(cur.key) ?? []).filter((s) => s.zone !== cur.zone) : [];
    if (sources.length) {
      // Preferimos la zona de origen "lógica": la más lejana en vertical/horizontal no importa; tomamos la primera.
      const src = sources[0];
      fly(src.node, src.rect, cur.rect, { toEl: cur.el });
    } else {
      appearing.push(cur);
    }
  }

  // 2) Elementos que desaparecen: vuelan al nuevo commit o se desvanecen.
  for (const old of before) {
    if (newKeyZones.has(`${old.key}|${old.zone}`)) continue;
    if (newKeys.has(old.key) && flies(old.key)) continue; // ya cubierto por un vuelo
    if (old.key.startsWith('file:') && newLocalCommit) {
      fly(old.node, old.rect, newLocalCommit.rect, { shrink: true });
    } else if (old.key.startsWith('file:') || old.key.startsWith('stash:')) {
      const ghost = makeGhost(old.node, old.rect);
      const a = ghost.animate(
        [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.9)' }],
        { duration: dur * 0.5, easing: 'ease-in', fill: 'both' },
      );
      anims.push(safeFinished(a).then(() => ghost.remove()));
    }
  }

  // 3) Aparecen (tras los vuelos, para que se vea la causa y el efecto).
  const delay = flights ? dur * 0.55 : 0;
  for (const cur of appearing) {
    const isNode = cur.key.startsWith('commit:');
    const a = cur.el.animate(
      isNode
        ? [{ opacity: 0, transform: 'scale(0.2)' }, { opacity: 1, transform: 'scale(1.15)', offset: 0.65 }, { opacity: 1, transform: 'scale(1)' }]
        : [{ opacity: 0, transform: 'translateY(6px) scale(0.96)' }, { opacity: 1, transform: 'none' }],
      { duration: dur * 0.7, delay, easing: EASE, fill: 'backwards' },
    );
    if (isNode) {
      cur.el.classList.add('fx-glow');
      setTimeout(() => cur.el.classList.remove('fx-glow'), delay + 1200);
    }
    anims.push(safeFinished(a));
  }

  // Red de seguridad: nunca dejamos elementos ocultos.
  try {
    await Promise.race([Promise.all(anims), new Promise((r) => setTimeout(r, dur + delay + 600))]);
  } finally {
    for (const el of restore) el.style.visibility = '';
    document.querySelectorAll('#fx-layer .ghost').forEach((g) => g.remove());
  }
}
