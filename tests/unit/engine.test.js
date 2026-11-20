// Tests unitarios del motor de Git (ARCHITECTURE §4 y §5). Todos los estados de entrada van congelados.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  git, deepFreeze, fresh, freshRepo, repoWithRemote, run, runAll, assertFails, assertOk, headId,
} from '../helpers/git.js';
import { getStatus, aheadBehind, isAncestor, mergeBase, headTree, headCommit } from '../../site/js/modules/git/engine.js';

const URL = 'https://github.com/equipo/tienda.git';
const text = (r) => r.output.join('\n');

/** Dos ramas divergentes en ficheros distintos: main (app.js) y feat (cart.js), estando en main. */
function divergent() {
  return runAll(freshRepo(), [
    'git switch -c feat', 'edit cart.js', 'git commit -am "Carrito"',
    'git switch main', 'edit app.js', 'git commit -am "Portada"',
  ]);
}

describe('estado inicial e inmutabilidad', () => {
  test('el estado inicial tiene 3 archivos @v1, sin repo y servidor vacío (§4.3)', () => {
    const s = git.createInitialState();
    assert.equal(s.cwd, '~/tienda');
    assert.equal(s.seq, 0);
    assert.deepEqual(s.worktree, { 'app.js': 'app.js@v1', 'cart.js': 'cart.js@v1', 'style.css': 'style.css@v1' });
    assert.equal(s.repo, null);
    assert.deepEqual(s.server.branches, {});
    assert.deepEqual(s.objects, {});
  });

  test('createInitialState devuelve un objeto nuevo cada vez', () => {
    assert.notEqual(git.createInitialState(), git.createInitialState());
  });

  test('el estado es serializable con JSON', () => {
    const s = repoWithRemote();
    assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
  });

  test('ningún comando muta el estado de entrada congelado (secuencia completa)', () => {
    // Si el motor mutase algo, lanzaría TypeError en modo estricto (módulos ES).
    const cmds = [
      'git init', 'git status', 'git add .', 'git commit -m "a"', 'git branch f', 'git switch f', 'edit cart.js',
      'git commit -am "b"', 'git switch main', 'edit app.js', 'git commit -am "c"', 'git merge f', 'edit style.css',
      'git stash', 'git stash list', 'git stash apply', 'git stash drop', 'git stash', 'git stash pop', 'git remote add origin ' + URL,
      'git remote -v', 'git push -u origin main', 'ana-push cart.js', 'git fetch', 'git pull', 'git log --oneline',
      'touch x.js', 'ls', 'help', 'clear', 'git branch -d f',
    ];
    assert.doesNotThrow(() => runAll(fresh(), cmds));
  });

  test('los fallos no lanzan excepciones con estado congelado', () => {
    const s = deepFreeze(fresh());
    for (const c of ['git status', 'git add x', 'git commit -m x', 'git foo', 'ls -', 'git commit -m "x']) {
      assert.doesNotThrow(() => run(s, c));
    }
  });
});

describe('determinismo', () => {
  test('la misma secuencia produce los mismos ids y el mismo estado', () => {
    const cmds = ['git init', 'git add .', 'git commit -m "uno"', 'edit app.js', 'git commit -am "dos"'];
    const a = runAll(fresh(), cmds);
    const b = runAll(fresh(), cmds);
    assert.deepEqual(a, b);
    assert.deepEqual(Object.keys(a.objects), Object.keys(b.objects));
  });

  test('los ids son 7 caracteres hexadecimales y distintos entre commits', () => {
    const s = runAll(freshRepo(), ['edit app.js', 'git commit -am "dos"']);
    const ids = Object.keys(s.objects);
    assert.equal(ids.length, 2);
    for (const id of ids) assert.match(id, /^[0-9a-f]{7}$/);
    assert.notEqual(ids[0], ids[1]);
  });

  test('el mensaje cambia el id del commit', () => {
    const a = runAll(fresh(), ['git init', 'git add .', 'git commit -m "uno"']);
    const b = runAll(fresh(), ['git init', 'git add .', 'git commit -m "otro"']);
    assert.notEqual(headId(a), headId(b));
  });
});

describe('git init (§5.1)', () => {
  test('crea el repo con HEAD en main e índice vacío', () => {
    const r = assertOk(fresh(), 'git init');
    assert.equal(r.changed, true);
    assert.equal(r.commandId, 'init');
    assert.equal(r.state.repo.head, 'main');
    assert.deepEqual(r.state.repo.index, {});
    assert.deepEqual(r.state.repo.branches, {});
    assert.equal(text(r), 'Inicializado repositorio Git vacío en /home/andres/tienda/.git/');
  });

  test('repetir init reinicializa sin cambios', () => {
    const s = runAll(fresh(), ['git init']);
    const r = assertOk(s, 'git init');
    assert.equal(r.changed, false);
    assert.equal(r.state, s);
    assert.match(text(r), /^Reinicializado el repositorio Git existente en \/home\/andres\/tienda\/\.git\/$/);
  });

  test('no toca los archivos del worktree', () => {
    const r = assertOk(fresh(), 'git init');
    assert.deepEqual(r.state.worktree, fresh().worktree);
  });
});

describe('NOT_A_REPO (§5)', () => {
  for (const c of ['git status', 'git add .', 'git commit -m x', 'git branch', 'git switch main', 'git merge x', 'git stash',
    'git remote -v', 'git fetch', 'git pull', 'git push', 'git log']) {
    test(`'${c}' sin repositorio → NOT_A_REPO`, () => {
      const r = assertFails(fresh(), c, 'NOT_A_REPO');
      assert.match(text(r), /fatal: no es un repositorio git/);
    });
  }
});

