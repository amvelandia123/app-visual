// Vista del módulo Git: dibuja las 5 zonas a partir de la PROYECCIÓN (ARCHITECTURE §7, §10.3, §10.5).
// No guarda estado de Git: solo recuerda lo mínimo para animar (ids/aristas previos).

import { capture, play, prefersReducedMotion } from '../../ui/animator.js';

const NODE_W = 58;
const NODE_H = 26;
const MSG_H = 16;
const LBL_H = 18;
const LBL_GAP = 3;
const PAD_X = 12;
const PAD_TOP = 6;
const LANE_GAP = 8;

const STATUS_LETTER = { untracked: 'U', modified: 'M', new: 'A' };
const STATUS_WORD = { untracked: 'sin seguimiento', modified: 'modificado', new: 'nuevo' };

const ICONS = {
  working: '<path d="M2 4h4l1.5 1.5H14v7H2z"/>',
  staging: '<path d="M2 10l6 3 6-3M2 7l6 3 6-3-6-3z"/>',
  stash: '<path d="M2 4h12v3H2zM3 7v6h10V7M6.5 9.5h3"/>',
  local: '<circle cx="4" cy="3.5" r="1.6"/><circle cx="4" cy="12.5" r="1.6"/><circle cx="12" cy="6" r="1.6"/><path d="M4 5v6M12 7.6c0 3-6 1.8-8 3.4"/>',
  remote: '<path d="M4.5 12.5a3 3 0 0 1-.3-6A4 4 0 0 1 12 6.5a3 3 0 0 1 .5 6z"/>',
};

const ZONES = [
  { id: 'working', title: 'WORKING TREE', sub: 'tu carpeta' },
  { id: 'staging', title: 'STAGING', sub: 'listo para commit' },
  { id: 'stash', title: 'STASH', sub: 'guardado aparte' },
  { id: 'local', title: 'LOCAL REPO', sub: '.git en tu equipo' },
  { id: 'remote', title: 'REMOTE · ORIGIN', sub: 'GitHub' },
];

const svgNs = 'http://www.w3.org/2000/svg';

/** Crea un elemento con clase y texto opcionales. */
function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

/** Ancho estimado (px) de una etiqueta de rama para evitar solapes. */
function labelWidth(text) {
  return Math.ceil(text.length * 6.8) + 18;
}

/**
 * Calcula la disposición de un grafo (columna = x, carril = y). Función pura sobre la proyección.
 * @param {object} graph Graph de la proyección
 * @param {number} availWidth ancho disponible para ajustar el espaciado
 * @param {boolean} remote true para el grafo remoto
 */
export function layoutGraph(graph, availWidth, remote = false) {
  const commits = [...graph.commits].sort((a, b) => a.column - b.column);
  const rank = (r) => (r.kind === 'branch' && r.current ? 0 : r.kind === 'head' ? 1 : r.kind === 'branch' ? 2 : 3);
  const stacks = new Map();
  for (const ref of graph.refs) {
    if (!stacks.has(ref.target)) stacks.set(ref.target, []);
    stacks.get(ref.target).push(ref);
  }
  for (const list of stacks.values()) list.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));

  const halfW = (id) => {
    const list = stacks.get(id) ?? [];
    const w = Math.max(NODE_W, ...list.map((r) => labelWidth(r.name)));
    return w / 2;
  };
  const stackH = (id) => {
    const n = (stacks.get(id) ?? []).length;
    return n ? n * LBL_H + (n - 1) * LBL_GAP + 6 : 0;
  };

  const lanes = commits.reduce((m, c) => Math.max(m, c.lane + 1), 0);
  const band = Array(lanes).fill(0);
  for (const c of commits) band[c.lane] = Math.max(band[c.lane], stackH(c.id));
  const laneTop = [];
  let y = PAD_TOP;
  for (let l = 0; l < lanes; l++) {
    laneTop[l] = y + band[l];
    y += band[l] + NODE_H + MSG_H + LANE_GAP;
  }
  const height = Math.max(y + 2, 96);

  // Espaciado horizontal adaptativo: se reparte el ancho si cabe, y nunca se baja de un mínimo.
  const n = commits.length;
  const baseCol = n > 1 ? Math.min(92, Math.max(76, (availWidth - 2 * PAD_X - NODE_W) / (n - 1))) : 92;
  const x = new Map();
  let cursor = PAD_X + (commits.length ? Math.max(halfW(commits[0].id), 46) : 0);
  commits.forEach((c, i) => {
    if (i > 0) {
      const prevCol = commits[i - 1];
      let step = baseCol;
      // Si hay etiquetas en el mismo carril en columnas contiguas, se separan lo justo.
      if (prevCol.lane === c.lane) step = Math.max(step, halfW(prevCol.id) + halfW(c.id) + 8);
      cursor += step;
    }
    x.set(c.id, cursor);
  });
  const width = commits.length ? Math.max(...[...x.values()]) + (commits.length ? halfW(commits[commits.length - 1].id) : 0) + PAD_X : availWidth;

  const nodes = commits.map((c) => ({ c, cx: x.get(c.id), top: laneTop[c.lane] }));
  const byId = new Map(nodes.map((nd) => [nd.c.id, nd]));
  const edges = [];
  for (const nd of nodes) {
    nd.c.parents.forEach((pid, idx) => {
      const p = byId.get(pid);
      if (!p) return;
      const x1 = p.cx + NODE_W / 2;
      const y1 = p.top + NODE_H / 2;
      const x2 = nd.cx - NODE_W / 2;
      const y2 = nd.top + NODE_H / 2;
      const dx = Math.max(14, (x2 - x1) / 2);
      const d = y1 === y2 ? `M${x1} ${y1} L${x2} ${y2}` : `M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`;
      edges.push({ key: `${pid}>${nd.c.id}`, d, merge: idx > 0 });
    });
  }

  const refs = [];
  for (const [target, list] of stacks) {
    const nd = byId.get(target);
    if (!nd) continue;
    list.forEach((ref, i) => {
      refs.push({ ref, cx: nd.cx, top: nd.top - 5 - (i + 1) * LBL_H - i * LBL_GAP, remote });
    });
  }
  return { width, height, nodes, edges, refs };
}

