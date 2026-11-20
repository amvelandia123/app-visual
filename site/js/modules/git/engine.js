// Motor de Git simulado: estado inmutable + transiciones puras. Sin DOM.
// Contrato: docs/ARCHITECTURE.md §4 (estado) y §5 (semántica de comandos).

export const REMOTE_URL = 'https://github.com/equipo/tienda.git';
export const CWD = '~/tienda';
export const ABS_PATH = '/home/andres/tienda';
export const USER = 'Andrés';
export const TEAMMATE = 'Ana';

// ---------------------------------------------------------------------------
// Hash determinista (§4.2)
// ---------------------------------------------------------------------------

/** FNV-1a de 32 bits sobre una cadena. @param {string} str @returns {number} */
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Id de commit de 7 hex, determinista. */
export function hashId(seq, message, parents, tree) {
  const sorted = Object.fromEntries(Object.entries(tree).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const raw = `${seq}|${message}|${parents.join(',')}|${JSON.stringify(sorted)}`;
  return fnv1a(raw).toString(16).padStart(8, '0').slice(0, 7);
}

// ---------------------------------------------------------------------------
// Estado inicial (§4.3)
// ---------------------------------------------------------------------------

/** Crea el estado inicial: carpeta ~/tienda sin repositorio. @returns {object} */
export function createInitialState() {
  return {
    cwd: CWD,
    seq: 0,
    versions: { 'app.js': 1, 'cart.js': 1, 'style.css': 1 },
    worktree: { 'app.js': 'app.js@v1', 'cart.js': 'cart.js@v1', 'style.css': 'style.css@v1' },
    repo: null,
    server: { url: REMOTE_URL, branches: {} },
    objects: {},
  };
}

// ---------------------------------------------------------------------------
// Derivados (§4.1)
// ---------------------------------------------------------------------------

const sortStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sortedKeys = (o) => Object.keys(o).sort(sortStr);

/** Id del commit al que apunta HEAD, o null si la rama no tiene commits. */
export function headCommit(state) {
  return state.repo ? state.repo.branches[state.repo.head] ?? null : null;
}

/** Árbol del commit de HEAD (`{}` si no hay commits). */
export function headTree(state) {
  const id = headCommit(state);
  return id ? state.objects[id].tree : {};
}

/**
 * Estado de los archivos: preparados, modificados sin preparar y sin seguimiento.
 * @returns {{staged:{path:string,kind:string}[], unstaged:{path:string,kind:string}[], untracked:string[]}}
 */
export function getStatus(state) {
  const out = { staged: [], unstaged: [], untracked: [] };
  if (!state.repo) {
    out.untracked = sortedKeys(state.worktree);
    return out;
  }
  const { index } = state.repo;
  const ht = headTree(state);
  const all = new Set([...Object.keys(index), ...Object.keys(ht)]);
  for (const p of [...all].sort(sortStr)) {
    if (index[p] !== ht[p]) {
      out.staged.push({ path: p, kind: !(p in ht) ? 'new' : !(p in index) ? 'deleted' : 'modified' });
    }
  }
  for (const p of sortedKeys(index)) {
    if (worktreeDiffers(state, p)) out.unstaged.push({ path: p, kind: p in state.worktree ? 'modified' : 'deleted' });
  }
  out.untracked = sortedKeys(state.worktree).filter((p) => !(p in index));
  return out;
}

function worktreeDiffers(state, p) {
  return state.worktree[p] !== state.repo.index[p];
}

/** Conjunto de commits alcanzables desde una lista de ids. */
export function reachable(state, ids) {
  const seen = new Set();
  const stack = ids.filter(Boolean);
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id) || !state.objects[id]) continue;
    seen.add(id);
    for (const p of state.objects[id].parents) stack.push(p);
  }
  return seen;
}

/** ¿`a` es ancestro de `b` (o igual)? */
export function isAncestor(state, a, b) {
  if (!a || !b) return false;
  return reachable(state, [b]).has(a);
}

/** Ancestro común con mayor `seq`, o null. */
export function mergeBase(state, a, b) {
  const ra = reachable(state, [a]);
  const rb = reachable(state, [b]);
  let best = null;
  for (const id of ra) {
    if (rb.has(id) && (best === null || state.objects[id].seq > state.objects[best].seq)) best = id;
  }
  return best;
}

/** Ordena ids de commit por seq ascendente. */
export function sortBySeq(state, ids) {
  return [...ids].sort((a, b) => state.objects[a].seq - state.objects[b].seq);
}

/**
 * Commits por delante/detrás respecto al upstream de una rama.
 * @returns {{upstream:string, ahead:number, behind:number}|null}
 */
export function aheadBehind(state, branch) {
  if (!state.repo) return null;
  const upstream = state.repo.upstream[branch];
  if (!upstream) return null;
  const remoteTip = state.repo.tracking[upstream];
  const localTip = state.repo.branches[branch];
  if (!remoteTip || !localTip) return null;
  const rl = reachable(state, [localTip]);
  const rr = reachable(state, [remoteTip]);
  let ahead = 0;
  let behind = 0;
  for (const id of rl) if (!rr.has(id)) ahead++;
  for (const id of rr) if (!rl.has(id)) behind++;
  return { upstream, ahead, behind };
}

/** Archivos que el stash cambia respecto a su commit base (para mostrarlos). */
export function stashFiles(state, entry) {
  const base = state.objects[entry.base]?.tree ?? {};
  const paths = new Set([...Object.keys(entry.worktree), ...Object.keys(base)]);
  return [...paths].filter((p) => entry.worktree[p] !== base[p] || entry.index[p] !== base[p]).sort(sortStr);
}

// ---------------------------------------------------------------------------
// Utilidades internas
// ---------------------------------------------------------------------------

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const treesEqual = (a, b) => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
};
const changedPaths = (from, to) =>
  [...new Set([...Object.keys(from), ...Object.keys(to)])].filter((p) => from[p] !== to[p]).sort(sortStr);

function ok(state, commandId, output, o = {}) {
  return {
    ok: true,
    state,
    changed: o.changed ?? false,
    commandId,
    output,
    error: null,
    hint: o.hint ?? null,
    notes: o.notes ?? [],
    effects: o.effects ?? [],
    ui: o.ui ?? null,
  };
}