describe('git status (§5.2)', () => {
  test('repo recién creado: sin commits y 3 archivos sin seguimiento', () => {
    const r = assertOk(runAll(fresh(), ['git init']), 'git status');
    assert.equal(r.changed, false);
    const t = text(r);
    assert.match(t, /En la rama main/);
    assert.match(t, /No hay commits todavía/);
    assert.match(t, /Archivos sin seguimiento:/);
    assert.match(t, /\tapp\.js/);
    assert.match(t, /no hay nada agregado al commit pero hay archivos sin seguimiento presentes/);
  });

  test('árbol limpio tras el primer commit', () => {
    const r = assertOk(freshRepo(), 'git status');
    assert.match(text(r), /nada para hacer commit, el árbol de trabajo está limpio/);
    assert.doesNotMatch(text(r), /No hay commits todavía/);
  });

  test('cambios preparados (nuevo archivo) y no preparados (modificado)', () => {
    const s = runAll(fresh(), ['git init', 'git add app.js']);
    const t = text(assertOk(s, 'git status'));
    assert.match(t, /Cambios a ser confirmados:/);
    assert.match(t, /nuevo archivo:\s+app\.js/);
    const s2 = runAll(freshRepo(), ['edit style.css']);
    const t2 = text(assertOk(s2, 'git status'));
    assert.match(t2, /Cambios no rastreados para el commit:/);
    assert.match(t2, /modificado:\s+style\.css/);
    assert.match(t2, /sin cambios agregados al commit \(usa "git add" y\/o "git commit -a"\)/);
  });

  test('getStatus separa staged, unstaged y untracked (§4.1)', () => {
    const s = runAll(freshRepo(), ['edit app.js', 'git add app.js', 'edit cart.js', 'touch nuevo.js']);
    assert.deepEqual(getStatus(s), {
      staged: [{ path: 'app.js', kind: 'modified' }],
      unstaged: [{ path: 'cart.js', kind: 'modified' }],
      untracked: ['nuevo.js'],
    });
  });

  test('un archivo preparado y editado de nuevo aparece en staged y unstaged', () => {
    const s = runAll(freshRepo(), ['edit app.js', 'git add app.js', 'edit app.js']);
    const st = getStatus(s);
    assert.deepEqual(st.staged.map((f) => f.path), ['app.js']);
    assert.deepEqual(st.unstaged.map((f) => f.path), ['app.js']);
  });

  test('ahead: tras un commit posterior al push', () => {
    const s = runAll(repoWithRemote(), ['edit app.js', 'git commit -am "local"']);
    assert.deepEqual(aheadBehind(s, 'main'), { upstream: 'origin/main', ahead: 1, behind: 0 });
    assert.match(text(assertOk(s, 'git status')), /Tu rama está adelantada a 'origin\/main' por 1 commit/);
  });

  test('actualizada con el upstream tras el push', () => {
    assert.match(text(assertOk(repoWithRemote(), 'git status')), /Tu rama está actualizada con 'origin\/main'/);
  });

  test('behind: tras fetch con un commit de Ana (y puede avanzar rápido)', () => {
    const s = runAll(repoWithRemote(), ['ana-push', 'git fetch']);
    assert.deepEqual(aheadBehind(s, 'main'), { upstream: 'origin/main', ahead: 0, behind: 1 });
    assert.match(text(assertOk(s, 'git status')), /Tu rama está detrás de 'origin\/main' por 1 commit.*avanzada rápido/);
  });

  test('status no hace fetch: sin fetch no sabe de Ana', () => {
    const s = runAll(repoWithRemote(), ['ana-push']);
    assert.match(text(assertOk(s, 'git status')), /actualizada con 'origin\/main'/);
  });

  test('divergida: 1 commit local y 1 de Ana', () => {
    const s = runAll(repoWithRemote(), ['ana-push', 'edit style.css', 'git commit -am "local"', 'git fetch']);
    assert.deepEqual(aheadBehind(s, 'main'), { upstream: 'origin/main', ahead: 1, behind: 1 });
    assert.match(text(assertOk(s, 'git status')), /han divergido,\s+y tienen 1 y 1 commits? diferentes? cada una, respectivamente/);
  });

  test('sin upstream, aheadBehind es null', () => {
    assert.equal(aheadBehind(freshRepo(), 'main'), null);
  });
});

describe('git add (§5.3)', () => {
  test('add . prepara todo (modificados y sin seguimiento) sin salida', () => {
    const s = runAll(freshRepo(), ['edit app.js', 'touch nuevo.js']);
    const r = assertOk(s, 'git add .');
    assert.deepEqual(r.output, []);
    assert.equal(r.changed, true);
    assert.equal(r.state.repo.index['app.js'], r.state.worktree['app.js']);
    assert.ok('nuevo.js' in r.state.repo.index);
  });

  test('-A y --all equivalen a add .', () => {
    const s = runAll(freshRepo(), ['edit app.js', 'touch nuevo.js']);
    for (const c of ['git add -A', 'git add --all']) {
      const r = assertOk(s, c);
      assert.deepEqual(getStatus(r.state).unstaged, []);
      assert.deepEqual(getStatus(r.state).untracked, []);
    }
  });

  test('add <ruta> solo prepara esa ruta', () => {
    const s = runAll(freshRepo(), ['edit app.js', 'edit cart.js']);
    const r = assertOk(s, 'git add app.js');
    assert.deepEqual(getStatus(r.state).staged.map((f) => f.path), ['app.js']);
    assert.deepEqual(getStatus(r.state).unstaged.map((f) => f.path), ['cart.js']);
  });

  test('add con varias rutas', () => {
    const s = runAll(freshRepo(), ['edit app.js', 'edit cart.js']);
    const r = assertOk(s, 'git add app.js cart.js');
    assert.deepEqual(getStatus(r.state).staged.map((f) => f.path).sort(), ['app.js', 'cart.js']);
  });

  test('add . prepara lo que add <ruta> deja fuera', () => {
    const s = runAll(fresh(), ['git init']);
    const conRuta = assertOk(s, 'git add app.js').state;
    const conPunto = assertOk(s, 'git add .').state;
    assert.deepEqual(Object.keys(conRuta.repo.index), ['app.js']);
    assert.deepEqual(Object.keys(conPunto.repo.index).sort(), ['app.js', 'cart.js', 'style.css']);
  });

  test('PATHSPEC: ruta inexistente', () => {
    const r = assertFails(freshRepo(), 'git add noexiste.js', 'PATHSPEC');
    assert.match(text(r), /fatal: ruta especificada 'noexiste\.js' no concordó con ningún archivo/);
  });

  test('NOTHING_SPECIFIED: add sin argumentos', () => {
    const r = assertFails(freshRepo(), 'git add', 'NOTHING_SPECIFIED');
    assert.match(text(r), /Nada especificado, nada agregado\./);
    assert.match(r.hint, /git add \./);
  });
});

describe('git commit (§5.4)', () => {
  test('commit raíz: sin padres, ids y salida con commit-raíz', () => {
    const s = runAll(fresh(), ['git init', 'git add .']);
    const r = assertOk(s, 'git commit -m "Primero"');
    const id = headId(r.state);
    assert.deepEqual(r.state.objects[id].parents, []);
    assert.equal(r.state.objects[id].author, 'Andrés');
    assert.equal(r.state.objects[id].message, 'Primero');
    assert.match(r.output[0], new RegExp(`^\\[main \\(commit-raíz\\) ${id}\\] Primero$`));
    assert.match(r.output[1], /3 archivos cambiados?/);
    assert.deepEqual(r.effects, [{ type: 'commit', id }]);
    assert.deepEqual(r.state.repo.index, r.state.objects[id].tree);
  });

  test('commit normal: un padre, rama avanza y la salida no dice commit-raíz', () => {
    const s = runAll(freshRepo(), ['edit app.js', 'git add app.js']);
    const antes = headId(s);
    const r = assertOk(s, 'git commit -m "Segundo"');
    const id = headId(r.state);
    assert.notEqual(id, antes);
    assert.deepEqual(r.state.objects[id].parents, [antes]);
    assert.equal(r.output[0], `[main ${id}] Segundo`);
    assert.match(r.output[1], /1 archivo cambiado/);
  });

  test('el commit guarda la copia del índice, no del árbol de trabajo', () => {
    const s = runAll(freshRepo(), ['edit app.js', 'git add app.js', 'edit app.js']);
    const r = assertOk(s, 'git commit -m "x"');
    assert.equal(r.state.objects[headId(r.state)].tree['app.js'], 'app.js@v2');
    assert.equal(r.state.worktree['app.js'], 'app.js@v3');
  });

  test('-am y -a -m confirman los rastreados modificados', () => {
    const s = runAll(freshRepo(), ['edit app.js']);
    for (const c of ['git commit -am "x"', 'git commit -a -m "x"', 'git commit --all --message=x']) {
      const r = assertOk(s, c);
      assert.deepEqual(getStatus(r.state), { staged: [], unstaged: [], untracked: [] });
    }
  });

  test('-a NO incluye archivos sin seguimiento', () => {
    const s = runAll(freshRepo(), ['edit app.js', 'touch nuevo.js']);
    const r = assertOk(s, 'git commit -am "x"');
    assert.equal('nuevo.js' in r.state.objects[headId(r.state)].tree, false);
    assert.deepEqual(getStatus(r.state).untracked, ['nuevo.js']);
  });

  test('sin -a, los cambios no preparados no entran en el commit', () => {
    const s = runAll(freshRepo(), ['edit app.js', 'edit cart.js', 'git add app.js']);
    const r = assertOk(s, 'git commit -m "x"');
    assert.equal(r.state.objects[headId(r.state)].tree['cart.js'], 'cart.js@v1');
    assert.deepEqual(getStatus(r.state).unstaged.map((f) => f.path), ['cart.js']);
  });

  test('NEEDS_MESSAGE: commit sin -m', () => {
    assertFails(runAll(freshRepo(), ['edit app.js', 'git add .']), 'git commit', 'NEEDS_MESSAGE');
  });

  test('NOTHING_TO_COMMIT: árbol limpio, y la salida reproduce el status', () => {
    const r = assertFails(freshRepo(), 'git commit -m x', 'NOTHING_TO_COMMIT');
    assert.match(text(r), /nada para hacer commit, el árbol de trabajo está limpio/);
  });

  test('NOTHING_STAGED: hay cambios sin preparar', () => {
    const r = assertFails(runAll(freshRepo(), ['edit app.js']), 'git commit -m x', 'NOTHING_STAGED');
    assert.match(text(r), /Cambios no rastreados para el commit/);
  });

  test('NOTHING_STAGED: solo archivos sin seguimiento', () => {
    assertFails(runAll(freshRepo(), ['touch n.js']), 'git commit -m x', 'NOTHING_STAGED');
  });

  test('NOTHING_STAGED en repo sin commits ni staging', () => {
    assertFails(runAll(fresh(), ['git init']), 'git commit -m x', 'NOTHING_STAGED');
  });
});