/**
 * Crea la vista de Git.
 * @param {HTMLElement} root contenedor (#stage)
 * @param {{ onCommand?: (text: string) => void }} [options]
 */
export function createGitView(root, { onCommand = () => {} } = {}) {
  const zones = {};
  const slots = {};
  const prev = { local: { edges: new Set(), pos: new Map(), count: -1 }, remote: { edges: new Set(), pos: new Map(), count: -1 } };

  // ----- Esqueleto fijo (se construye una vez) -----
  root.replaceChildren();
  for (const z of ZONES) {
    const section = el('section', 'zone');
    section.dataset.zone = z.id;
    const head = el('header', 'zone-head');
    const title = el('h2', 'zone-title');
    title.id = `zone-title-${z.id}`;
    title.innerHTML = `<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[z.id]}</svg>`;
    title.append(z.title);
    head.append(title);
    const sub = el('span', 'zone-sub', z.sub);
    head.append(sub);
    section.setAttribute('aria-labelledby', title.id);
    section.append(head);
    zones[z.id] = section;
    root.append(section);
  }
  for (const id of ['working', 'staging']) {
    slots[id] = el('div', 'zone-body files');
    zones[id].append(slots[id]);
  }
  slots.stash = el('div', 'zone-body stash-stack');
  zones.stash.append(slots.stash);

  slots.syncHost = zones.local.querySelector('.zone-head');
  slots.localScroll = el('div', 'graph-scroll');
  zones.local.append(slots.localScroll);

  slots.remoteMeta = el('div', 'remote-meta');
  slots.remoteScroll = el('div', 'graph-scroll');
  const anaBtn = el('button', 'ana-btn', '☁ Simular push de Ana');
  anaBtn.type = 'button';
  anaBtn.dataset.anaPush = '';
  anaBtn.title = 'Ana sube un commit al servidor (ana-push)';
  zones.remote.append(slots.remoteMeta, slots.remoteScroll, anaBtn);

  const onClick = (ev) => {
    const edit = ev.target.closest('[data-edit]');
    if (edit) return onCommand(`edit ${edit.dataset.edit}`);
    if (ev.target.closest('[data-ana-push]')) return onCommand('ana-push');
  };
  root.addEventListener('click', onClick);

  // ----- Piezas de dibujo -----
  function fileCard(path, status) {
    const card = el('div', 'file-card');
    card.dataset.file = path;
    if (status) card.dataset.fileStatus = status;
    card.dataset.animKey = `file:${path}`;
    card.innerHTML = '<svg class="file-ico" viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 1.5h6l3 3v10h-9z"/><path d="M9.5 1.5v3h3"/></svg>';
    card.append(el('span', 'file-name', path));
    if (status) {
      const badge = el('span', 'badge');
      badge.title = STATUS_WORD[status];
      badge.append(el('span', null, STATUS_LETTER[status]));
      badge.firstChild.setAttribute('aria-hidden', 'true');
      badge.append(el('span', 'sr-only', STATUS_WORD[status]));
      card.append(badge);
    }
    return card;
  }

  function cleanCard(path) {
    const card = fileCard(path, null);
    card.classList.add('is-clean');
    delete card.dataset.file;
    card.dataset.cleanFile = path;
    const btn = el('button', 'edit-btn', '✎');
    btn.type = 'button';
    btn.dataset.edit = path;
    btn.setAttribute('aria-label', `Editar ${path} (simula guardar un cambio)`);
    btn.title = `Editar ${path} (simula guardar un cambio)`;
    card.append(btn);
    return card;
  }

  function drawFiles(p) {
    const work = [
      ...p.working.map((f) => ({ path: f.path, node: () => fileCard(f.path, f.status) })),
      ...p.clean.map((path) => ({ path, node: () => cleanCard(path) })),
    ].sort((a, b) => a.path.localeCompare(b.path));
    slots.working.replaceChildren(...(work.length ? work.map((w) => w.node()) : [el('p', 'empty-note', 'Carpeta vacía')]));
    slots.staging.replaceChildren(
      ...(p.staging.length ? p.staging.map((f) => fileCard(f.path, f.status)) : [el('p', 'empty-note', 'Nada preparado')]),
    );
    if (!p.stash.length) {
      slots.stash.replaceChildren(el('p', 'empty-note', 'Pila vacía'));
      return;
    }
    slots.stash.replaceChildren(
      ...p.stash.map((entry, i) => {
        const box = el('div', 'stash-entry');
        box.dataset.stashIndex = String(i);
        box.dataset.animKey = `stash:${entry.ref}`;
        box.append(el('div', 'stash-ref', entry.ref), el('div', 'stash-msg', entry.message));
        const list = el('div', 'files');
        for (const path of entry.files) {
          const card = fileCard(path, null);
          card.classList.add('in-stash');
          list.append(card);
        }
        box.append(list);
        return box;
      }),
    );
  }

  function drawSync(p) {
    slots.syncHost.querySelector('[data-sync]')?.remove();
    if (!p.sync) return;
    const { ahead, behind, upstream } = p.sync;
    const s = el('span', 'sync');
    s.dataset.sync = '';
    s.dataset.ahead = String(ahead);
    s.dataset.behind = String(behind);
    s.setAttribute('aria-label', `${ahead} commits por delante y ${behind} por detrás de ${upstream}`);
    s.title = `${ahead} por delante · ${behind} por detrás de ${upstream}`;
    const a = el('span', 'ahead', `↑${ahead}`);
    const b = el('span', 'behind', `↓${behind}`);
    s.append(a, b, el('span', 'up', upstream));
    slots.syncHost.append(s);
  }

  /** Dibuja un grafo en su contenedor con scroll interno. */
  function drawGraph(scrollEl, graph, which, { remote = false, emptyText, animate }) {
    const old = prev[which];
    const avail = Math.max(scrollEl.clientWidth, 200);
    const lay = layoutGraph(graph, avail, remote);
    const wrap = el('div', 'graph');
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', remote ? 'Grafo de commits del remoto' : 'Grafo de commits local');

    if (!graph.commits.length) {
      if (graph.unborn) {
        wrap.style.height = '86px';
        const ghost = el('div', 'commit-unborn', 'vacío');
        ghost.style.left = `${PAD_X + 20}px`;
        ghost.style.top = '38px';
        const lbl = el('span', 'ref is-current unborn-ref', graph.unborn);
        lbl.style.left = `${PAD_X + 20 + NODE_W / 2}px`;
        lbl.style.top = '14px';
        wrap.append(ghost, lbl);
      } else {
        wrap.style.height = '70px';
        const note = el('p', 'empty-note', emptyText);
        note.style.margin = '8px 0';
        wrap.append(note);
      }
      scrollEl.replaceChildren(wrap);
      old.edges = new Set();
      old.pos = new Map();
      old.count = 0;
      return;
    }

    wrap.style.width = `${lay.width}px`;
    wrap.style.height = `${lay.height}px`;

    const svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('class', 'graph-edges');
    svg.setAttribute('width', String(lay.width));
    svg.setAttribute('height', String(lay.height));
    svg.setAttribute('aria-hidden', 'true');
    const motion = animate && !prefersReducedMotion();
    const edgeKeys = new Set();
    let moved = false;
    for (const e of lay.edges) {
      const path = document.createElementNS(svgNs, 'path');
      const isNew = motion && old.count >= 0 && !old.edges.has(e.key);
      path.setAttribute('class', `edge${e.merge ? ' is-merge' : ''}${isNew ? ' is-new' : ''}`);
      path.setAttribute('d', e.d);
      if (isNew) path.setAttribute('pathLength', '1');
      svg.append(path);
      edgeKeys.add(e.key);
    }
    wrap.append(svg);

    const headTarget = graph.refs.find((r) => r.kind === 'head')?.target;
    const pos = new Map();
    for (const { c, cx, top } of lay.nodes) {
      const node = el('div', 'commit');
      node.dataset.commit = c.id;
      node.dataset.animKey = `commit:${c.id}`;
      node.dataset.lane = String(c.lane % 4);
      node.style.left = `${cx - NODE_W / 2}px`;
      node.style.top = `${top}px`;
      if (c.id === headTarget) node.classList.add('is-head');
      if (c.parents.length > 1) node.classList.add('is-merge');
      node.setAttribute('role', 'img');
      node.setAttribute('aria-label', `Commit ${c.id}: ${c.message}${c.author ? ` (${c.author})` : ''}${c.parents.length > 1 ? ', commit de merge' : ''}`);
      node.title = `${c.id} · ${c.message}${c.author ? `\n${c.author}` : ''}`;
      node.append(el('span', 'hash', c.id));
      if (c.author && c.author !== 'Andrés') {
        const dot = el('span', 'author-dot', c.author[0].toUpperCase());
        dot.setAttribute('aria-hidden', 'true');
        node.append(dot);
      }
      node.append(el('span', 'commit-msg', c.message));
      wrap.append(node);
      pos.set(c.id, `${cx}|${top}`);
      if (old.pos.has(c.id) && old.pos.get(c.id) !== `${cx}|${top}`) moved = true;
    }

    for (const { ref, cx, top } of lay.refs) {
      const lbl = el('span', 'ref', ref.name);
      lbl.dataset.ref = ref.name;
      lbl.dataset.target = ref.target;
      lbl.dataset.kind = ref.kind;
      lbl.dataset.animKey = `ref:${ref.name}`;
      lbl.style.left = `${cx}px`;
      lbl.style.top = `${top}px`;
      if (remote && ref.kind === 'branch') lbl.classList.add('is-remote-branch');
      else if (ref.kind === 'branch' && ref.current) lbl.classList.add('is-current');
      if (ref.kind === 'head') lbl.classList.add('is-head');
      if (ref.kind === 'tracking') lbl.classList.add('is-tracking');
      wrap.append(lbl);
    }

    const countChanged = graph.commits.length !== old.count;
    scrollEl.replaceChildren(wrap);
    if (countChanged) scrollEl.scrollLeft = scrollEl.scrollWidth;
    if (motion && moved) {
      svg.animate([{ opacity: 0.15 }, { opacity: 1 }], { duration: 500, delay: 250, easing: 'ease-out', fill: 'backwards' });
    }
    old.edges = edgeKeys;
    old.pos = pos;
    old.count = graph.commits.length;
  }

  function drawRemote(p, animate) {
    const r = p.remote;
    const chip = el('span', `status-chip${r.connected ? ' is-on' : ''}`, r.connected ? 'conectado' : 'sin remoto');
    const url = el('span', 'remote-url', r.connected ? r.url : `${r.url ?? ''}`.trim() ? `${r.url} (no configurado)` : 'git remote add origin <url>');
    slots.remoteMeta.replaceChildren(chip, url);
    drawGraph(slots.remoteScroll, r.graph, 'remote', {
      remote: true, animate, emptyText: r.connected ? 'El servidor aún no tiene commits' : 'Conecta un remoto con git remote add',
    });
  }

  function draw(p, animate) {
    drawFiles(p);
    drawSync(p);
    drawGraph(slots.localScroll, p.local, 'local', {
      animate, emptyText: p.initialized ? 'Sin commits todavía' : 'Aún no hay repositorio: git init',
    });
    drawRemote(p, animate);
  }

  return {
    /**
     * Dibuja la proyección; si hay transición, la anima (FLIP + vuelos).
     * @param {object} projection
     * @param {{ kind: string } | null} [transition]
     * @returns {Promise<void>}
     */
    async render(projection, transition = null) {
      const before = transition ? capture(root) : null;
      draw(projection, Boolean(transition) && (transition.kind === 'pre' || transition.kind === 'command'));
      if (before) await play(root, before, { kind: transition.kind });
    },
    destroy() {
      root.removeEventListener('click', onClick);
      root.replaceChildren();
    },
  };
}
