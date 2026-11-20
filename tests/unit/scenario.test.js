// Tests del escenario guiado y de los datos del módulo (ARCHITECTURE §5.13, §9).
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import git from '../../site/js/modules/git/index.js';
import { createController } from '../../site/js/core/controller.js';
import { getStatus, aheadBehind } from '../../site/js/modules/git/engine.js';

const { data } = git;

const ERROR_CODES = [
  'NOT_A_REPO', 'BAD_SYNTAX', 'NOT_GIT', 'UNKNOWN_COMMAND', 'UNSUPPORTED', 'INVALID_OPTION', 'MISSING_ARG',
  'PATHSPEC', 'NOTHING_SPECIFIED', 'NEEDS_MESSAGE', 'NOTHING_TO_COMMIT', 'NOTHING_STAGED', 'NO_COMMITS',
  'BRANCH_EXISTS', 'INVALID_BRANCH_NAME', 'BRANCH_NOT_FOUND', 'BRANCH_IN_USE', 'BRANCH_NOT_MERGED',
  'INVALID_REF', 'LOCAL_CHANGES_OVERWRITTEN', 'UNTRACKED_OVERWRITTEN', 'MERGE_CONFLICT', 'NO_STASH',
  'STASH_CONFLICT', 'NO_REMOTE', 'REMOTE_EXISTS', 'NO_UPSTREAM', 'REMOTE_REF_NOT_FOUND', 'PUSH_REJECTED',
  'FILE_NOT_FOUND', 'FILE_EXISTS',
];
const LABELS = ['NEW REPO', 'WHAT CHANGED', 'STAGE FILES', 'SAVE SNAPSHOT', 'NEW LINE', 'MOVE HEAD', 'JOIN LINES', 'SHELVE WORK', 'DOWNLOAD', 'UPLOAD'];
const IDS = ['init', 'status', 'add', 'commit', 'branch', 'switch', 'merge', 'stash', 'pull', 'push'];

/** Estados tras cada paso 1..10 (índice 0 = paso 1), recorriendo el guion con el controlador. */
function statesPerStep() {
  const c = createController(git);
  const out = [];
  for (let i = 0; i < 10; i++) {
    c.next();
    out.push(c.getSnapshot().state);
  }
  return out;
}

describe('data.meta (§4.5)', () => {
  test('metadatos del módulo', () => {
    assert.deepEqual(data.meta, {
      cwd: '~/tienda', absPath: '/home/andres/tienda', remoteUrl: 'https://github.com/equipo/tienda.git',
      user: 'Andrés', teammate: 'Ana', defaultBranch: 'main',
    });
  });
});