describe('git branch (§5.5)', () => {
  test('sin args: lista ordenada con * en la actual', () => {
    const s = runAll(freshRepo(), ['git branch zeta', 'git branch alfa']);
    assert.deepEqual(assertOk(s, 'git branch').output, ['  alfa', '* main', '  zeta']);
  });

  test('sin commits la lista está vacía', () => {
    assert.deepEqual(assertOk(runAll(fresh(), ['git init']), 'git branch').output, []);
  });

  test('crear rama apunta al commit actual y no cambia de rama', () => {
    const r = assertOk(freshRepo(), 'git branch feature/x');
    assert.equal(r.state.repo.branches['feature/x'], headId(r.state));
    assert.equal(r.state.repo.head, 'main');
    assert.equal(r.changed, true);
  });

  test('NO_COMMITS: crear rama sin commits', () => {
    const r = assertFails(runAll(fresh(), ['git init']), 'git branch x', 'NO_COMMITS');
    assert.match(text(r), /fatal: no es un nombre de objeto válido: 'main'\./);
  });

  test('BRANCH_EXISTS', () => {
    const r = assertFails(freshRepo(), 'git branch main', 'BRANCH_EXISTS');
    assert.match(text(r), /fatal: ya existe una rama llamada 'main'\./);
  });

  for (const bad of ['a..b', '-x', '/x', 'x/', 'x.lock', 'a~b', 'a^b', 'a:b', 'a?b', 'a*b', 'a[b', 'a\\b']) {
    test(`INVALID_BRANCH_NAME: '${bad}'`, () => {
      // "-x" es una opción para el parser; el resto llega al motor como nombre.
      const s = freshRepo();
      const r = git.run(s, `git branch -- ${bad}`);
      if (bad === '-x') {
        assert.equal(r.ok, false);
        assert.equal(r.state, s);
      } else {
        assertFails(s, `git branch ${bad}`, 'INVALID_BRANCH_NAME');
      }
    });
  }

  test('INVALID_BRANCH_NAME: nombre con espacios entre comillas', () => {
    assertFails(freshRepo(), 'git branch "mi rama"', 'INVALID_BRANCH_NAME');
  });

  test('-d borra una rama ya fusionada y muestra «Eliminada la rama»', () => {
    const s = runAll(freshRepo(), ['git branch x']);
    const r = assertOk(s, 'git branch -d x');
    assert.equal('x' in r.state.repo.branches, false);
    assert.match(text(r), new RegExp(`^Eliminada la rama x \\(era ${headId(s)}\\)\\.$`));
  });

  test('BRANCH_IN_USE: borrar la rama actual', () => {
    assertFails(freshRepo(), 'git branch -d main', 'BRANCH_IN_USE');
  });

  test('BRANCH_IN_USE también con -D', () => {
    assertFails(freshRepo(), 'git branch -D main', 'BRANCH_IN_USE');
  });

  test('BRANCH_NOT_FOUND', () => {
    assertFails(freshRepo(), 'git branch -d nada', 'BRANCH_NOT_FOUND');
  });

  test('BRANCH_NOT_MERGED y -D fuerza el borrado', () => {
    const s = runAll(freshRepo(), ['git switch -c x', 'edit app.js', 'git commit -am "solo en x"', 'git switch main']);
    const r = assertFails(s, 'git branch -d x', 'BRANCH_NOT_MERGED');
    assert.match(text(r) + (r.hint ?? ''), /-D/);
    const forced = assertOk(s, 'git branch -D x');
    assert.equal('x' in forced.state.repo.branches, false);
  });
});

describe('git switch / checkout (§5.6)', () => {
  test('switch a otra rama cambia HEAD y devuelve el efecto', () => {
    const s = runAll(freshRepo(), ['git branch x']);
    const r = assertOk(s, 'git switch x');
    assert.equal(r.state.repo.head, 'x');
    assert.equal(text(r), "Cambiado a rama 'x'");
    assert.deepEqual(r.effects, [{ type: 'switch', from: 'main', to: 'x' }]);
  });

  test('misma rama: «Ya en main» sin cambios', () => {
    const s = freshRepo();
    const r = assertOk(s, 'git switch main');
    assert.equal(r.changed, false);
    assert.equal(r.state, s);
    assert.match(text(r), /Ya en 'main'/);
  });

  test('switch -c crea y cambia', () => {
    const r = assertOk(freshRepo(), 'git switch -c nueva');
    assert.equal(r.state.repo.head, 'nueva');
    assert.equal(r.state.repo.branches.nueva, headId(r.state));
    assert.equal(text(r), "Cambiado a nueva rama 'nueva'");
  });

  test('switch -c sin commits renombra la rama «unborn»', () => {
    const r = assertOk(runAll(fresh(), ['git init']), 'git switch -c dev');
    assert.equal(r.state.repo.head, 'dev');
    assert.deepEqual(r.state.repo.branches, {});
  });

  test('switch -c con rama existente → BRANCH_EXISTS', () => {
    assertFails(freshRepo(), 'git switch -c main', 'BRANCH_EXISTS');
  });

  test('INVALID_REF: rama inexistente, con consejo de -c', () => {
    const r = assertFails(freshRepo(), 'git switch nada', 'INVALID_REF');
    assert.match(text(r), /fatal: referencia inválida: nada/);
    assert.match(r.hint, /git switch -c nada/);
  });

  test('checkout <rama> equivale a switch y checkout -b a switch -c', () => {
    const s = runAll(freshRepo(), ['git branch x']);
    assert.equal(assertOk(s, 'git checkout x').state.repo.head, 'x');
    const b = assertOk(s, 'git checkout -b y');
    assert.equal(b.state.repo.head, 'y');
    assert.equal(b.state.repo.branches.y, headId(s));
  });

  test('cambiar de rama actualiza el árbol de trabajo a la otra rama', () => {
    const s = runAll(freshRepo(), ['git switch -c x', 'edit cart.js', 'git commit -am "x"', 'git switch main']);
    assert.equal(s.worktree['cart.js'], 'cart.js@v1');
    const r = assertOk(s, 'git switch x');
    assert.equal(r.state.worktree['cart.js'], 'cart.js@v2');
    assert.equal(r.state.repo.index['cart.js'], 'cart.js@v2');
  });

  test('los cambios locales que no chocan viajan a la otra rama', () => {
    const s = runAll(freshRepo(), ['git switch -c x', 'edit cart.js', 'git commit -am "x"', 'git switch main', 'edit style.css']);
    const r = assertOk(s, 'git switch x');
    assert.equal(r.state.worktree['style.css'], 'style.css@v2');
    assert.deepEqual(getStatus(r.state).unstaged, [{ path: 'style.css', kind: 'modified' }]);
    assert.equal(r.state.worktree['cart.js'], 'cart.js@v2');
  });

  test('los cambios preparados que no chocan también viajan', () => {
    const s = runAll(freshRepo(), ['git branch x', 'edit style.css', 'git add style.css']);
    const r = assertOk(s, 'git switch x');
    assert.deepEqual(getStatus(r.state).staged, [{ path: 'style.css', kind: 'modified' }]);
  });

  test('LOCAL_CHANGES_OVERWRITTEN: cambios locales en un archivo que la otra rama modifica', () => {
    const s = runAll(freshRepo(), ['git switch -c x', 'edit cart.js', 'git commit -am "x"', 'git switch main', 'edit cart.js']);
    const r = assertFails(s, 'git switch x', 'LOCAL_CHANGES_OVERWRITTEN');
    const t = text(r);
    assert.match(t, /error: Tus cambios locales a los siguientes archivos serían sobrescritos por checkout:/);
    assert.match(t, /cart\.js/);
    assert.match(t, /Por favor, confirma tus cambios o guárdalos antes de cambiar de rama\./);
    assert.match(t, /Abortando/);
  });

  test('LOCAL_CHANGES_OVERWRITTEN también con cambios preparados', () => {
    const s = runAll(freshRepo(), ['git switch -c x', 'edit cart.js', 'git commit -am "x"', 'git switch main', 'edit cart.js', 'git add cart.js']);
    assertFails(s, 'git switch x', 'LOCAL_CHANGES_OVERWRITTEN');
  });

  test('UNTRACKED_OVERWRITTEN: archivo sin seguimiento con otro contenido que el de la rama destino', () => {
    const s = runAll(freshRepo(), ['git switch -c x', 'touch nuevo.js', 'git add nuevo.js', 'git commit -m "nuevo"', 'git switch main', 'touch nuevo.js']);
    assertFails(s, 'git switch x', 'UNTRACKED_OVERWRITTEN');
  });

  test('switch a origin/<rama> crea la rama con upstream (DWIM, §14.1)', () => {
    const base = runAll(repoWithRemote(), ['git switch -c otra', 'git push -u origin otra', 'git switch main', 'git branch -D otra']);
    const r = assertOk(base, 'git switch otra');
    assert.equal(r.state.repo.head, 'otra');
    assert.equal(r.state.repo.upstream.otra, 'origin/otra');
  });
});

