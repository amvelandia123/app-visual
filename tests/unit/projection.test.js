// Tests unitarios de la proyección estado → modelo de vista (ARCHITECTURE §7).
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { git, deepFreeze, fresh, freshRepo, repoWithRemote, runAll, headId } from '../helpers/git.js';

const project = (s) => git.project(deepFreeze(s));
const lane = (g, id) => g.commits.find((c) => c.id === id).lane;
const ref = (g, name, kind) => g.refs.find((r) => r.name === name && (!kind || r.kind === kind));

describe('antes de git init (§7)', () => {
  const p = project(fresh());

  test('no inicializado, prompt de carpeta y sin rama', () => {
    assert.equal(p.initialized, false);
    assert.equal(p.prompt, '~/tienda $');
    assert.equal(p.branch, null);
  });

  test('todos los archivos están en working como untracked, ordenados', () => {
    assert.deepEqual(p.working, [
      { path: 'app.js', status: 'untracked' },
      { path: 'cart.js', status: 'untracked' },
      { path: 'style.css', status: 'untracked' },
    ]);
    assert.deepEqual(p.clean, []);
    assert.deepEqual(p.staging, []);
    assert.deepEqual(p.stash, []);
  });

  test('grafos vacíos, remoto desconectado y sin sync', () => {
    assert.deepEqual(p.local, { commits: [], refs: [], lanes: 0, unborn: null });
    assert.equal(p.remote.connected, false);
    assert.equal(p.remote.name, null);
    assert.equal(p.remote.url, 'https://github.com/equipo/tienda.git');
    assert.deepEqual(p.remote.graph, { commits: [], refs: [], lanes: 0, unborn: null });
    assert.equal(p.sync, null);
  });
});

describe('repo recién inicializado (unborn)', () => {
  const p = project(runAll(fresh(), ['git init']));

  test('prompt (main) y rama «unborn» sin commits ni refs', () => {
    assert.equal(p.initialized, true);
    assert.equal(p.prompt, '(main) $');
    assert.equal(p.branch, 'main');
    assert.equal(p.local.unborn, 'main');
    assert.deepEqual(p.local.commits, []);
    assert.deepEqual(p.local.refs, []);
    assert.equal(p.local.lanes, 0);
  });

  test('los archivos siguen sin seguimiento', () => {
    assert.deepEqual(p.working.map((f) => f.status), ['untracked', 'untracked', 'untracked']);
  });

  test('tras el primer commit, unborn pasa a null', () => {
    assert.equal(project(freshRepo()).local.unborn, null);
  });

  test('switch -c en un repo vacío cambia el nombre «unborn»', () => {
    assert.equal(project(runAll(fresh(), ['git init', 'git switch -c dev'])).local.unborn, 'dev');
  });
});

