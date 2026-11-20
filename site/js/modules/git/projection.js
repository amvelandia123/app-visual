// Proyección: estado del motor -> modelo de vista. Sin DOM. (ARCHITECTURE §7)
// Es el ÚNICO contrato que consume la interfaz.

import { getStatus, reachable, aheadBehind, stashFiles, CWD, REMOTE_URL } from './engine.js';

const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Construye un grafo (commits con carril y columna, refs, nº de carriles).
 * @param {object} objects almacén de commits
 * @param {{name:string, kind:string, target:string, current:boolean}[]} refs refs visibles
 * @param {string[]} laneOrder ids de punta, en el orden en que reparten carriles
 */
function buildGraph(state, refs, laneOrder, unborn) {
  const ids = [...reachable(state, refs.map((r) => r.target))];
  const objs = state.objects;
  const lane = new Map();
  let lanes = 0;
  for (const tip of laneOrder) {
    let mine = null;
    let id = tip;
    while (id && objs[id]) {
      if (!lane.has(id)) {
        if (mine === null) mine = lanes++;
        lane.set(id, mine);
      }
      id = objs[id].parents[0];
    }
  }
  for (const id of ids.sort((a, b) => objs[a].seq - objs[b].seq)) {
    if (!lane.has(id)) lane.set(id, lanes++);
  }
  const commits = ids.map((id, column) => ({
    id,
    message: objs[id].message,
    parents: [...objs[id].parents],
    author: objs[id].author,
    lane: lane.get(id),
    column,
  }));
  return { commits, refs, lanes, unborn };
}

/** Nombres de rama con `main` primero y el resto en orden alfabético. */
function orderedNames(obj) {
  const names = Object.keys(obj).sort(byName);
  return names.includes('main') ? ['main', ...names.filter((n) => n !== 'main')] : names;
}

function localGraph(state) {
  const { repo } = state;
  if (!repo) return { commits: [], refs: [], lanes: 0, unborn: null };
  const refs = [];
  for (const b of Object.keys(repo.branches).sort(byName)) {
    refs.push({ name: b, kind: 'branch', target: repo.branches[b], current: b === repo.head });
  }
  const headTip = repo.branches[repo.head];
  if (headTip) refs.push({ name: 'HEAD', kind: 'head', target: headTip, current: true });
  for (const t of Object.keys(repo.tracking).sort(byName)) {
    refs.push({ name: t, kind: 'tracking', target: repo.tracking[t], current: false });
  }
  const order = [...orderedNames(repo.branches).map((b) => repo.branches[b]), ...Object.keys(repo.tracking).sort(byName).map((t) => repo.tracking[t])];
  return buildGraph(state, refs, order, headTip ? null : repo.head);
}

function remoteGraph(state) {
  const { branches } = state.server;
  const refs = Object.keys(branches).sort(byName).map((b) => ({ name: b, kind: 'branch', target: branches[b], current: false }));
  return buildGraph(state, refs, orderedNames(branches).map((b) => branches[b]), null);
}

/**
 * Proyecta el estado del motor al modelo de vista que dibuja la interfaz.
 * @param {object} state
 * @returns {object} Projection
 */
export function project(state) {
  const { repo } = state;
  const files = Object.keys(state.worktree).sort(byName);
  const working = [];
  const clean = [];
  const staging = [];
  if (!repo) {
    for (const path of files) working.push({ path, status: 'untracked' });
  } else {
    for (const path of files) {
      if (!(path in repo.index)) working.push({ path, status: 'untracked' });
      else if (state.worktree[path] !== repo.index[path]) working.push({ path, status: 'modified' });
      else clean.push(path);
    }
    for (const f of getStatus(state).staged) {
      if (f.kind === 'new' || f.kind === 'modified') staging.push({ path: f.path, status: f.kind });
    }
  }
  const remotes = repo ? Object.keys(repo.remotes).sort(byName) : [];
  const ab = repo ? aheadBehind(state, repo.head) : null;
  return {
    initialized: !!repo,
    prompt: repo ? `(${repo.head}) $` : `${CWD} $`,
    branch: repo ? repo.head : null,
    working,
    clean,
    staging,
    stash: repo ? repo.stash.map((e, i) => ({ ref: `stash@{${i}}`, message: e.message, files: stashFiles(state, e) })) : [],
    local: localGraph(state),
    remote: {
      connected: remotes.length > 0,
      name: remotes.length ? remotes[0] : null,
      url: state.server?.url ?? REMOTE_URL,
      graph: remoteGraph(state),
    },
    sync: ab ? { branch: repo.head, upstream: ab.upstream, ahead: ab.ahead, behind: ab.behind } : null,
  };
}