describe('git merge (§5.7)', () => {
  test('MISSING_ARG: merge sin rama', () => {
    assertFails(freshRepo(), 'git merge', 'MISSING_ARG');
  });

  test('INVALID_REF: la rama no existe', () => {
    const r = assertFails(freshRepo(), 'git merge nada', 'INVALID_REF');
    assert.match(text(r), /merge: nada - no es algo que podamos fusionar/);
  });

  test('«Ya está actualizado» si el destino ya está contenido', () => {
    const s = runAll(freshRepo(), ['git branch x']);
    const r = assertOk(s, 'git merge x');
    assert.equal(r.changed, false);
    assert.equal(r.state, s);
    assert.match(text(r), /Ya está actualizado\./);
  });

  test('fast-forward: no crea commit nuevo y mueve la rama', () => {
    const s = runAll(freshRepo(), ['git switch -c x', 'edit cart.js', 'git commit -am "x"', 'git switch main']);
    const objetos = Object.keys(s.objects).length;
    const r = assertOk(s, 'git merge x');
    assert.equal(Object.keys(r.state.objects).length, objetos, 'no se crea ningún commit');
    assert.equal(r.state.repo.branches.main, r.state.repo.branches.x);
    assert.match(text(r), /Avance rápido/);
    assert.match(text(r), /Actualizando [0-9a-f]{7}\.\.[0-9a-f]{7}/);
    assert.equal(r.effects[0].type, 'merge');
    assert.equal(r.effects[0].kind, 'fast-forward');
    assert.equal(r.state.worktree['cart.js'], 'cart.js@v2');
    assert.deepEqual(getStatus(r.state), { staged: [], unstaged: [], untracked: [] });
  });

  test('rama actual sin commits (unborn): pull avanza rápido hasta el destino (§5.7)', () => {
    // Un clon "vacío": el servidor ya tiene main, pero el repo local acaba de hacer init.
    const srv = repoWithRemote();
    const s = deepFreeze({ ...runAll(fresh(), ['git init', `git remote add origin ${URL}`]), server: structuredClone(srv.server), objects: structuredClone(srv.objects), seq: srv.seq });
    const r = assertOk(s, 'git pull origin main');
    assert.equal(r.state.repo.branches.main, srv.server.branches.main);
    assert.equal(Object.keys(r.state.objects).length, Object.keys(srv.objects).length, 'no crea commits');
    assert.equal(r.state.worktree['app.js'], srv.worktree['app.js']);
  });

  test('merge de 3 vías: commit con 2 padres, mensaje de Git y efecto merge-commit', () => {
    const s = divergent();
    const main = s.repo.branches.main;
    const feat = s.repo.branches.feat;
    const r = assertOk(s, 'git merge feat');
    const id = headId(r.state);
    assert.deepEqual(r.state.objects[id].parents, [main, feat]);
    assert.equal(r.state.objects[id].message, "Merge branch 'feat'");
    assert.match(text(r), /Merge hecho por la estrategia 'ort'\./);
    assert.deepEqual(r.effects.map((e) => [e.type, e.kind]), [['merge', 'merge-commit']]);
    // El árbol contiene ambos cambios.
    assert.equal(r.state.objects[id].tree['app.js'], 'app.js@v2');
    assert.equal(r.state.objects[id].tree['cart.js'], 'cart.js@v2');
    assert.equal(r.state.worktree['cart.js'], 'cart.js@v2');
    assert.deepEqual(getStatus(r.state), { staged: [], unstaged: [], untracked: [] });
    assert.equal(r.state.repo.branches.feat, feat, 'la otra rama no se mueve');
  });

  test('--no-ff fuerza un commit de merge aunque pudiera ser fast-forward', () => {
    const s = runAll(freshRepo(), ['git switch -c x', 'edit cart.js', 'git commit -am "x"', 'git switch main']);
    const r = assertOk(s, 'git merge --no-ff x');
    const c = r.state.objects[headId(r.state)];
    assert.equal(c.parents.length, 2);
    assert.equal(r.effects[0].kind, 'merge-commit');
    assert.equal(Object.keys(r.state.objects).length, Object.keys(s.objects).length + 1);
  });

  test('MERGE_CONFLICT: mismo archivo en ambas ramas; estado intacto', () => {
    const s = runAll(freshRepo(), ['git switch -c x', 'edit app.js', 'git commit -am "x"', 'git switch main', 'edit app.js', 'git commit -am "y"']);
    const r = assertFails(s, 'git merge x', 'MERGE_CONFLICT');
    const t = text(r);
    assert.match(t, /Auto-fusionando app\.js/);
    assert.match(t, /CONFLICTO \(contenido\): Conflicto de fusión en app\.js/);
    assert.match(t, /Fusión automática falló; arregla los conflictos y luego realiza un commit con el resultado\./);
    assert.ok(r.notes.length > 0, 'debe llevar la nota de simplificación (se cancela la fusión)');
  });

  test('merge de un archivo cambiado igual en ambas ramas no es conflicto', () => {
    // Ambas ramas parten de la misma base y solo una cambia cada archivo → sin conflicto.
    const s = divergent();
    assertOk(s, 'git merge feat');
  });

  test('LOCAL_CHANGES_OVERWRITTEN en merge con cambios sucios en un archivo que la fusión toca', () => {
    const s = runAll(divergent(), ['edit cart.js']);
    const r = assertFails(s, 'git merge feat', 'LOCAL_CHANGES_OVERWRITTEN');
    assert.match(text(r), /sobrescritos por fusión/); // el verbo cambia respecto a switch (§5.7)
  });

  test('merge de 3 vías conserva cambios sin preparar no relacionados (§14.1)', () => {
    const s = runAll(divergent(), ['edit style.css']);
    const r = assertOk(s, 'git merge feat');
    assert.equal(r.state.worktree['style.css'], 'style.css@v2');
    assert.deepEqual(getStatus(r.state).unstaged, [{ path: 'style.css', kind: 'modified' }]);
  });

  test('isAncestor y mergeBase', () => {
    const s = divergent();
    const base = Object.values(s.objects).find((c) => c.parents.length === 0).id;
    assert.equal(mergeBase(s, s.repo.branches.main, s.repo.branches.feat), base);
    assert.equal(isAncestor(s, base, s.repo.branches.main), true);
    assert.equal(isAncestor(s, s.repo.branches.main, base), false);
    assert.equal(isAncestor(s, base, base), true);
    assert.equal(isAncestor(s, s.repo.branches.feat, s.repo.branches.main), false);
  });
});