describe('zonas working / staging / clean', () => {
  test('tras add . todo pasa a staging como new y working queda vacío', () => {
    const p = project(runAll(fresh(), ['git init', 'git add .']));
    assert.deepEqual(p.staging.map((f) => [f.path, f.status]), [['app.js', 'new'], ['cart.js', 'new'], ['style.css', 'new']]);
    assert.deepEqual(p.working, []);
    assert.deepEqual(p.clean, ['app.js', 'cart.js', 'style.css'], 'los preparados y sin cambios posteriores cuentan como limpios en working');
  });

  test('tras el commit: staging vacío y los 3 archivos limpios', () => {
    const p = project(freshRepo());
    assert.deepEqual(p.staging, []);
    assert.deepEqual(p.working, []);
    assert.deepEqual(p.clean, ['app.js', 'cart.js', 'style.css']);
  });

  test('archivo modificado: working modified y el resto clean', () => {
    const p = project(runAll(freshRepo(), ['edit cart.js']));
    assert.deepEqual(p.working, [{ path: 'cart.js', status: 'modified' }]);
    assert.deepEqual(p.clean, ['app.js', 'style.css']);
  });

  test('archivo modificado y preparado: staging modified', () => {
    const p = project(runAll(freshRepo(), ['edit cart.js', 'git add cart.js']));
    assert.deepEqual(p.staging, [{ path: 'cart.js', status: 'modified' }]);
    assert.deepEqual(p.working, []);
  });

  test('un archivo puede estar a la vez en staging y en working', () => {
    const p = project(runAll(freshRepo(), ['edit app.js', 'git add app.js', 'edit app.js']));
    assert.deepEqual(p.staging, [{ path: 'app.js', status: 'modified' }]);
    assert.deepEqual(p.working, [{ path: 'app.js', status: 'modified' }]);
    assert.equal(p.clean.includes('app.js'), false);
  });

  test('archivo nuevo sin seguimiento: working untracked; ni clean ni staging', () => {
    const p = project(runAll(freshRepo(), ['touch nuevo.js']));
    assert.deepEqual(p.working, [{ path: 'nuevo.js', status: 'untracked' }]);
    assert.equal(p.clean.includes('nuevo.js'), false);
    assert.deepEqual(p.staging, []);
  });

  test('working está en orden alfabético', () => {
    const p = project(runAll(freshRepo(), ['touch b.js', 'touch a.js', 'edit style.css']));
    assert.deepEqual(p.working.map((f) => f.path), ['a.js', 'b.js', 'style.css']);
  });

  test('«clean» es la lista de rutas sin cambios (atenuados), en orden', () => {
    const p = project(runAll(freshRepo(), ['edit app.js', 'touch zzz.js']));
    assert.deepEqual(p.clean, ['cart.js', 'style.css']);
  });

  test('el prompt y la rama siguen a HEAD', () => {
    const p = project(runAll(freshRepo(), ['git switch -c dev']));
    assert.equal(p.prompt, '(dev) $');
    assert.equal(p.branch, 'dev');
  });
});

describe('stash', () => {
  test('la entrada lleva ref, mensaje y archivos', () => {
    const s = runAll(freshRepo(), ['edit style.css', 'edit app.js', 'git stash']);
    const p = project(s);
    assert.equal(p.stash.length, 1);
    assert.equal(p.stash[0].ref, 'stash@{0}');
    assert.match(p.stash[0].message, /^WIP on main: [0-9a-f]{7} Primera versión$/);
    assert.deepEqual([...p.stash[0].files].sort(), ['app.js', 'style.css']);
    assert.deepEqual(p.working, []);
    assert.deepEqual(p.clean, ['app.js', 'cart.js', 'style.css']);
  });

  test('stash@{0} es la más reciente', () => {
    const s = runAll(freshRepo(), ['edit style.css', 'git stash push -m uno', 'edit app.js', 'git stash push -m dos']);
    const p = project(s);
    assert.deepEqual(p.stash.map((e) => e.ref), ['stash@{0}', 'stash@{1}']);
    assert.match(p.stash[0].message, /dos/);
    assert.deepEqual(p.stash[0].files, ['app.js']);
    assert.deepEqual(p.stash[1].files, ['style.css']);
  });

  test('stash -u incluye los archivos sin seguimiento', () => {
    const p = project(runAll(freshRepo(), ['touch nuevo.js', 'git stash -u']));
    assert.deepEqual(p.stash[0].files, ['nuevo.js']);
  });

  test('pop vacía la zona stash', () => {
    const p = project(runAll(freshRepo(), ['edit style.css', 'git stash', 'git stash pop']));
    assert.deepEqual(p.stash, []);
    assert.deepEqual(p.working, [{ path: 'style.css', status: 'modified' }]);
  });
});