function fail(state, commandId, code, lines, o = {}) {
  return {
    ok: false,
    state,
    changed: false,
    commandId,
    output: lines,
    error: { code, message: o.message ?? lines[0] },
    hint: o.hint ?? null,
    notes: o.notes ?? [],
    effects: [],
    ui: null,
  };
}

function makeCommit(s, message, parents, tree, author) {
  s.seq += 1;
  const id = hashId(s.seq, message, parents, tree);
  s.objects[id] = { id, message, parents, tree: { ...tree }, author, seq: s.seq };
  return id;
}

const short = (msg) => msg.split('\n')[0];
const BAD_NAME = /[\s~^:?*[\\]|\.\.|^[-/]|\/$|\.lock$|^$|@\{/;
const validBranchName = (n) => !BAD_NAME.test(n);

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

function statusFooter(st) {
  if (st.staged.length) return null;
  if (st.unstaged.length) return 'sin cambios agregados al commit (usa "git add" y/o "git commit -a")';
  if (st.untracked.length)
    return 'no hay nada agregado al commit pero hay archivos sin seguimiento presentes (usa "git add" para hacerles seguimiento)';
  return null;
}

function cleanFooter(state, st) {
  if (st.staged.length || st.unstaged.length || st.untracked.length) return statusFooter(st);
  return headCommit(state)
    ? 'nada para hacer commit, el árbol de trabajo está limpio'
    : 'no hay nada para hacer commit (crea/copia archivos y usa "git add" para hacerles seguimiento)';
}

/** Líneas de `git status` al estilo de Git en español. */
export function statusLines(state) {
  const { repo } = state;
  const st = getStatus(state);
  const L = [`En la rama ${repo.head}`];
  if (!headCommit(state)) L.push('', 'No hay commits todavía');
  const ab = aheadBehind(state, repo.head);
  if (ab) {
    if (ab.ahead === 0 && ab.behind === 0) L.push(`Tu rama está actualizada con '${ab.upstream}'.`);
    else if (ab.behind === 0) {
      L.push(`Tu rama está adelantada a '${ab.upstream}' por ${plural(ab.ahead, 'commit', 'commits')}.`);
      L.push('  (usa "git push" para publicar tus commits locales)');
    } else if (ab.ahead === 0) {
      L.push(`Tu rama está detrás de '${ab.upstream}' por ${plural(ab.behind, 'commit', 'commits')}, y puede ser avanzada rápido.`);
      L.push('  (usa "git pull" para actualizar tu rama local)');
    } else {
      L.push(`Tu rama y '${ab.upstream}' han divergido,`);
      L.push(`y tienen ${ab.ahead} y ${ab.behind} commits diferentes cada una, respectivamente.`);
      L.push('  (usa "git pull" si quieres integrar la rama remota en la tuya)');
    }
  }
  const label = { new: 'nuevo archivo:', modified: 'modificado:', deleted: 'borrado:' };
  const row = (kind, p) => `\t${(label[kind] ?? kind).padEnd(15)} ${p}`;
  if (st.staged.length) {
    L.push('', 'Cambios a ser confirmados:', '  (usa "git restore --staged <archivo>..." para sacar del área de stage)');
    for (const f of st.staged) L.push(row(f.kind, f.path));
  }
  if (st.unstaged.length) {
    L.push('', 'Cambios no rastreados para el commit:', '  (usa "git add <archivo>..." para actualizar lo que será confirmado)');
    for (const f of st.unstaged) L.push(row(f.kind, f.path));
  }
  if (st.untracked.length) {
    L.push('', 'Archivos sin seguimiento:', '  (usa "git add <archivo>..." para incluirlo a lo que será confirmado)');
    for (const p of st.untracked) L.push(`\t${p}`);
  }
  const footer = cleanFooter(state, st);
  if (footer) L.push('', footer);
  return L;
}

// ---------------------------------------------------------------------------
// Árbol de trabajo: comprobación de conflictos y aplicación (switch / merge ff)
// ---------------------------------------------------------------------------

/**
 * Comprueba si pasar del árbol `from` al árbol `to` pisaría cambios locales.
 * @returns {{error?: {code:string, lines:string[]}, paths?: string[]}}
 */
function checkoutPlan(state, from, to, verb) {
  const { index } = state.repo;
  const dirty = [];
  const untracked = [];
  const paths = changedPaths(from, to);
  for (const p of paths) {
    const inWork = p in state.worktree;
    if (inWork && !(p in index) && !(p in from)) {
      if (to[p] !== undefined && state.worktree[p] !== to[p]) untracked.push(p);
      continue;
    }
    if (state.worktree[p] === to[p] && index[p] === to[p]) continue;
    if (state.worktree[p] !== index[p] || index[p] !== from[p]) dirty.push(p);
  }
  const isMerge = verb === 'merge';
  if (untracked.length) {
    return {
      error: {
        code: 'UNTRACKED_OVERWRITTEN',
        lines: [
          `error: Los siguientes archivos sin seguimiento serían sobrescritos por ${isMerge ? 'fusión' : 'checkout'}:`,
          ...untracked.map((p) => `\t${p}`),
          `Por favor, mueve o elimina estos archivos antes de ${isMerge ? 'fusionar' : 'cambiar de rama'}.`,
          'Abortando',
        ],
      },
    };
  }
  if (dirty.length) {
    return {
      error: {
        code: 'LOCAL_CHANGES_OVERWRITTEN',
        lines: [
          `error: Tus cambios locales a los siguientes archivos serían sobrescritos por ${isMerge ? 'fusión' : 'checkout'}:`,
          ...dirty.map((p) => `\t${p}`),
          `Por favor, confirma tus cambios o guárdalos antes de ${isMerge ? 'fusionar' : 'cambiar de rama'}.`,
          'Abortando',
        ],
      },
    };
  }
  return { paths };
}

/** Aplica `to` a índice y árbol de trabajo solo en las rutas indicadas (muta `s`). */
function applyTree(s, to, paths) {
  for (const p of paths) {
    if (to[p] === undefined) {
      delete s.repo.index[p];
      delete s.worktree[p];
    } else {
      s.repo.index[p] = to[p];
      s.worktree[p] = to[p];
    }
  }
}

const dirtyHint = 'Opciones: haz commit de tus cambios (git commit -am "..."), o guárdalos aparte con git stash y recupéralos luego con git stash pop.';

// ---------------------------------------------------------------------------
// Comandos
// ---------------------------------------------------------------------------

function cmdInit(state) {
  if (state.repo) {
    return ok(state, 'init', [`Reinicializado el repositorio Git existente en ${ABS_PATH}/.git/`], {
      notes: ['El repositorio ya existía: no se ha perdido nada.'],
    });
  }
  const s = structuredClone(state);
  s.repo = { index: {}, branches: {}, head: 'main', stash: [], remotes: {}, tracking: {}, upstream: {} };
  return ok(s, 'init', [`Inicializado repositorio Git vacío en ${ABS_PATH}/.git/`], {
    changed: true,
    notes: ["El simulador asume init.defaultBranch=main: la rama inicial se llama 'main'."],
  });
}

function cmdStatus(state) {
  const ab = aheadBehind(state, state.repo.head);
  const notes = ab ? ["Git no consulta el servidor en 'status': compara con lo último que sabe de origin (usa git fetch para actualizar)."] : [];
  return ok(state, 'status', statusLines(state), { notes });
}

function cmdAdd(state, { args, flags }) {
  const all = flags.all || args.includes('.');
  if (!all && args.length === 0) {
    return fail(state, 'add', 'NOTHING_SPECIFIED', ['Nada especificado, nada agregado.'], {
      hint: "Tal vez quisiste decir 'git add .' para preparar todo.",
    });
  }
  if (!all) {
    for (const a of args) {
      if (!(a in state.worktree) && !(a in state.repo.index)) {
        return fail(state, 'add', 'PATHSPEC', [`fatal: ruta especificada '${a}' no concordó con ningún archivo`], {
          hint: "Revisa el nombre con 'ls'.",
        });
      }
    }
  }
  const paths = all ? Object.keys(state.worktree) : args;
  const s = structuredClone(state);
  let changed = false;
  for (const p of paths) {
    if (p in s.worktree && s.repo.index[p] !== s.worktree[p]) {
      s.repo.index[p] = s.worktree[p];
      changed = true;
    }
  }
  return changed ? ok(s, 'add', [], { changed: true }) : ok(state, 'add', []);
}

function cmdCommit(state, { flags }) {
  const msg = flags.message;
  if (msg === null || msg === undefined || msg.trim() === '') {
    return fail(state, 'commit', 'NEEDS_MESSAGE', ['Abortando el commit debido a un mensaje vacío.'], {
      hint: 'Aquí no hay editor: escribe el mensaje con -m, por ejemplo git commit -m "Describe el cambio".',
    });
  }
  const s = structuredClone(state);
  if (flags.all) {
    for (const p of Object.keys(s.repo.index)) {
      if (p in s.worktree && s.worktree[p] !== s.repo.index[p]) s.repo.index[p] = s.worktree[p];
    }
  }
  const ht = headTree(s);
  const tree = { ...s.repo.index };
  if (treesEqual(tree, ht)) {
    const st = getStatus(state);
    const staged = st.unstaged.length || st.untracked.length;
    const footer = cleanFooter(state, st);
    return fail(state, 'commit', staged ? 'NOTHING_STAGED' : 'NOTHING_TO_COMMIT', statusLines(state), {
      message: footer,
      hint: staged ? "Hay cambios sin preparar. Usa 'git add <archivo>' (o 'git commit -am' para los ya rastreados)." : null,
    });
  }
  const head = headCommit(s);
  const id = makeCommit(s, msg, head ? [head] : [], tree, USER);
  const branch = s.repo.head;
  s.repo.branches[branch] = id;
  const diff = changedPaths(ht, tree);
  const out = [`[${branch}${head ? '' : ' (commit-raíz)'} ${id}] ${short(msg)}`, ` ${plural(diff.length, 'archivo cambiado', 'archivos cambiados')}`];
  for (const p of diff) if (!(p in ht)) out.push(` crear modo 100644 ${p}`);
  return ok(s, 'commit', out, { changed: true, effects: [{ type: 'commit', id }] });
}

function cmdBranch(state, { args, flags }) {
  const { repo } = state;
  if (flags.delete) {
    if (!args[0]) return fail(state, 'branch', 'MISSING_ARG', ['fatal: se requiere el nombre de la rama a eliminar'], { hint: 'Ejemplo: git branch -d feature/carrito' });
    const name = args[0];
    if (!(name in repo.branches)) return fail(state, 'branch', 'BRANCH_NOT_FOUND', [`error: rama '${name}' no encontrada.`], { hint: "Lista las ramas con 'git branch'." });
    if (name === repo.head) return fail(state, 'branch', 'BRANCH_IN_USE', [`error: No se puede eliminar la rama '${name}' actualmente en ${ABS_PATH}`], { hint: "Cambia primero a otra rama con 'git switch'." });
    const tip = repo.branches[name];
    if (!flags.force && !isAncestor(state, tip, headCommit(state))) {
      return fail(state, 'branch', 'BRANCH_NOT_MERGED', [`error: La rama '${name}' no está completamente fusionada.`, `Si estás seguro de querer eliminarla, ejecuta 'git branch -D ${name}'.`], {
        hint: `Fusiónala primero (git merge ${name}) o fuerza el borrado con -D si de verdad quieres perder esos commits.`,
      });
    }
    const s = structuredClone(state);
    delete s.repo.branches[name];
    delete s.repo.upstream[name];
    return ok(s, 'branch', [`Eliminada la rama ${name} (era ${tip}).`], { changed: true });
  }
  if (args.length === 0) {
    const names = sortedKeys(repo.branches);
    const lines = names.map((n) => `${n === repo.head ? '* ' : '  '}${n}`);
    if (!(repo.head in repo.branches)) lines.unshift(`* ${repo.head}`);
    return ok(state, 'branch', headCommit(state) ? lines : []);
  }
  const name = args[0];
  if (!validBranchName(name)) return fail(state, 'branch', 'INVALID_BRANCH_NAME', [`fatal: '${name}' no es un nombre de rama válido.`], { hint: 'Usa letras, números, guiones y barras, sin espacios.' });
  if (name in repo.branches) return fail(state, 'branch', 'BRANCH_EXISTS', [`fatal: ya existe una rama llamada '${name}'.`]);
  const head = headCommit(state);
  if (!head) return fail(state, 'branch', 'NO_COMMITS', [`fatal: no es un nombre de objeto válido: '${repo.head}'.`], { hint: 'Una rama es una etiqueta sobre un commit: haz primero el primer commit.' });
  const s = structuredClone(state);
  s.repo.branches[name] = head;
  return ok(s, 'branch', [], { changed: true, notes: [`La rama '${name}' apunta al mismo commit (${head}) que '${repo.head}'. No se ha copiado nada.`] });
}

function cmdSwitch(state, cmd, id = 'switch') {
  const { args, flags } = cmd;
  const { repo } = state;
  const name = args[0];
  if (!name) return fail(state, id, 'MISSING_ARG', ['fatal: se requiere el nombre de una rama'], { hint: `Ejemplo: git ${id} ${flags.create ? '-c ' : ''}feature/carrito` });
  const head = headCommit(state);
  if (flags.create) {
    if (!validBranchName(name)) return fail(state, id, 'INVALID_BRANCH_NAME', [`fatal: '${name}' no es un nombre de rama válido.`]);
    if (name in repo.branches) return fail(state, id, 'BRANCH_EXISTS', [`fatal: ya existe una rama llamada '${name}'.`]);
    const s = structuredClone(state);
    const from = s.repo.head;
    if (head) s.repo.branches[name] = head;
    s.repo.head = name;
    return ok(s, id, [`Cambiado a nueva rama '${name}'`], { changed: true, effects: [{ type: 'switch', from, to: name }] });
  }
  if (name === repo.head) return ok(state, id, [`Ya en '${name}'`]);
  let target = repo.branches[name];
  let dwim = null;
  if (!target) {
    const remotes = Object.keys(repo.remotes).filter((r) => repo.tracking[`${r}/${name}`]);
    if (remotes.length === 1) dwim = `${remotes[0]}/${name}`;
    else {
      return fail(state, id, 'INVALID_REF', [`fatal: referencia inválida: ${name}`], {
        hint: `¿Querías crearla? Usa git switch -c ${name}`,
      });
    }
    target = repo.tracking[dwim];
  }
  const plan = checkoutPlan(state, headTree(state), state.objects[target].tree, 'checkout');
  if (plan.error) return fail(state, id, plan.error.code, plan.error.lines, { hint: dirtyHint });
  const s = structuredClone(state);
  applyTree(s, s.objects[target].tree, plan.paths);
  const from = s.repo.head;
  const out = [];
  if (dwim) {
    s.repo.branches[name] = target;
    s.repo.upstream[name] = dwim;
    out.push(`rama '${name}' configurada para rastrear '${dwim}'.`);
  }
  s.repo.head = name;
  out.push(`Cambiado a rama '${name}'`);
  const notes = [];
  const carried = getStatus(s);
  if (carried.unstaged.length || carried.staged.length) notes.push('Tus cambios locales que no chocan con la otra rama te han acompañado.');
  return ok(s, id, out, { changed: true, effects: [{ type: 'switch', from, to: name }], notes });
}

/** Fusión de `target` en HEAD (compartida por merge y pull). */
function doMerge(state, { target, mergeMsg, noFf }) {
  const head = headCommit(state);
  if (head && (target === head || isAncestor(state, target, head))) {
    return { kind: 'up-to-date', state, lines: ['Ya está actualizado.'], effects: [] };
  }
  const ours = headTree(state);
  const theirs = state.objects[target].tree;
  const branch = state.repo.head;
  const canFF = !head || isAncestor(state, head, target);
  const stat = (paths) => [...paths.map((p) => ` ${p} | cambiado`), ` ${plural(paths.length, 'archivo cambiado', 'archivos cambiados')}`];
  if (canFF && !noFf) {
    const plan = checkoutPlan(state, ours, theirs, 'merge');
    if (plan.error) return { error: plan.error };
    const s = structuredClone(state);
    applyTree(s, theirs, plan.paths);
    s.repo.branches[branch] = target;
    const lines = [head ? `Actualizando ${head}..${target}` : `Actualizando a ${target}`, 'Avance rápido', ...stat(plan.paths)];
    return { kind: 'fast-forward', state: s, lines, effects: [{ type: 'merge', id: target, kind: 'fast-forward' }] };
  }
  const base = mergeBase(state, head, target);
  const baseTree = base ? state.objects[base].tree : {};
  const result = {};
  const conflicts = [];
  const paths = new Set([...Object.keys(baseTree), ...Object.keys(ours), ...Object.keys(theirs)]);
  for (const p of [...paths].sort(sortStr)) {
    let v;
    if (ours[p] === baseTree[p]) v = theirs[p];
    else if (theirs[p] === baseTree[p]) v = ours[p];
    else if (ours[p] === theirs[p]) v = ours[p];
    else {
      conflicts.push(p);
      continue;
    }
    if (v !== undefined) result[p] = v;
  }
  if (conflicts.length) {
    const lines = [];
    for (const p of conflicts) lines.push(`Auto-fusionando ${p}`, `CONFLICTO (contenido): Conflicto de fusión en ${p}`);
    lines.push('Fusión automática falló; arregla los conflictos y luego realiza un commit con el resultado.');
    return { error: { code: 'MERGE_CONFLICT', lines, conflicts } };
  }
  const plan = checkoutPlan(state, ours, result, 'merge');
  if (plan.error) return { error: plan.error };
  const s = structuredClone(state);
  applyTree(s, result, plan.paths);
  const id = makeCommit(s, mergeMsg, [head, target], result, USER);
  s.repo.branches[branch] = id;
  const lines = ["Merge hecho por la estrategia 'ort'.", ...stat(changedPaths(ours, result))];
  return { kind: 'merge-commit', state: s, lines, effects: [{ type: 'merge', id, kind: 'merge-commit' }], mergeId: id };
}

function mergeFailure(state, id, e) {
  if (e.code === 'MERGE_CONFLICT') {
    return fail(state, id, e.code, e.lines, {
      hint: 'Dos ramas cambiaron el mismo archivo. En Git real editarías el archivo para elegir el resultado; aquí la fusión se cancela y nada cambia.',
      notes: ["Simplificación: el simulador cancela la fusión (equivale a 'git merge --abort') en vez de dejarte resolver el conflicto."],
    });
  }
  return fail(state, id, e.code, e.lines, { hint: dirtyHint });
}

function cmdMerge(state, { args, flags }) {
  const ref = args[0];
  if (!ref) return fail(state, 'merge', 'MISSING_ARG', ['fatal: no se especificó qué fusionar'], { hint: 'Ejemplo: git merge feature/carrito (estando en la rama que recibe los cambios).' });
  const { repo } = state;
  let target = repo.branches[ref];
  let isRemote = false;
  if (!target && repo.tracking[ref]) {
    target = repo.tracking[ref];
    isRemote = true;
  }
  if (!target) return fail(state, 'merge', 'INVALID_REF', [`merge: ${ref} - no es algo que podamos fusionar`], { hint: "Comprueba el nombre con 'git branch'." });
  const mergeMsg = isRemote ? `Merge remote-tracking branch '${ref}'` : `Merge branch '${ref}'`;
  const r = doMerge(state, { target, mergeMsg, noFf: flags.noFf });
  if (r.error) return mergeFailure(state, 'merge', r.error);
  return ok(r.state, 'merge', r.lines, { changed: r.kind !== 'up-to-date', effects: r.effects, notes: mergeNotes(r.kind, ref, state) });
}

function mergeNotes(kind, ref, state) {
  if (kind === 'fast-forward') return [`Ha sido un fast-forward: '${state.repo.head}' no tenía commits propios que '${ref}' no tuviera, así que Git solo ha movido la etiqueta (sin commit de merge).`];
  if (kind === 'merge-commit') return [`Las historias habían divergido: Git ha creado un commit de merge con dos padres (${state.repo.head} y ${ref}).`];
  return [];
}

// --- stash ---

function parseStashRef(arg) {
  if (arg === undefined) return 0;
  const m = /^stash@\{(\d+)\}$/.exec(arg);
  return m ? Number(m[1]) : null;
}

function cmdStash(state, { flags, args }) {
  const { repo } = state;
  const action = flags.action ?? 'push';
  if (action === 'list') {
    return ok(state, 'stash', repo.stash.map((e, i) => `stash@{${i}}: ${e.message}`));
  }
  if (action === 'push') return stashPush(state, flags);
  if (repo.stash.length === 0) {
    return fail(state, 'stash', 'NO_STASH', ['error: No se encontraron entradas de stash.'], { hint: "Primero guarda algo con 'git stash'." });
  }
  const n = parseStashRef(args[0]);
  if (n === null || n >= repo.stash.length) {
    return fail(state, 'stash', 'INVALID_REF', [`error: ${args[0]} no es una referencia de stash válida`], { hint: "Mira las entradas con 'git stash list'." });
  }
  if (action === 'drop') {
    const s = structuredClone(state);
    const [e] = s.repo.stash.splice(n, 1);
    return ok(s, 'stash', [`Eliminada refs/stash@{${n}} (${stashId(e)})`], { changed: true });
  }
  return stashApply(state, n, action === 'pop');
}

const stashId = (e) => fnv1a(JSON.stringify(e)).toString(16).padStart(8, '0').slice(0, 7);

function stashPush(state, flags) {
  const head = headCommit(state);
  if (!head) return fail(state, 'stash', 'NO_COMMITS', ['No tienes el commit inicial todavía'], { hint: 'El stash guarda cambios respecto al último commit: haz primero un commit.' });
  const st = getStatus(state);
  const hasTracked = st.staged.length || st.unstaged.length;
  if (!hasTracked && !(flags.includeUntracked && st.untracked.length)) {
    return ok(state, 'stash', ['No hay cambios locales para guardar'], {
      hint: st.untracked.length ? 'Los archivos sin seguimiento no se guardan por defecto: usa git stash -u.' : null,
    });
  }
  const s = structuredClone(state);
  const ht = headTree(s);
  const base = s.objects[head];
  const tracked = new Set([...Object.keys(s.repo.index), ...Object.keys(ht)]);
  const wt = {};
  for (const p of tracked) if (p in s.worktree) wt[p] = s.worktree[p];
  if (flags.includeUntracked) for (const p of st.untracked) wt[p] = s.worktree[p];
  const branch = s.repo.head;
  const wip = `${branch}: ${head} ${short(base.message)}`;
  const entry = {
    message: flags.message ? `On ${branch}: ${flags.message}` : `WIP on ${wip}`,
    branch,
    base: head,
    index: { ...s.repo.index },
    worktree: wt,
    includeUntracked: !!flags.includeUntracked,
  };
  s.repo.stash.unshift(entry);
  s.repo.index = { ...ht };
  for (const p of tracked) {
    if (p in ht) s.worktree[p] = ht[p];
    else delete s.worktree[p];
  }
  if (flags.includeUntracked) for (const p of st.untracked) delete s.worktree[p];
  return ok(s, 'stash', [`Directorio de trabajo y estado de índice ${flags.message ? `On ${branch}: ${flags.message}` : `WIP on ${wip}`} guardados`], {
    changed: true,
    effects: [{ type: 'stash-push' }],
    notes: st.untracked.length && !flags.includeUntracked ? ['Los archivos sin seguimiento se han quedado donde estaban (usa -u para guardarlos también).'] : [],
  });
}

function stashApply(state, n, drop) {
  const entry = state.repo.stash[n];
  const baseTree = state.objects[entry.base].tree;
  const ht = headTree(state);
  const { index } = state.repo;
  const paths = changedPaths(baseTree, entry.worktree);
  // Rutas que el stash toca: las que difieren de su base (incluye nuevas y sin seguimiento).
  const touched = new Set(paths);
  for (const p of Object.keys(entry.index)) if (entry.index[p] !== baseTree[p]) touched.add(p);
  const conflicts = [];
  for (const p of [...touched].sort(sortStr)) {
    const dirty = state.worktree[p] !== index[p] || index[p] !== ht[p];
    const headMoved = ht[p] !== baseTree[p] && ht[p] !== entry.worktree[p];
    if ((dirty && state.worktree[p] !== entry.worktree[p]) || headMoved) conflicts.push(p);
  }
  if (conflicts.length) {
    return fail(state, 'stash', 'STASH_CONFLICT', [
      ...conflicts.map((p) => `CONFLICTO (contenido): Conflicto de fusión en ${p}`),
      'La entrada de stash se guardó en caso de que la vuelvas a necesitar.',
    ], {
      hint: 'Tu árbol actual toca los mismos archivos que el stash. Haz commit o limpia esos archivos y vuelve a intentarlo.',
      notes: ['Simplificación: el simulador no intenta fusionar el stash; se cancela y la entrada se conserva.'],
    });
  }
  const s = structuredClone(state);
  for (const p of touched) {
    if (entry.worktree[p] === undefined) delete s.worktree[p];
    else s.worktree[p] = entry.worktree[p];
    if (baseTree[p] === undefined && ht[p] === undefined && entry.index[p] !== undefined) s.repo.index[p] = entry.index[p];
  }
  const out = [];
  if (drop) {
    const [e] = s.repo.stash.splice(n, 1);
    out.push(...statusLines(s), `Descartado refs/stash@{${n}} (${stashId(e)})`);
  } else {
    out.push(...statusLines(s));
  }
  return ok(s, 'stash', out, {
    changed: true,
    effects: [{ type: 'stash-pop' }],
    notes: ['Los archivos nuevos vuelven preparados (stage) y las modificaciones vuelven sin preparar, como Git sin --index.'],
  });
}

// --- remote / fetch / pull / push ---

function cmdRemote(state, { flags, args }) {
  const { repo } = state;
  if (flags.action === 'add') {
    if (args.length < 2) return fail(state, 'remote', 'MISSING_ARG', ['uso: git remote add <nombre> <url>'], { hint: `Ejemplo: git remote add origin ${REMOTE_URL}` });
    if (args[0] in repo.remotes) return fail(state, 'remote', 'REMOTE_EXISTS', [`error: remoto ${args[0]} ya existe.`]);
    const s = structuredClone(state);
    s.repo.remotes[args[0]] = args[1];
    return ok(s, 'remote', [], { changed: true, notes: ['En el simulador todos los remotos apuntan al mismo servidor simulado.'] });
  }
  if (flags.verbose) {
    const lines = [];
    for (const n of sortedKeys(repo.remotes)) lines.push(`${n}\t${repo.remotes[n]} (fetch)`, `${n}\t${repo.remotes[n]} (push)`);
    return ok(state, 'remote', lines);
  }
  return ok(state, 'remote', sortedKeys(repo.remotes));
}

function noRemote(state, id) {
  return fail(state, id, 'NO_REMOTE', [id === 'push' ? 'fatal: No se ha configurado un destino para el push.' : 'fatal: No se ha configurado ningún repositorio remoto.',
    '', 'O bien especifica la URL desde la línea de comandos o configura un repositorio remoto usando', '', '    git remote add <nombre> <url>', '',
    `y luego usa el nombre del remoto: git ${id} <nombre>`], {
    message: id === 'push' ? 'fatal: No se ha configurado un destino para el push.' : 'fatal: No se ha configurado ningún repositorio remoto.',
    hint: `Conecta primero el servidor: git remote add origin ${REMOTE_URL}`,
  });
}

function resolveRemote(state, id, name) {
  const names = sortedKeys(state.repo.remotes);
  if (names.length === 0) return { err: noRemote(state, id) };
  const r = name ?? (names.includes('origin') ? 'origin' : names[0]);
  if (!(r in state.repo.remotes)) {
    return { err: fail(state, id, 'NO_REMOTE', [`fatal: '${r}' no parece ser un repositorio git`, 'fatal: No se pudo leer del repositorio remoto.'], { hint: "Mira los remotos con 'git remote -v'." }) };
  }
  return { remote: r };
}

/** Copia las ramas del servidor a las refs de seguimiento (muta `s`). */
function fetchInto(s, remote) {
  const lines = [];
  const ids = [];
  for (const b of sortedKeys(s.server.branches)) {
    const key = `${remote}/${b}`;
    const tip = s.server.branches[b];
    const old = s.repo.tracking[key];
    if (old === tip) continue;
    if (!old) lines.push(` * [nueva rama]      ${b.padEnd(10)} -> ${key}`);
    else lines.push(`   ${old}..${tip}  ${b.padEnd(10)} -> ${key}`);
    const known = reachable(s, old ? [old] : []);
    for (const id of reachable(s, [tip])) if (!known.has(id)) ids.push(id);
    s.repo.tracking[key] = tip;
  }
  if (lines.length) lines.unshift(`Desde ${s.repo.remotes[remote]}`);
  return { lines, ids: sortBySeq(s, ids) };
}

function cmdFetch(state, { args }) {
  const r = resolveRemote(state, 'fetch', args[0]);
  if (r.err) return r.err;
  const s = structuredClone(state);
  const { lines, ids } = fetchInto(s, r.remote);
  if (!lines.length) return ok(state, 'fetch', []);
  return ok(s, 'fetch', lines, {
    changed: true,
    effects: [{ type: 'fetch', ids }],
    notes: ["'fetch' solo descarga: tus ramas locales no se tocan. Para integrarlo usa git merge origin/<rama> o git pull."],
  });
}

function cmdPull(state, { args }) {
  const { repo } = state;
  const r = resolveRemote(state, 'pull', args[0]);
  if (r.err) return r.err;
  let branch = args[1];
  if (args.length === 0) {
    const up = repo.upstream[repo.head];
    if (!up) {
      return fail(state, 'pull', 'NO_UPSTREAM', [
        'No hay información de rastreo para la rama actual.',
        'Por favor especifica con qué rama quieres hacer merge.', '',
        `    git pull <remoto> <rama>`, '',
        'Si deseas configurar la información de rastreo para esta rama puedes hacerlo con:', '',
        `    git branch --set-upstream-to=origin/${repo.head} ${repo.head}`,
      ], { message: 'No hay información de rastreo para la rama actual.', hint: `Prueba git pull origin ${repo.head}, o publica con git push -u origin ${repo.head} para fijar el upstream.` });
    }
    branch = up.slice(up.indexOf('/') + 1);
  } else if (!branch) {
    branch = repo.upstream[repo.head]?.split('/').slice(1).join('/') || repo.head;
  }
  if (!(branch in state.server.branches)) {
    return fail(state, 'pull', 'REMOTE_REF_NOT_FOUND', [`fatal: no se encontró la referencia remota ${branch}`], { hint: 'El servidor aún no tiene esa rama: publícala antes con git push.' });
  }
  const s = structuredClone(state);
  const f = fetchInto(s, r.remote);
  const key = `${r.remote}/${branch}`;
  const url = state.repo.remotes[r.remote];
  const m = doMerge(s, { target: s.repo.tracking[key], mergeMsg: `Merge branch '${branch}' of ${url}`, noFf: false });
  if (m.error) {
    const e = mergeFailure(state, 'pull', m.error);
    e.notes.push('Simplificación: si el merge falla, el simulador cancela todo el pull (Git real dejaría hecho el fetch).');
    return e;
  }
  const out = [...f.lines, ...m.lines];
  const changed = f.lines.length > 0 || m.kind !== 'up-to-date';
  const effects = [];
  if (f.ids.length) effects.push({ type: 'fetch', ids: f.ids });
  effects.push(...m.effects);
  const notes = ["'git pull' = git fetch + git merge. Aquí se asume pull.rebase=false."];
  notes.push(...mergeNotes(m.kind, key, m.state));
  return ok(changed ? m.state : state, 'pull', out, { changed, effects, notes });
}

function cmdPush(state, { args, flags }) {
  const { repo } = state;
  const r = resolveRemote(state, 'push', args[0]);
  if (r.err) return r.err;
  const remote = r.remote;
  let branch = args[1];
  if (args.length === 0) {
    if (!repo.upstream[repo.head] && !flags.setUpstream) {
      return fail(state, 'push', 'NO_UPSTREAM', [
        `fatal: La rama actual ${repo.head} no tiene una rama upstream.`,
        'Para hacer push de la rama actual y establecer el remoto como upstream, usa', '',
        `    git push --set-upstream ${remote} ${repo.head}`,
      ], { hint: `Es la primera vez que publicas esta rama: git push -u ${remote} ${repo.head}`, notes: [] });
    }
    branch = repo.upstream[repo.head] ? repo.upstream[repo.head].split('/').slice(1).join('/') : repo.head;
  } else if (!branch) {
    branch = repo.head;
  }
  const local = repo.branches[branch];
  if (!local) {
    return fail(state, 'push', 'NO_COMMITS', [`error: src refspec ${branch} no concuerda con ninguno`, `error: falló el push de algunas referencias a '${repo.remotes[remote]}'`], {
      message: `error: src refspec ${branch} no concuerda con ninguno`,
      hint: branch === repo.head && !headCommit(state) ? 'No hay nada que publicar: haz primero un commit.' : `No existe la rama local '${branch}'.`,
    });
  }
  const server = state.server.branches[branch];
  const url = repo.remotes[remote];
  if (server && server !== local && !isAncestor(state, server, local)) {
    return fail(state, 'push', 'PUSH_REJECTED', [
      `To ${url}`,
      ` ! [rechazado]        ${branch} -> ${branch} (fetch first)`,
      `error: falló el push de algunas referencias a '${url}'`,
      'ayuda: Las actualizaciones fueron rechazadas porque el remoto contiene trabajo que',
      'ayuda: no tienes localmente. Esto normalmente es causado por otro repositorio',
      "ayuda: haciendo push a la misma ref. Integra los cambios remotos (p. ej. 'git pull ...')",
      'ayuda: antes de hacer push de nuevo.',
    ], { message: `error: falló el push de algunas referencias a '${url}'`, hint: `Alguien (Ana) subió commits antes que tú. Haz git pull para integrarlos y vuelve a hacer git push. Nunca fuerces el push sobre el trabajo de otra persona.` });
  }
  const key = `${remote}/${branch}`;
  const needUp = flags.setUpstream && repo.upstream[branch] !== key;
  if (server === local) {
    if (!needUp && repo.tracking[key] === local) return ok(state, 'push', ['Todo actualizado']);
    const s = structuredClone(state);
    s.repo.tracking[key] = local;
    if (flags.setUpstream) s.repo.upstream[branch] = key;
    return ok(s, 'push', ['Todo actualizado', ...(flags.setUpstream ? [`rama '${branch}' configurada para rastrear '${key}'.`] : [])], { changed: true });
  }
  const s = structuredClone(state);
  const known = reachable(s, server ? [server] : []);
  const ids = sortBySeq(s, [...reachable(s, [local])].filter((id) => !known.has(id)));
  s.server.branches[branch] = local;
  s.repo.tracking[key] = local;
  const out = [`To ${url}`, server ? `   ${server}..${local}  ${branch} -> ${branch}` : ` * [new branch]      ${branch} -> ${branch}`];
  const notes = [];
  if (flags.setUpstream) {
    s.repo.upstream[branch] = key;
    out.push(`rama '${branch}' configurada para rastrear '${key}'.`);
    notes.push(`Con -u Git recuerda que '${branch}' sigue a '${key}': a partir de ahora basta con 'git push' y 'git pull'.`);
  }
  return ok(s, 'push', out, { changed: true, effects: [{ type: 'push', ids }], notes });
}

// --- log ---

function decorations(state, id) {
  const { repo } = state;
  const d = [];
  const cur = repo.head;
  if (repo.branches[cur] === id) d.push(`HEAD -> ${cur}`);
  for (const k of sortedKeys(repo.tracking)) if (repo.tracking[k] === id) d.push(k);
  for (const b of sortedKeys(repo.branches)) if (b !== cur && repo.branches[b] === id) d.push(b);
  return d.length ? ` (${d.join(', ')})` : '';
}

function cmdLog(state, { flags }) {
  const { repo } = state;
  const head = headCommit(state);
  if (!head && !flags.all) {
    return fail(state, 'log', 'NO_COMMITS', [`fatal: tu rama actual '${repo.head}' todavía no tiene commits`], { hint: 'Haz primero un commit.' });
  }
  const roots = flags.all ? [...Object.values(repo.branches), ...Object.values(repo.tracking)] : [head];
  const ids = [...reachable(state, roots)].sort((a, b) => state.objects[b].seq - state.objects[a].seq);
  const lines = [];
  for (const id of ids) {
    const c = state.objects[id];
    if (flags.oneline) lines.push(`${id}${decorations(state, id)} ${short(c.message)}`);
    else {
      lines.push(`commit ${id}${decorations(state, id)}`);
      if (c.parents.length > 1) lines.push(`Merge: ${c.parents.join(' ')}`);
      lines.push(`Author: ${c.author}`, '', `    ${short(c.message)}`, '');
    }
  }
  return ok(state, 'log', lines);
}

// --- auxiliares ---

function cmdEdit(state, { args }) {
  const p = args[0];
  if (!p) return fail(state, 'edit', 'MISSING_ARG', ['uso: edit <archivo>'], { hint: 'Ejemplo: edit app.js' });
  if (!(p in state.worktree)) return fail(state, 'edit', 'FILE_NOT_FOUND', [`edit: ${p}: no existe el archivo`], { hint: `Créalo antes con: touch ${p}` });
  const s = structuredClone(state);
  s.versions[p] = (s.versions[p] ?? 1) + 1;
  s.worktree[p] = `${p}@v${s.versions[p]}`;
  return ok(s, 'edit', [`Has editado ${p} (ahora es la versión v${s.versions[p]}).`], { changed: true });
}

function cmdTouch(state, { args }) {
  const p = args[0];
  if (!p) return fail(state, 'touch', 'MISSING_ARG', ['uso: touch <archivo>'], { hint: 'Ejemplo: touch notas.txt' });
  if (p in state.worktree) return ok(state, 'touch', []);
  const s = structuredClone(state);
  s.versions[p] = (s.versions[p] ?? 0) + 1;
  s.worktree[p] = `${p}@v${s.versions[p]}`;
  return ok(s, 'touch', [], { changed: true });
}

function cmdAnaPush(state, { args }) {
  const tip = state.server.branches.main;
  if (!tip) {
    return fail(state, 'ana-push', 'REMOTE_REF_NOT_FOUND', ['Ana no puede subir cambios: el servidor todavía no tiene la rama main.'], {
      hint: `Publica primero tu trabajo: git remote add origin ${REMOTE_URL} y git push -u origin main.`,
    });
  }
  const file = args[0] ?? 'app.js';
  const tree = state.objects[tip].tree;
  if (!(file in tree)) return fail(state, 'ana-push', 'FILE_NOT_FOUND', [`ana-push: ${file}: ese archivo no existe en el servidor`], { hint: 'Elige un archivo que ya esté publicado (app.js, cart.js, style.css).' });
  const s = structuredClone(state);
  s.versions[file] = (s.versions[file] ?? 1) + 1;
  const msg = `Ana actualiza ${file}`;
  const id = makeCommit(s, msg, [tip], { ...tree, [file]: `${file}@v${s.versions[file]}` }, TEAMMATE);
  s.server.branches.main = id;
  return ok(s, 'ana-push', [`Ana ha subido a origin/main el commit ${id}: ${msg}`, 'Tu repositorio local todavía no lo sabe: usa git fetch o git pull.'], {
    changed: true,
    effects: [{ type: 'remote-commit', id }],
  });
}

function cmdLs(state) {
  return ok(state, 'ls', sortedKeys(state.worktree));
}

export const HELP_LINES = [
  'Comandos de Git soportados:',
  '  git init | status | add | commit | branch | switch | checkout',
  '  git merge | stash | remote | fetch | pull | push | log',
  '',
  'Ayudantes del simulador (no son Git):',
  '  edit <archivo>      edita un archivo (nueva versión)',
  '  touch <archivo>     crea un archivo vacío',
  '  ls                  lista los archivos de la carpeta',
  '  ana-push [archivo]  tu compañera Ana sube un commit al servidor',
  '  clear               limpia la consola',
  '  help                muestra esta ayuda',
  '',
  'Atajos: flecha izquierda/derecha = paso anterior/siguiente (fuera del campo de texto).',
];

/**
 * Ejecuta un comando ya parseado sobre el estado. Puro: no muta `state`.
 * @param {object} state
 * @param {{program:string, sub:string|null, args:string[], flags:object}} cmd
 * @returns {object} Result (ver ARCHITECTURE §3.1)
 */
export function execute(state, cmd) {
  const { program, sub } = cmd;
  if (program === 'help') return ok(state, 'help', HELP_LINES);
  if (program === 'clear') return ok(state, 'clear', [], { ui: { clear: true } });
  if (program === 'ls') return cmdLs(state);
  if (program === 'edit') return cmdEdit(state, cmd);
  if (program === 'touch') return cmdTouch(state, cmd);
  if (program === 'ana-push') return cmdAnaPush(state, cmd);
  if (program !== 'git') return fail(state, null, 'NOT_GIT', [`${program}: orden no encontrada`]);
  if (sub === 'init') return cmdInit(state);
  if (!state.repo) {
    return fail(state, sub, 'NOT_A_REPO', ['fatal: no es un repositorio git (ni ninguno de los directorios superiores): .git'], {
      hint: "Primero crea el repositorio con 'git init'.",
    });
  }
  switch (sub) {
    case 'status': return cmdStatus(state);
    case 'add': return cmdAdd(state, cmd);
    case 'commit': return cmdCommit(state, cmd);
    case 'branch': return cmdBranch(state, cmd);
    case 'switch': return cmdSwitch(state, cmd, 'switch');
    case 'checkout': return cmdSwitch(state, cmd, 'checkout');
    case 'merge': return cmdMerge(state, cmd);
    case 'stash': return cmdStash(state, cmd);
    case 'remote': return cmdRemote(state, cmd);
    case 'fetch': return cmdFetch(state, cmd);
    case 'pull': return cmdPull(state, cmd);
    case 'push': return cmdPush(state, cmd);
    case 'log': return cmdLog(state, cmd);
    default: return fail(state, sub, 'UNKNOWN_COMMAND', [`git: '${sub}' no es un comando de git. Mira 'git --help'.`]);
  }
}