describe('git stash (§5.8)', () => {
  test('NO_COMMITS: stash sin commits', () => {
    const r = assertFails(runAll(fresh(), ['git init', 'git add .']), 'git stash', 'NO_COMMITS');
    assert.match(text(r), /No tienes el commit inicial todavía/);
  });

  test('sin cambios: «No hay cambios locales para guardar» (ok, sin cambios)', () => {
    const s = freshRepo();
    const r = assertOk(s, 'git stash');
    assert.equal(r.changed, false);
    assert.equal(r.state, s);
    assert.match(text(r), /No hay cambios locales para guardar/);
  });

  test('push guarda las modificaciones y deja el árbol limpio', () => {
    const s = runAll(freshRepo(), ['edit style.css']);
    const r = assertOk(s, 'git stash');
    assert.equal(r.state.repo.stash.length, 1);
    const e = r.state.repo.stash[0];
    assert.match(e.message, new RegExp(`^WIP on main: ${headId(s)} Primera versión$`));
    assert.equal(e.branch, 'main');
    assert.equal(e.base, headId(s));
    assert.equal(e.worktree['style.css'], 'style.css@v2');
    assert.deepEqual(getStatus(r.state), { staged: [], unstaged: [], untracked: [] });
    assert.equal(r.state.worktree['style.css'], 'style.css@v1');
    assert.match(text(r), /Directorio de trabajo y estado de índice WIP on main: .* guardados/);
    assert.deepEqual(r.effects, [{ type: 'stash-push' }]);
  });

  test('«stash push» equivale a «stash» y -m pone el mensaje «On main: <msg>»', () => {
    const s = runAll(freshRepo(), ['edit style.css']);
    const r = assertOk(s, 'git stash push -m "mi trabajo"');
    assert.equal(r.state.repo.stash[0].message, 'On main: mi trabajo');
    assert.deepEqual(assertOk(s, 'git stash push').state, assertOk(s, 'git stash').state);
  });

  test('también guarda lo preparado', () => {
    const s = runAll(freshRepo(), ['edit style.css', 'git add style.css']);
    const r = assertOk(s, 'git stash');
    assert.deepEqual(getStatus(r.state), { staged: [], unstaged: [], untracked: [] });
    assert.equal(r.state.repo.stash[0].index['style.css'], 'style.css@v2');
  });

  test('los archivos sin seguimiento se quedan en el worktree sin -u', () => {
    const s = runAll(freshRepo(), ['edit style.css', 'touch nuevo.js']);
    const r = assertOk(s, 'git stash');
    assert.ok('nuevo.js' in r.state.worktree);
    assert.deepEqual(getStatus(r.state).untracked, ['nuevo.js']);
    assert.equal(r.state.repo.stash[0].includeUntracked, false);
  });

  test('solo sin seguimiento y sin -u: no hay nada que guardar', () => {
    const s = runAll(freshRepo(), ['touch nuevo.js']);
    const r = assertOk(s, 'git stash');
    assert.equal(r.changed, false);
    assert.match(text(r), /No hay cambios locales para guardar/);
  });

  test('con -u también se guardan (y retiran) los archivos sin seguimiento', () => {
    const s = runAll(freshRepo(), ['edit style.css', 'touch nuevo.js']);
    for (const c of ['git stash -u', 'git stash --include-untracked', 'git stash push -u']) {
      const r = assertOk(s, c);
      assert.equal('nuevo.js' in r.state.worktree, false);
      assert.equal(r.state.repo.stash[0].includeUntracked, true);
      assert.ok('nuevo.js' in r.state.repo.stash[0].worktree);
    }
  });

  test('solo sin seguimiento con -u sí guarda', () => {
    const r = assertOk(runAll(freshRepo(), ['touch nuevo.js']), 'git stash -u');
    assert.equal(r.state.repo.stash.length, 1);
  });

  test('list: el más reciente primero', () => {
    const s = runAll(freshRepo(), ['edit style.css', 'git stash push -m uno', 'edit app.js', 'git stash push -m dos']);
    const r = assertOk(s, 'git stash list');
    assert.equal(r.changed, false);
    assert.equal(r.output.length, 2);
    assert.match(r.output[0], /^stash@\{0\}: On main: dos$/);
    assert.match(r.output[1], /^stash@\{1\}: On main: uno$/);
  });

  test('list vacío no imprime nada', () => {
    assert.deepEqual(assertOk(freshRepo(), 'git stash list').output, []);
  });

  test('pop restaura las modificaciones SIN preparar y elimina la entrada', () => {
    const s = runAll(freshRepo(), ['edit style.css', 'git add style.css', 'git stash']);
    const r = assertOk(s, 'git stash pop');
    assert.equal(r.state.repo.stash.length, 0);
    assert.equal(r.state.worktree['style.css'], 'style.css@v2');
    assert.deepEqual(getStatus(r.state), { staged: [], unstaged: [{ path: 'style.css', kind: 'modified' }], untracked: [] });
    assert.match(text(r), /Descartado refs\/stash@\{0\}/);
    assert.deepEqual(r.effects, [{ type: 'stash-pop' }]);
  });

  test('pop deja PREPARADOS los archivos nuevos', () => {
    const s = runAll(freshRepo(), ['touch nuevo.js', 'git add nuevo.js', 'git stash']);
    assert.equal('nuevo.js' in s.worktree, false);
    const r = assertOk(s, 'git stash pop');
    assert.deepEqual(getStatus(r.state).staged, [{ path: 'nuevo.js', kind: 'new' }]);
    assert.deepEqual(getStatus(r.state).unstaged, []);
  });

  test('pop con -u devuelve los archivos sin seguimiento', () => {
    const s = runAll(freshRepo(), ['edit style.css', 'touch nuevo.js', 'git stash -u']);
    const r = assertOk(s, 'git stash pop');
    assert.ok('nuevo.js' in r.state.worktree);
    assert.equal(r.state.worktree['style.css'], 'style.css@v2');
  });

  test('apply restaura pero conserva la entrada', () => {
    const s = runAll(freshRepo(), ['edit style.css', 'git stash']);
    const r = assertOk(s, 'git stash apply');
    assert.equal(r.state.repo.stash.length, 1);
    assert.equal(r.state.worktree['style.css'], 'style.css@v2');
  });

  test('pop y apply con stash@{n} eligen la entrada indicada', () => {
    const s = runAll(freshRepo(), ['edit style.css', 'git stash push -m uno', 'edit app.js', 'git stash push -m dos']);
    const r = assertOk(s, 'git stash pop stash@{1}');
    assert.equal(r.state.repo.stash.length, 1);
    assert.equal(r.state.repo.stash[0].message, 'On main: dos');
    assert.equal(r.state.worktree['style.css'], 'style.css@v2');
    assert.equal(r.state.worktree['app.js'], 'app.js@v1');
  });

  test('drop elimina la entrada sin aplicarla', () => {
    const s = runAll(freshRepo(), ['edit style.css', 'git stash']);
    const r = assertOk(s, 'git stash drop');
    assert.equal(r.state.repo.stash.length, 0);
    assert.equal(r.state.worktree['style.css'], 'style.css@v1');
  });

  test('drop stash@{1} elimina solo esa entrada', () => {
    const s = runAll(freshRepo(), ['edit style.css', 'git stash push -m uno', 'edit app.js', 'git stash push -m dos']);
    const r = assertOk(s, 'git stash drop stash@{1}');
    assert.deepEqual(r.state.repo.stash.map((e) => e.message), ['On main: dos']);
  });

  test('NO_STASH: pop, apply y drop con la pila vacía', () => {
    for (const c of ['git stash pop', 'git stash apply', 'git stash drop']) {
      const r = assertFails(freshRepo(), c, 'NO_STASH');
      assert.match(text(r), /error: No se encontraron entradas de stash\./);
    }
  });

  test('STASH_CONFLICT: el archivo está sucio en el árbol actual; la entrada se conserva', () => {
    const s = runAll(freshRepo(), ['edit style.css', 'git stash', 'edit style.css']);
    const r = assertFails(s, 'git stash pop', 'STASH_CONFLICT');
    assert.match(text(r), /La entrada de stash se guardó en caso de que la vuelvas a necesitar\./);
    assert.equal(r.state.repo.stash.length, 1);
  });

  test('STASH_CONFLICT: HEAD cambió el archivo desde que se guardó', () => {
    const s = runAll(freshRepo(), ['edit style.css', 'git stash', 'edit style.css', 'git commit -am "otro cambio"']);
    assertFails(s, 'git stash pop', 'STASH_CONFLICT');
  });

  test('un stash sin conflicto sobre HEAD cambiado en otros archivos sí se aplica', () => {
    const s = runAll(freshRepo(), ['edit style.css', 'git stash', 'edit app.js', 'git commit -am "otro"']);
    const r = assertOk(s, 'git stash pop');
    assert.equal(r.state.worktree['style.css'], 'style.css@v2');
    assert.equal(r.state.worktree['app.js'], 'app.js@v2');
  });
});