describe('grafo local: columnas y carriles (§7)', () => {
  /** Escenario: main y feature/carrito divergen y se fusionan. */
  const merged = runAll(freshRepo(), [
    'git branch feature/carrito', 'git switch feature/carrito', 'edit cart.js', 'git commit -am "Carrito"',
    'git switch main', 'edit app.js', 'git commit -am "Portada"', 'git merge feature/carrito',
  ]);

  test('la columna es la posición por seq ascendente (0..n-1)', () => {
    const g = project(merged).local;
    assert.deepEqual(g.commits.map((c) => c.column), [0, 1, 2, 3]);
    const seqs = g.commits.map((c) => merged.objects[c.id].seq);
    assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b));
  });

  test('tras el merge, main va en el carril 0 y la feature en el carril 1', () => {
    const g = project(merged).local;
    assert.equal(g.lanes, 2);
    const main = merged.repo.branches.main;
    const feat = merged.repo.branches['feature/carrito'];
    const [mergeParentMain, mergeParentFeat] = merged.objects[main].parents;
    assert.equal(lane(g, main), 0);
    assert.equal(lane(g, mergeParentMain), 0);
    assert.equal(lane(g, feat), 1);
    assert.equal(mergeParentFeat, feat);
    assert.equal(lane(g, merged.objects[feat].parents[0]), 0, 'el commit raíz compartido va en el carril 0');
  });

  test('el commit de merge conserva sus 2 padres en la proyección', () => {
    const g = project(merged).local;
    const m = g.commits.find((c) => c.id === merged.repo.branches.main);
    assert.equal(m.parents.length, 2);
    assert.equal(m.author, 'Andrés');
    assert.equal(m.message, "Merge branch 'feature/carrito'");
  });

  test('un solo commit: 1 carril y columna 0', () => {
    const g = project(freshRepo()).local;
    assert.equal(g.lanes, 1);
    assert.deepEqual(g.commits.map((c) => [c.lane, c.column]), [[0, 0]]);
  });

  test('antes del merge la rama feature ocupa el carril 1', () => {
    const s = runAll(freshRepo(), ['git switch -c feature/x', 'edit cart.js', 'git commit -am "x"', 'git switch main', 'edit app.js', 'git commit -am "y"']);
    const g = project(s).local;
    assert.equal(lane(g, s.repo.branches['feature/x']), 1);
    assert.equal(lane(g, s.repo.branches.main), 0);
  });

  test('tras un fast-forward el commit pasa al carril 0 (historia lineal)', () => {
    const antes = runAll(freshRepo(), ['git switch -c x', 'edit cart.js', 'git commit -am "x"', 'git switch main']);
    const idX = antes.repo.branches.x;
    assert.equal(lane(project(antes).local, idX), 1, 'antes del ff está en otro carril');
    const despues = runAll(antes, ['git merge x']);
    const g = project(despues).local;
    assert.equal(g.lanes, 1);
    assert.equal(lane(g, idX), 0);
    assert.deepEqual(g.commits.map((c) => c.lane), [0, 0]);
  });

  test('ramas locales distintas de main se ordenan alfabéticamente para repartir carriles', () => {
    const s = runAll(freshRepo(), ['git switch -c zeta', 'edit app.js', 'git commit -am "z"', 'git switch main', 'git switch -c alfa', 'edit cart.js', 'git commit -am "a"', 'git switch main']);
    const g = project(s).local;
    assert.equal(lane(g, s.repo.branches.alfa), 1);
    assert.equal(lane(g, s.repo.branches.zeta), 2);
  });

  test('determinismo: mismo estado, misma proyección (deepEqual)', () => {
    assert.deepEqual(project(merged), project(structuredClone(merged)));
  });

  test('project no muta el estado (congelado) y es serializable', () => {
    const p = project(merged);
    assert.deepEqual(JSON.parse(JSON.stringify(p)), p);
  });
});

describe('refs (§7)', () => {
  test('HEAD, ramas y tracking con target y current', () => {
    const s = repoWithRemote();
    const id = headId(s);
    const g = project(s).local;
    assert.deepEqual(ref(g, 'main', 'branch'), { name: 'main', kind: 'branch', target: id, current: true });
    assert.deepEqual(ref(g, 'HEAD', 'head'), { name: 'HEAD', kind: 'head', target: id, current: true });
    assert.deepEqual(ref(g, 'origin/main', 'tracking'), { name: 'origin/main', kind: 'tracking', target: id, current: false });
  });

  test('solo la rama actual tiene current:true', () => {
    const s = runAll(freshRepo(), ['git branch otra']);
    const g = project(s).local;
    assert.equal(ref(g, 'main', 'branch').current, true);
    assert.equal(ref(g, 'otra', 'branch').current, false);
  });

  test('HEAD sigue a la rama actual al cambiar', () => {
    const s = runAll(freshRepo(), ['git switch -c x', 'edit cart.js', 'git commit -am "x"']);
    const g = project(s).local;
    assert.equal(ref(g, 'HEAD').target, s.repo.branches.x);
    assert.equal(ref(g, 'x').current, true);
    assert.equal(ref(g, 'main').current, false);
  });

  test('con unborn no hay ref HEAD', () => {
    assert.equal(project(runAll(fresh(), ['git init'])).local.refs.some((r) => r.kind === 'head'), false);
  });

  test('las refs remotas son las ramas del servidor sin prefijo', () => {
    const g = project(repoWithRemote()).remote.graph;
    assert.deepEqual(g.refs, [{ name: 'main', kind: 'branch', target: headId(repoWithRemote()), current: false }]);
    assert.equal(g.unborn, null);
  });

  test('las ramas pueden crearse sin tocar HEAD: cada una apunta al mismo commit', () => {
    const s = runAll(freshRepo(), ['git branch a', 'git branch b']);
    const g = project(s).local;
    const targets = g.refs.map((r) => r.target);
    assert.equal(new Set(targets).size, 1);
    assert.equal(g.refs.filter((r) => r.kind === 'branch').length, 3);
  });
});