describe('data.commands (§9)', () => {
  test('son 10, en orden, con ids y números 01..10', () => {
    assert.equal(data.commands.length, 10);
    assert.deepEqual(data.commands.map((c) => c.id), IDS);
    assert.deepEqual(data.commands.map((c) => c.number), ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10']);
  });

  test('las etiquetas son NEW REPO … UPLOAD, en orden', () => {
    assert.deepEqual(data.commands.map((c) => c.label), LABELS);
  });

  test('los nombres son «git <id>»', () => {
    for (const c of data.commands) assert.equal(c.name, `git ${c.id}`);
  });

  test('cada comando tiene syntax, what, why y mistake no vacíos', () => {
    for (const c of data.commands) {
      for (const k of ['syntax', 'what', 'why', 'mistake']) {
        assert.equal(typeof c[k], 'string', `${c.id}.${k}`);
        assert.ok(c[k].trim().length > 0, `${c.id}.${k} vacío`);
      }
    }
  });

  test('simplification, si existe, es un texto no vacío', () => {
    for (const c of data.commands) {
      if (c.simplification !== undefined) assert.ok(String(c.simplification).trim().length > 0, c.id);
    }
  });

  test('extraCommands cubre los ayudantes y comandos extra con what y why', () => {
    for (const id of ['log', 'remote', 'fetch', 'checkout', 'edit', 'touch', 'ana-push', 'ls', 'help', 'clear']) {
      const e = data.extraCommands[id];
      assert.ok(e, `falta extraCommands.${id}`);
      assert.ok(e.name && e.what && e.why, id);
    }
  });
});

describe('data.errors (§5.13)', () => {
  test('cada código tiene una entrada {title, explain} no vacía', () => {
    for (const code of ERROR_CODES) {
      const e = data.errors[code];
      assert.ok(e, `falta data.errors.${code}`);
      assert.ok(typeof e.title === 'string' && e.title.trim(), `${code}.title`);
      assert.ok(typeof e.explain === 'string' && e.explain.trim(), `${code}.explain`);
    }
  });

  test('no hay códigos de error fuera del contrato', () => {
    for (const code of Object.keys(data.errors)) assert.ok(ERROR_CODES.includes(code), `código no contractual: ${code}`);
  });
});

describe('data.scenario (§9)', () => {
  const steps = data.scenario.steps;

  test('tiene título, introducción y 10 pasos con los ids del contrato', () => {
    assert.ok(data.scenario.title);
    assert.ok(Array.isArray(data.scenario.intro) && data.scenario.intro.length > 0);
    assert.deepEqual(steps.map((s) => s.id), IDS);
  });

  test('cada paso tiene command, label, before[] y narration', () => {
    steps.forEach((s, i) => {
      assert.equal(typeof s.command, 'string');
      assert.equal(s.label, LABELS[i]);
      assert.ok(Array.isArray(s.before));
      assert.ok(s.narration.trim().length > 0);
      for (const b of s.before) assert.equal(typeof b.command, 'string');
    });
  });

  test('comandos principales y previos tal y como define la tabla de §9', () => {
    assert.deepEqual(steps.map((s) => s.command), [
      'git init', 'git status', 'git add .', 'git commit -m "Primera versión de la tienda"', 'git branch feature/carrito',
      'git switch feature/carrito', 'git merge feature/carrito', 'git stash', 'git pull', 'git push',
    ]);
    assert.deepEqual(steps[6].before.map((b) => b.command), [
      'edit cart.js', 'git commit -am "Calcula el total del carrito"', 'git switch main', 'edit app.js', 'git commit -am "Mejora la portada"',
    ]);
    assert.deepEqual(steps[7].before.map((b) => b.command), ['edit style.css']);
    assert.deepEqual(steps[8].before.map((b) => b.command), [
      'git remote add origin https://github.com/equipo/tienda.git', 'git push -u origin main', 'ana-push cart.js',
    ]);
    assert.deepEqual(steps[9].before.map((b) => b.command), ['git stash pop', 'git commit -am "Rediseña los botones"']);
    for (const i of [0, 1, 2, 3, 4, 5]) assert.deepEqual(steps[i].before, []);
  });

  test('los 10 pasos (y sus comandos previos) se ejecutan bien con el motor', () => {
    let s = git.createInitialState();
    for (const st of steps) {
      for (const cmd of [...st.before.map((b) => b.command), st.command]) {
        const r = git.run(s, cmd);
        assert.equal(r.ok, true, `${st.id}: '${cmd}' falló: ${r.error?.message}`);
        s = r.state;
      }
    }
  });

  test('los 10 pasos con el controlador son ok y el commandId coincide con el paso', () => {
    const c = createController(git);
    for (let i = 0; i < 10; i++) {
      const t = c.next();
      assert.ok(t.length >= 1);
      const snap = c.getSnapshot();
      assert.equal(snap.step, i + 1);
      assert.equal(snap.lastResult.ok, true);
      assert.equal(snap.lastCommandId, IDS[i]);
      assert.equal(snap.lastStep.id, IDS[i]);
      assert.equal(t.length, steps[i].before.length + 1);
      assert.ok(t.every((x) => x.result.ok));
    }
  });
});

describe('estado esperado tras cada paso (§9)', () => {
  const st = statesPerStep();

  test('01 init: repo vacío en main', () => {
    assert.ok(st[0].repo);
    assert.equal(st[0].repo.head, 'main');
    assert.deepEqual(st[0].repo.branches, {});
  });

  test('02 status: 3 archivos sin seguimiento y estado sin cambios respecto al paso 1', () => {
    assert.deepEqual(getStatus(st[1]).untracked, ['app.js', 'cart.js', 'style.css']);
    assert.deepEqual(st[1], st[0]);
  });

  test('03 add: tres archivos en staging', () => {
    assert.deepEqual(getStatus(st[2]).staged.map((f) => f.path), ['app.js', 'cart.js', 'style.css']);
    assert.ok(getStatus(st[2]).staged.every((f) => f.kind === 'new'));
    assert.deepEqual(git.project(st[2]).staging.length, 3);
  });

  test('04 commit: un commit, rama main apuntándole y staging vacío', () => {
    assert.equal(Object.keys(st[3].objects).length, 1);
    const id = st[3].repo.branches.main;
    assert.equal(st[3].objects[id].message, 'Primera versión de la tienda');
    assert.deepEqual(st[3].objects[id].parents, []);
    assert.deepEqual(getStatus(st[3]), { staged: [], unstaged: [], untracked: [] });
  });

  test('05 branch: feature/carrito apunta a C1 y HEAD sigue en main', () => {
    assert.equal(st[4].repo.branches['feature/carrito'], st[4].repo.branches.main);
    assert.equal(st[4].repo.head, 'main');
  });

  test('06 switch: HEAD en feature/carrito', () => {
    assert.equal(st[5].repo.head, 'feature/carrito');
  });

  test('07 merge: commit de merge con 2 padres (las líneas se unen)', () => {
    const s = st[6];
    assert.equal(s.repo.head, 'main');
    const head = s.objects[s.repo.branches.main];
    assert.equal(head.parents.length, 2);
    assert.equal(head.message, "Merge branch 'feature/carrito'");
    assert.ok(head.parents.includes(s.repo.branches['feature/carrito']));
    assert.equal(Object.keys(s.objects).length, 4, 'C1 + carrito + portada + merge');
    assert.deepEqual(getStatus(s), { staged: [], unstaged: [], untracked: [] });
    const g = git.project(s).local;
    assert.equal(g.lanes, 2);
  });

  test('08 stash: una entrada y working limpio', () => {
    const s = st[7];
    assert.equal(s.repo.stash.length, 1);
    assert.deepEqual(getStatus(s), { staged: [], unstaged: [], untracked: [] });
    const p = git.project(s);
    assert.deepEqual(p.working, []);
    assert.deepEqual(p.stash[0].files, ['style.css']);
  });

  test('09 pull: fast-forward al commit de Ana (sin commit de merge nuevo)', () => {
    const s = st[8];
    const idAna = s.server.branches.main;
    assert.equal(s.objects[idAna].author, 'Ana');
    assert.equal(s.repo.branches.main, idAna);
    assert.equal(s.repo.tracking['origin/main'], idAna);
    assert.equal(s.objects[idAna].parents.length, 1);
    assert.equal(s.objects[idAna].parents[0], st[7].repo.branches.main, 'main avanza desde donde estaba (fast-forward)');
    assert.equal(s.repo.stash.length, 1, 'el stash sigue guardado');
    assert.equal(s.worktree['cart.js'], 'cart.js@v3');
    assert.deepEqual(aheadBehind(s, 'main'), { upstream: 'origin/main', ahead: 0, behind: 0 });
  });

  test('10 push: main === server.main === origin/main, ahead 0 y stash vacío', () => {
    const s = st[9];
    assert.equal(s.repo.branches.main, s.server.branches.main);
    assert.equal(s.repo.branches.main, s.repo.tracking['origin/main']);
    assert.deepEqual(aheadBehind(s, 'main'), { upstream: 'origin/main', ahead: 0, behind: 0 });
    assert.deepEqual(s.repo.stash, []);
    assert.equal(s.objects[s.repo.branches.main].message, 'Rediseña los botones');
    assert.deepEqual(getStatus(s), { staged: [], unstaged: [], untracked: [] });
    assert.deepEqual(git.project(s).sync, { branch: 'main', upstream: 'origin/main', ahead: 0, behind: 0 });
  });
});

describe('determinismo del escenario', () => {
  test('dos ejecuciones producen estados idénticos paso a paso', () => {
    assert.deepEqual(statesPerStep(), statesPerStep());
  });

  test('los ids de commit del escenario son estables entre ejecuciones', () => {
    const a = statesPerStep().at(-1);
    const b = statesPerStep().at(-1);
    assert.deepEqual(Object.keys(a.objects), Object.keys(b.objects));
    assert.equal(a.repo.branches.main, b.repo.branches.main);
  });
});