describe('git remote (§5.9)', () => {
  test('sin remotos: salida vacía', () => {
    assert.deepEqual(assertOk(freshRepo(), 'git remote').output, []);
    assert.deepEqual(assertOk(freshRepo(), 'git remote -v').output, []);
  });

  test('remote add y listados', () => {
    const r = assertOk(freshRepo(), `git remote add origin ${URL}`);
    assert.equal(r.changed, true);
    assert.equal(r.state.repo.remotes.origin, URL);
    assert.deepEqual(assertOk(r.state, 'git remote').output, ['origin']);
    assert.deepEqual(assertOk(r.state, 'git remote -v').output, [`origin\t${URL} (fetch)`, `origin\t${URL} (push)`]);
  });

  test('REMOTE_EXISTS', () => {
    const s = runAll(freshRepo(), [`git remote add origin ${URL}`]);
    const r = assertFails(s, `git remote add origin ${URL}`, 'REMOTE_EXISTS');
    assert.match(text(r), /error: remoto origin ya existe\./);
  });

  test('MISSING_ARG: remote add sin nombre o sin url', () => {
    assertFails(freshRepo(), 'git remote add', 'MISSING_ARG');
    assertFails(freshRepo(), 'git remote add origin', 'MISSING_ARG');
  });
});

describe('git fetch (§5.10)', () => {
  test('NO_REMOTE: fetch sin remoto', () => {
    assertFails(freshRepo(), 'git fetch', 'NO_REMOTE');
  });

  test('actualiza tracking pero no la rama local ni el árbol de trabajo', () => {
    const s = runAll(repoWithRemote(), ['ana-push cart.js']);
    const r = assertOk(s, 'git fetch');
    assert.equal(r.state.repo.tracking['origin/main'], s.server.branches.main);
    assert.notEqual(r.state.repo.tracking['origin/main'], r.state.repo.branches.main);
    assert.equal(r.state.repo.branches.main, s.repo.branches.main);
    assert.deepEqual(r.state.worktree, s.worktree);
    assert.match(text(r), /Desde https:\/\/github\.com\/equipo\/tienda\.git/);
    assert.match(text(r), /main\s+-> origin\/main/);
    assert.equal(r.effects[0].type, 'fetch');
  });

  test('sin novedades no hay salida ni cambios', () => {
    const s = repoWithRemote();
    const r = assertOk(s, 'git fetch');
    assert.deepEqual(r.output, []);
    assert.equal(r.changed, false);
  });

  test('primer fetch muestra «[nueva rama]»', () => {
    const base = repoWithRemote();
    const s = deepFreeze({ ...structuredClone(base), repo: { ...structuredClone(base.repo), tracking: {} } });
    const r = assertOk(s, 'git fetch');
    assert.match(text(r), /\[nueva rama\]/);
  });
});

describe('git pull (§5.11)', () => {
  test('NO_REMOTE', () => {
    assertFails(freshRepo(), 'git pull', 'NO_REMOTE');
  });

  test('NO_UPSTREAM: sin argumentos y sin upstream', () => {
    const s = runAll(freshRepo(), [`git remote add origin ${URL}`]);
    const r = assertFails(s, 'git pull', 'NO_UPSTREAM');
    assert.match(text(r), /No hay información de rastreo para la rama actual\./);
    assert.match(text(r), /git pull <remoto> <rama>/);
    assert.match(text(r), /git branch --set-upstream-to=origin\/main main/);
  });

  test('REMOTE_REF_NOT_FOUND: el servidor no tiene la rama', () => {
    const s = runAll(freshRepo(), [`git remote add origin ${URL}`]);
    const r = assertFails(s, 'git pull origin main', 'REMOTE_REF_NOT_FOUND');
    assert.match(text(r), /fatal: no se encontró la referencia remota main/);
  });

  test('todo al día: «Ya está actualizado»', () => {
    const r = assertOk(repoWithRemote(), 'git pull');
    assert.match(text(r), /Ya está actualizado\./);
    assert.equal(r.changed, false);
  });

  test('fast-forward: main avanza al commit de Ana sin commit nuevo', () => {
    const s = runAll(repoWithRemote(), ['ana-push cart.js']);
    const objetos = Object.keys(s.objects).length;
    const r = assertOk(s, 'git pull');
    assert.equal(r.state.repo.branches.main, s.server.branches.main);
    assert.equal(r.state.repo.tracking['origin/main'], s.server.branches.main);
    assert.equal(Object.keys(r.state.objects).length, objetos);
    assert.match(text(r), /Avance rápido/);
    assert.equal(r.state.worktree['cart.js'], 'cart.js@v2');
    assert.deepEqual(r.effects.map((e) => e.type).sort(), ['fetch', 'merge']);
  });

  test('pull con merge: historias divergentes → commit de merge con 2 padres', () => {
    const s = runAll(repoWithRemote(), ['ana-push cart.js', 'edit app.js', 'git commit -am "Mejora"']);
    const local = s.repo.branches.main;
    const r = assertOk(s, 'git pull');
    const c = r.state.objects[headId(r.state)];
    assert.deepEqual(c.parents, [local, s.server.branches.main]);
    assert.equal(c.message, `Merge branch 'main' of ${URL}`);
    assert.equal(r.state.worktree['cart.js'], 'cart.js@v2');
    assert.equal(r.state.worktree['app.js'], 'app.js@v2');
  });

  test('pull con argumentos explícitos <remoto> <rama>', () => {
    const s = runAll(repoWithRemote(), ['ana-push']);
    const r = assertOk(s, 'git pull origin main');
    assert.equal(r.state.repo.branches.main, s.server.branches.main);
  });

  test('MERGE_CONFLICT en pull: se cancela todo, incluido el fetch (§14.1)', () => {
    const s = runAll(repoWithRemote(), ['ana-push app.js', 'edit app.js', 'git commit -am "local"']);
    const r = assertFails(s, 'git pull', 'MERGE_CONFLICT');
    assert.equal(r.state.repo.tracking['origin/main'], s.repo.tracking['origin/main']);
  });

  test('LOCAL_CHANGES_OVERWRITTEN en pull con cambios locales en un archivo descargado', () => {
    const s = runAll(repoWithRemote(), ['ana-push cart.js', 'edit cart.js']);
    assertFails(s, 'git pull', 'LOCAL_CHANGES_OVERWRITTEN');
  });

  test('UNSUPPORTED: pull --rebase', () => {
    assertFails(repoWithRemote(), 'git pull --rebase', 'UNSUPPORTED');
  });
});