describe('remoto y sync', () => {
  test('tras remote add: conectado con nombre origin, aún sin commits remotos', () => {
    const p = project(runAll(freshRepo(), ['git remote add origin https://github.com/equipo/tienda.git']));
    assert.equal(p.remote.connected, true);
    assert.equal(p.remote.name, 'origin');
    assert.deepEqual(p.remote.graph.commits, []);
    assert.equal(p.sync, null, 'sin upstream no hay indicador de sync');
  });

  test('tras push -u: el grafo remoto contiene el commit y sync 0/0', () => {
    const s = repoWithRemote();
    const p = project(s);
    assert.deepEqual(p.remote.graph.commits.map((c) => c.id), [headId(s)]);
    assert.deepEqual(p.sync, { branch: 'main', upstream: 'origin/main', ahead: 0, behind: 0 });
  });

  test('el commit de Ana está en el remoto pero NO en el grafo local hasta fetch', () => {
    const s = runAll(repoWithRemote(), ['ana-push cart.js']);
    const idAna = s.server.branches.main;
    const p = project(s);
    assert.ok(p.remote.graph.commits.some((c) => c.id === idAna));
    assert.equal(p.local.commits.some((c) => c.id === idAna), false);
    assert.deepEqual(p.sync, { branch: 'main', upstream: 'origin/main', ahead: 0, behind: 0 });
    const tras = project(runAll(s, ['git fetch']));
    assert.ok(tras.local.commits.some((c) => c.id === idAna), 'tras fetch el commit ya se ve en local');
    assert.equal(ref(tras.local, 'origin/main').target, idAna);
    assert.equal(ref(tras.local, 'main', 'branch').target, s.repo.branches.main, 'la rama local no se mueve');
  });

  test('sync: behind tras fetch, ahead tras commit local', () => {
    const behind = project(runAll(repoWithRemote(), ['ana-push', 'git fetch']));
    assert.deepEqual(behind.sync, { branch: 'main', upstream: 'origin/main', ahead: 0, behind: 1 });
    const ahead = project(runAll(repoWithRemote(), ['edit app.js', 'git commit -am "x"']));
    assert.deepEqual(ahead.sync, { branch: 'main', upstream: 'origin/main', ahead: 1, behind: 0 });
    const both = project(runAll(repoWithRemote(), ['ana-push', 'edit style.css', 'git commit -am "x"', 'git fetch']));
    assert.deepEqual(both.sync, { branch: 'main', upstream: 'origin/main', ahead: 1, behind: 1 });
  });

  test('tras pull (fast-forward) vuelve a 0/0 y el commit de Ana está en local', () => {
    const s = runAll(repoWithRemote(), ['ana-push', 'git pull']);
    const p = project(s);
    assert.deepEqual(p.sync, { branch: 'main', upstream: 'origin/main', ahead: 0, behind: 0 });
    assert.deepEqual(p.local.commits.map((c) => c.id), p.remote.graph.commits.map((c) => c.id));
  });

  test('la URL del remoto es la del servidor', () => {
    assert.equal(project(repoWithRemote()).remote.url, 'https://github.com/equipo/tienda.git');
  });

  test('cada commit del grafo remoto tiene carril y columna', () => {
    const g = project(runAll(repoWithRemote(), ['ana-push'])).remote.graph;
    assert.deepEqual(g.commits.map((c) => c.column), [0, 1]);
    assert.ok(g.commits.every((c) => Number.isInteger(c.lane)));
    assert.equal(g.lanes, 1);
  });
});