describe('git push (§5.12)', () => {
  test('NO_REMOTE', () => {
    const r = assertFails(freshRepo(), 'git push', 'NO_REMOTE');
    assert.match(text(r), /fatal: No se ha configurado un destino para el push\./);
    assert.match(text(r), /git remote add/);
  });

  test('NO_UPSTREAM sin argumentos y sin upstream', () => {
    const s = runAll(freshRepo(), [`git remote add origin ${URL}`]);
    const r = assertFails(s, 'git push', 'NO_UPSTREAM');
    assert.match(text(r), /fatal: La rama actual main no tiene una rama upstream\./);
    assert.match(text(r), /git push --set-upstream origin main/);
  });

  test('NO_COMMITS: push de una rama sin commits', () => {
    const s = runAll(fresh(), ['git init', `git remote add origin ${URL}`]);
    const r = assertFails(s, 'git push -u origin main', 'NO_COMMITS');
    assert.match(text(r), /error: src refspec main no concuerda con ninguno/);
  });

  test('NO_COMMITS: push de una rama local inexistente (§14.1)', () => {
    const s = runAll(freshRepo(), [`git remote add origin ${URL}`]);
    assertFails(s, 'git push origin fantasma', 'NO_COMMITS');
  });

  test('push -u publica la rama y fija el upstream', () => {
    const s = runAll(freshRepo(), [`git remote add origin ${URL}`]);
    const r = assertOk(s, 'git push -u origin main');
    const id = headId(s);
    assert.equal(r.state.server.branches.main, id);
    assert.equal(r.state.repo.tracking['origin/main'], id);
    assert.equal(r.state.repo.upstream.main, 'origin/main');
    assert.equal(r.output[0], `To ${URL}`);
    assert.match(r.output[1], /\[new branch\]\s+main -> main/);
    assert.match(text(r), /rama 'main' configurada para rastrear 'origin\/main'\./);
    assert.deepEqual(r.effects, [{ type: 'push', ids: [id] }]);
  });

  test('--set-upstream equivale a -u', () => {
    const s = runAll(freshRepo(), [`git remote add origin ${URL}`]);
    assert.equal(assertOk(s, 'git push --set-upstream origin main').state.repo.upstream.main, 'origin/main');
  });

  test('push sin -u NO fija el upstream', () => {
    const s = runAll(freshRepo(), [`git remote add origin ${URL}`]);
    const r = assertOk(s, 'git push origin main');
    assert.deepEqual(r.state.repo.upstream, {});
    assert.equal(r.state.server.branches.main, headId(s));
  });

  test('push posterior muestra el rango a..b y sube solo los commits nuevos', () => {
    const base = repoWithRemote();
    const s = runAll(base, ['edit app.js', 'git commit -am "dos"']);
    const r = assertOk(s, 'git push');
    assert.match(r.output[1], new RegExp(`${base.repo.branches.main}\\.\\.${headId(s)}\\s+main -> main`));
    assert.equal(r.state.server.branches.main, headId(s));
    assert.deepEqual(r.effects, [{ type: 'push', ids: [headId(s)] }]);
    assert.deepEqual(aheadBehind(r.state, 'main'), { upstream: 'origin/main', ahead: 0, behind: 0 });
  });

  test('«Todo actualizado» cuando el servidor ya tiene el commit', () => {
    const s = repoWithRemote();
    const r = assertOk(s, 'git push');
    assert.equal(r.changed, false);
    assert.equal(r.state, s);
    assert.match(text(r), /Todo actualizado/);
  });

  test('PUSH_REJECTED: Ana subió antes', () => {
    const s = runAll(repoWithRemote(), ['ana-push', 'edit style.css', 'git commit -am "local"']);
    const r = assertFails(s, 'git push', 'PUSH_REJECTED');
    const t = text(r);
    assert.match(t, /! \[rechazado\]\s+main -> main \(fetch first\)/);
    assert.match(t, /error: falló el push de algunas referencias a 'https:\/\/github\.com\/equipo\/tienda\.git'/);
    assert.match(t, /ayuda: Las actualizaciones fueron rechazadas porque el remoto contiene trabajo que\s+ayuda: no tienes localmente/);
  });

  test('tras rechazo, pull y push funcionan', () => {
    const s = runAll(repoWithRemote(), ['ana-push', 'edit style.css', 'git commit -am "local"', 'git pull']);
    const r = assertOk(s, 'git push');
    assert.equal(r.state.server.branches.main, headId(s));
  });

  test('UNSUPPORTED: push --force', () => {
    assertFails(repoWithRemote(), 'git push --force', 'UNSUPPORTED');
  });

  test('push -u con destino igual al servidor: «Todo actualizado» y fija upstream (§14.1)', () => {
    const base = repoWithRemote();
    const s = deepFreeze({ ...structuredClone(base), repo: { ...structuredClone(base.repo), upstream: {} } });
    const r = assertOk(s, 'git push -u origin main');
    assert.match(text(r), /Todo actualizado/);
    assert.equal(r.changed, true);
    assert.equal(r.state.repo.upstream.main, 'origin/main');
  });
});

describe('git log (§6)', () => {
  test('--oneline con decoraciones HEAD, ramas y origin', () => {
    const s = runAll(repoWithRemote(), ['git branch feature/x']);
    const id = headId(s);
    const r = assertOk(s, 'git log --oneline');
    assert.equal(r.changed, false);
    assert.equal(r.output.length, 1);
    const m = r.output[0].match(/^([0-9a-f]{7}) \((.*)\) Primera versión$/);
    assert.ok(m, `línea inesperada: ${r.output[0]}`);
    assert.equal(m[1], id);
    const deco = m[2].split(', ');
    assert.ok(deco.includes('HEAD -> main'));
    assert.ok(deco.includes('origin/main'));
    assert.ok(deco.includes('feature/x'));
  });

  test('lista del más reciente al más antiguo', () => {
    const s = runAll(freshRepo(), ['edit app.js', 'git commit -am "Segundo"', 'edit app.js', 'git commit -am "Tercero"']);
    const r = assertOk(s, 'git log --oneline');
    assert.deepEqual(r.output.map((l) => l.replace(/^\S+ (\(.*?\) )?/, '')), ['Tercero', 'Segundo', 'Primera versión']);
  });

  test('log completo incluye commit, Author y mensaje', () => {
    const r = assertOk(freshRepo(), 'git log');
    assert.match(r.output[0], /^commit [0-9a-f]{7} \(HEAD -> main\)$/);
    assert.match(r.output[1], /^Author: Andrés/);
    assert.ok(r.output.some((l) => l.includes('Primera versión')));
  });

  test('--all incluye ramas que no son ancestro de HEAD', () => {
    const s = divergent();
    const sinAll = assertOk(s, 'git log --oneline').output.length;
    const conAll = assertOk(s, 'git log --oneline --all').output.length;
    assert.ok(conAll > sinAll);
  });

  test('log en un repo sin commits no rompe', () => {
    const r = git.run(runAll(fresh(), ['git init']), 'git log');
    assert.equal(r.state.repo.head, 'main');
    assert.equal(typeof r.ok, 'boolean');
  });
});

describe('comandos auxiliares (§5.14)', () => {
  test('edit crea una nueva versión del archivo (v+1) y lo deja modificado', () => {
    const s = freshRepo();
    const r = assertOk(s, 'edit app.js');
    assert.equal(r.state.worktree['app.js'], 'app.js@v2');
    assert.equal(r.state.versions['app.js'], 2);
    assert.equal(r.changed, true);
    assert.equal(r.commandId, 'edit');
    assert.deepEqual(getStatus(r.state).unstaged, [{ path: 'app.js', kind: 'modified' }]);
    assert.equal(assertOk(r.state, 'edit app.js').state.worktree['app.js'], 'app.js@v3');
  });

  test('edit funciona también antes de git init', () => {
    const r = assertOk(fresh(), 'edit app.js');
    assert.equal(r.state.worktree['app.js'], 'app.js@v2');
  });

  test('FILE_NOT_FOUND: edit de un archivo inexistente (con consejo de touch)', () => {
    const r = assertFails(freshRepo(), 'edit nada.js', 'FILE_NOT_FOUND');
    assert.match(r.hint, /touch/);
  });

  test('edit sin argumento falla sin cambiar el estado', () => {
    const s = freshRepo();
    const r = git.run(s, 'edit');
    assert.equal(r.ok, false);
    assert.equal(r.state, s);
    assert.equal(r.changed, false);
    assert.ok(r.error?.code);
  });

  test('touch crea un archivo sin seguimiento; si existe no cambia nada', () => {
    const s = freshRepo();
    const r = assertOk(s, 'touch nuevo.js');
    assert.ok('nuevo.js' in r.state.worktree);
    assert.deepEqual(getStatus(r.state).untracked, ['nuevo.js']);
    const otra = assertOk(r.state, 'touch nuevo.js');
    assert.equal(otra.changed, false);
    assert.equal(otra.state, r.state);
    const existente = assertOk(s, 'touch app.js');
    assert.equal(existente.changed, false);
  });

  test('ls lista los archivos', () => {
    const s = runAll(freshRepo(), ['touch zeta.js']);
    const r = assertOk(s, 'ls');
    assert.equal(r.changed, false);
    assert.deepEqual(r.output, ['app.js', 'cart.js', 'style.css', 'zeta.js']);
  });

  test('ana-push sube un commit de Ana sobre server.main; no se ve en local hasta fetch', () => {
    const s = repoWithRemote();
    const r = assertOk(s, 'ana-push cart.js');
    const id = r.state.server.branches.main;
    assert.notEqual(id, s.server.branches.main);
    const c = r.state.objects[id];
    assert.equal(c.author, 'Ana');
    assert.equal(c.message, 'Ana actualiza cart.js');
    assert.deepEqual(c.parents, [s.server.branches.main]);
    assert.notEqual(c.tree['cart.js'], s.server.branches.main && s.objects[s.server.branches.main].tree['cart.js']);
    assert.deepEqual(r.effects, [{ type: 'remote-commit', id }]);
    assert.equal(r.state.repo.tracking['origin/main'], s.server.branches.main, 'el tracking no cambia');
    assert.equal(r.state.repo.branches.main, s.repo.branches.main);
  });

  test('ana-push sin argumento edita app.js', () => {
    const s = repoWithRemote();
    const r = assertOk(s, 'ana-push');
    assert.equal(r.state.objects[r.state.server.branches.main].message, 'Ana actualiza app.js');
  });

  test('ana-push sin main en el servidor → REMOTE_REF_NOT_FOUND (§14.1)', () => {
    const r = assertFails(freshRepo(), 'ana-push', 'REMOTE_REF_NOT_FOUND');
    assert.match(r.hint ?? text(r), /git push -u origin main/);
  });

  test('ana-push de un archivo inexistente en el servidor → FILE_NOT_FOUND (§14.1)', () => {
    assertFails(repoWithRemote(), 'ana-push nada.js', 'FILE_NOT_FOUND');
  });

  test('clear devuelve ui.clear y no cambia el estado', () => {
    const s = freshRepo();
    const r = assertOk(s, 'clear');
    assert.deepEqual(r.ui, { clear: true });
    assert.equal(r.changed, false);
    assert.equal(r.state, s);
  });

  test('help lista comandos y no cambia el estado', () => {
    const s = freshRepo();
    for (const c of ['help', 'git help', 'git --help', 'git']) {
      const r = assertOk(s, c);
      assert.equal(r.commandId, 'help');
      assert.ok(r.output.some((l) => /git init/.test(l)));
      assert.equal(r.state, s);
    }
  });
});

describe('errores de sintaxis a través de run (§3.1, §5.13)', () => {
  test('texto vacío: ok sin cambios y sin salida', () => {
    const s = fresh();
    const r = git.run(s, '   ');
    assert.equal(r.ok, true);
    assert.equal(r.state, s);
    assert.equal(r.changed, false);
    assert.deepEqual(r.output, []);
  });

  test('BAD_SYNTAX / NOT_GIT / UNKNOWN_COMMAND / UNSUPPORTED / INVALID_OPTION / MISSING_ARG con estado idéntico', () => {
    const s = freshRepo();
    assertFails(s, 'git commit -m "sin cerrar', 'BAD_SYNTAX');
    assertFails(s, 'rm -rf /', 'NOT_GIT');
    assertFails(s, 'git comit', 'UNKNOWN_COMMAND');
    assertFails(s, 'git rebase main', 'UNSUPPORTED');
    assertFails(s, 'git commit --foo', 'INVALID_OPTION');
    assertFails(s, 'git commit -m', 'MISSING_ARG');
  });

  test('un Result siempre tiene todos los campos del contrato (§3.1)', () => {
    const s = freshRepo();
    for (const c of ['git status', 'git foo', 'ls', 'clear', '', 'git add x']) {
      const r = git.run(s, c);
      for (const k of ['ok', 'state', 'changed', 'commandId', 'output', 'error', 'hint', 'notes', 'effects', 'ui']) {
        assert.ok(k in r, `falta '${k}' en el resultado de '${c}'`);
      }
      assert.ok(Array.isArray(r.output) && Array.isArray(r.notes) && Array.isArray(r.effects));
    }
  });

  test('ok:false implica error con code y message; ok:true implica error null', () => {
    const s = freshRepo();
    const mal = git.run(s, 'git add x');
    assert.equal(typeof mal.error.code, 'string');
    assert.equal(typeof mal.error.message, 'string');
    assert.equal(git.run(s, 'git status').error, null);
  });
});

describe('derivados (§4.1)', () => {
  test('headCommit y headTree sin commits', () => {
    const s = runAll(fresh(), ['git init']);
    assert.equal(headCommit(s), null);
    assert.deepEqual(headTree(s), {});
  });

  test('headCommit y headTree con commits', () => {
    const s = freshRepo();
    assert.equal(headCommit(s), headId(s));
    assert.deepEqual(headTree(s), s.objects[headId(s)].tree);
  });

  test('prompt: carpeta antes de init y (rama) después', () => {
    assert.equal(git.prompt(fresh()), '~/tienda $');
    assert.equal(git.prompt(freshRepo()), '(main) $');
    assert.equal(git.prompt(runAll(freshRepo(), ['git switch -c dev'])), '(dev) $');
  });
});
