// Tests unitarios del parser (ARCHITECTURE §6 y §14.1).
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { parse, tokenize, levenshtein } from '../../site/js/modules/git/parser.js';

const cmd = (text) => {
  const r = parse(text);
  assert.equal(r.ok, true, `'${text}' debía parsear: ${r.error?.message}`);
  return r.cmd;
};
const fail = (text, code) => {
  const r = parse(text);
  assert.equal(r.ok, false, `'${text}' debía fallar con ${code}`);
  assert.equal(r.error.code, code);
  assert.equal(typeof r.error.message, 'string');
  assert.ok(Array.isArray(r.output) && r.output.length > 0, 'los errores llevan output (§14.1)');
  return r;
};

describe('tokenizado y comillas (§6)', () => {
  test('tokeniza separando por espacios', () => {
    assert.deepEqual(tokenize('git commit -m x').tokens, ['git', 'commit', '-m', 'x']);
  });

  test('comillas dobles y simples agrupan palabras', () => {
    assert.equal(cmd('git commit -m "hola mundo"').flags.message, 'hola mundo');
    assert.equal(cmd("git commit -m 'hola mundo'").flags.message, 'hola mundo');
  });

  test('una comilla de otro tipo dentro de comillas se respeta', () => {
    assert.equal(cmd(`git commit -m "it's ok"`).flags.message, "it's ok");
  });

  test('cadena vacía entre comillas es un token vacío', () => {
    assert.deepEqual(tokenize('a "" b').tokens, ['a', '', 'b']);
  });

  test('comilla doble sin cerrar → BAD_SYNTAX', () => {
    const r = fail('git commit -m "sin cerrar', 'BAD_SYNTAX');
    assert.match(r.error.message, /comilla doble sin cerrar/);
    assert.ok(r.hint);
  });

  test('comilla simple sin cerrar → BAD_SYNTAX', () => {
    fail("git commit -m 'sin cerrar", 'BAD_SYNTAX');
  });

  test('línea vacía → BAD_SYNTAX', () => {
    fail('', 'BAD_SYNTAX');
    fail('   ', 'BAD_SYNTAX');
  });
});

describe('mayúsculas y espacios', () => {
  test('espacios extra al principio, al final y entre palabras', () => {
    const c = cmd('   git    status   ');
    assert.equal(c.program, 'git');
    assert.equal(c.sub, 'status');
    assert.deepEqual(c.args, []);
  });

  test('tabuladores también separan', () => {
    assert.equal(cmd('git\tadd\t.').sub, 'add');
  });

  test('el texto original se conserva en cmd.raw', () => {
    assert.equal(cmd('  git status ').raw, '  git status ');
  });

  // Ambigüedad: el contrato (§6) no dice si el parser distingue mayúsculas. Git real sí las distingue;
  // aquí se documenta el comportamiento actual (sensible a mayúsculas) y no se cuenta como fallo.
  test('mayúsculas: «git STATUS» es un subcomando desconocido, como en Git real (ambigüedad §6)', () => {
    fail('git STATUS', 'UNKNOWN_COMMAND');
  });

  test('mayúsculas: «GIT status» no es el programa git (NOT_GIT) (ambigüedad §6)', () => {
    fail('GIT status', 'NOT_GIT');
  });
});

describe('opciones de commit', () => {
  test('-m con valor separado', () => {
    assert.deepEqual(cmd('git commit -m hola').flags, { message: 'hola', all: false });
  });

  test('-am combina -a y -m', () => {
    assert.deepEqual(cmd('git commit -am "msg"').flags, { message: 'msg', all: true });
  });

  test('-a -m por separado', () => {
    assert.deepEqual(cmd('git commit -a -m msg').flags, { message: 'msg', all: true });
  });

  test('-m=valor', () => {
    assert.equal(cmd('git commit -m=hola').flags.message, 'hola');
  });

  test('-mvalor pegado', () => {
    assert.equal(cmd('git commit -mhola').flags.message, 'hola');
  });

  test('--message=valor y --message valor', () => {
    assert.equal(cmd('git commit --message=hola').flags.message, 'hola');
    assert.equal(cmd('git commit --message hola').flags.message, 'hola');
  });

  test('--all equivale a -a', () => {
    assert.equal(cmd('git commit --all -m x').flags.all, true);
  });

  test('sin -m el mensaje es null (el motor decide NEEDS_MESSAGE)', () => {
    assert.equal(cmd('git commit').flags.message, null);
  });

  test('-m sin valor → MISSING_ARG', () => {
    fail('git commit -m', 'MISSING_ARG');
    fail('git commit --message', 'MISSING_ARG');
  });

  test('mensaje sin comillas con espacios → PATHSPEC con consejo de comillas (§14.1)', () => {
    const r = fail('git commit -m hola mundo', 'PATHSPEC');
    assert.match(r.hint, /comillas/);
  });
});

describe('flags normalizadas por subcomando (§6)', () => {
  test('switch -c y checkout -b → create', () => {
    assert.deepEqual(cmd('git switch -c x'), { program: 'git', sub: 'switch', args: ['x'], flags: { create: true }, raw: 'git switch -c x' });
    assert.equal(cmd('git checkout -b x').flags.create, true);
    assert.equal(cmd('git switch x').flags.create, false);
  });

  test('branch: -d, -D (delete+force)', () => {
    assert.deepEqual(cmd('git branch -d x').flags, { delete: true, force: false });
    assert.deepEqual(cmd('git branch -D x').flags, { delete: true, force: true });
    assert.deepEqual(cmd('git branch').flags, { delete: false, force: false });
  });

  test('merge --no-ff', () => {
    assert.equal(cmd('git merge --no-ff x').flags.noFf, true);
    assert.equal(cmd('git merge x').flags.noFf, false);
    assert.deepEqual(cmd('git merge x').args, ['x']);
  });

  test('stash: acciones y opciones', () => {
    assert.deepEqual(cmd('git stash').flags, { action: 'push', message: null, includeUntracked: false });
    for (const a of ['push', 'pop', 'apply', 'list', 'drop']) assert.equal(cmd(`git stash ${a}`).flags.action, a);
    assert.equal(cmd('git stash -u').flags.includeUntracked, true);
    assert.equal(cmd('git stash --include-untracked').flags.includeUntracked, true);
    assert.equal(cmd('git stash push -m "a b"').flags.message, 'a b');
    assert.deepEqual(cmd('git stash pop stash@{1}').args, ['stash@{1}']);
  });

  test('stash con subcomando desconocido → BAD_SYNTAX', () => {
    fail('git stash foo', 'BAD_SYNTAX');
  });

  test('push -u / --set-upstream', () => {
    assert.deepEqual(cmd('git push -u origin main'), { program: 'git', sub: 'push', args: ['origin', 'main'], flags: { setUpstream: true }, raw: 'git push -u origin main' });
    assert.equal(cmd('git push --set-upstream origin main').flags.setUpstream, true);
    assert.equal(cmd('git push').flags.setUpstream, false);
  });

  test('remote: list, -v y add', () => {
    assert.deepEqual(cmd('git remote').flags, { action: 'list', verbose: false });
    assert.deepEqual(cmd('git remote -v').flags, { action: 'list', verbose: true });
    const a = cmd('git remote add origin https://x/y.git');
    assert.equal(a.flags.action, 'add');
    assert.deepEqual(a.args, ['origin', 'https://x/y.git']);
  });

  test('log: --oneline y --all', () => {
    assert.deepEqual(cmd('git log').flags, { oneline: false, all: false });
    assert.deepEqual(cmd('git log --oneline --all').flags, { oneline: true, all: true });
  });

  test('add: rutas, . y -A/--all', () => {
    assert.deepEqual(cmd('git add .').args, ['.']);
    assert.deepEqual(cmd('git add a.js b.js').args, ['a.js', 'b.js']);
    assert.equal(cmd('git add -A').flags.all, true);
    assert.equal(cmd('git add --all').flags.all, true);
  });

  test('init, status, fetch y pull se parsean', () => {
    for (const s of ['init', 'status', 'fetch', 'pull']) assert.equal(cmd(`git ${s}`).sub, s);
    assert.deepEqual(cmd('git pull origin main').args, ['origin', 'main']);
  });

  test('«--» fuerza que lo siguiente sean argumentos', () => {
    assert.deepEqual(cmd('git branch -- -x').args, ['-x']);
  });
});

describe('errores del parser', () => {
  test('INVALID_OPTION: flag larga desconocida', () => {
    const r = fail('git commit --foo', 'INVALID_OPTION');
    assert.match(r.error.message, /opción desconocida '--foo'/);
  });

  test('INVALID_OPTION: flag corta desconocida', () => {
    fail('git status -s', 'INVALID_OPTION');
    fail('git commit -x', 'INVALID_OPTION');
  });

  test('INVALID_OPTION: --flag=valor en una opción sin valor', () => {
    fail('git status --foo=1', 'INVALID_OPTION');
    fail('git commit --all=1', 'INVALID_OPTION');
  });

  test('INVALID_OPTION: opción antes del subcomando', () => {
    fail('git --version', 'INVALID_OPTION');
  });

  test('BAD_SYNTAX: demasiados argumentos', () => {
    fail('git init extra', 'BAD_SYNTAX');
    fail('git status a b', 'BAD_SYNTAX');
    fail('git branch a b', 'BAD_SYNTAX');
  });

  test('UNKNOWN_COMMAND con sugerencia (comit → commit)', () => {
    const r = fail('git comit', 'UNKNOWN_COMMAND');
    assert.equal(r.error.message, "git: 'comit' no es un comando de git. Mira 'git --help'.");
    assert.deepEqual(r.output, [r.error.message, '', 'El comando más parecido es', '\tcommit']);
    assert.match(r.hint, /git commit/);
  });

  test('UNKNOWN_COMMAND con otras erratas', () => {
    assert.ok(fail('git statu', 'UNKNOWN_COMMAND').output.includes('\tstatus'));
    assert.ok(fail('git brnach', 'UNKNOWN_COMMAND').output.includes('\tbranch'));
    assert.ok(fail('git psuh', 'UNKNOWN_COMMAND').output.includes('\tpush'));
  });

  test('UNKNOWN_COMMAND sin sugerencia cuando nada se parece', () => {
    const r = fail('git zzzzzzzz', 'UNKNOWN_COMMAND');
    assert.equal(r.output.length, 1);
    assert.equal(r.output.includes('El comando más parecido es'), false);
  });

  for (const sub of ['restore', 'reset', 'rebase', 'diff', 'rm', 'mv', 'clone', 'tag', 'cherry-pick', 'revert', 'show']) {
    test(`UNSUPPORTED: git ${sub}`, () => {
      const r = fail(`git ${sub} algo`, 'UNSUPPORTED');
      assert.match(r.error.message, /aún no está en el simulador v1/);
    });
  }

  test('UNSUPPORTED: push --force/-f y pull --rebase (§14.1)', () => {
    fail('git push --force', 'UNSUPPORTED');
    fail('git push -f', 'UNSUPPORTED');
    fail('git push --force-with-lease', 'UNSUPPORTED');
    fail('git pull --rebase', 'UNSUPPORTED');
  });

  test('UNSUPPORTED: remote con subcomando no soportado', () => {
    fail('git remote remove origin', 'UNSUPPORTED');
  });

  test('NOT_GIT: programas que no son git ni ayudantes', () => {
    for (const t of ['npm install', 'rm -rf /', 'cd ..', 'status']) fail(t, 'NOT_GIT');
  });
});

describe('ayudantes y atajos', () => {
  test('edit, touch, ls, ana-push, help, clear', () => {
    assert.deepEqual(cmd('edit app.js'), { program: 'edit', sub: null, args: ['app.js'], flags: {}, raw: 'edit app.js' });
    assert.equal(cmd('touch nuevo.js').program, 'touch');
    assert.equal(cmd('ls').program, 'ls');
    assert.deepEqual(cmd('ana-push cart.js').args, ['cart.js']);
    assert.deepEqual(cmd('ana-push').args, []);
    assert.equal(cmd('help').program, 'help');
    assert.equal(cmd('clear').program, 'clear');
  });

  test('«ls -la» ignora las opciones', () => {
    assert.deepEqual(cmd('ls -la').args, []);
  });

  test('«git», «git help» y «git --help» equivalen a help (§14.1)', () => {
    for (const t of ['git', 'git help', 'git --help', 'git -h']) assert.equal(cmd(t).program, 'help');
  });
});

describe('utilidades', () => {
  test('levenshtein', () => {
    assert.equal(levenshtein('comit', 'commit'), 1);
    assert.equal(levenshtein('', 'abc'), 3);
    assert.equal(levenshtein('igual', 'igual'), 0);
    assert.equal(levenshtein('kitten', 'sitting'), 3);
  });

  test('parse es una función pura: misma entrada, mismo resultado', () => {
    assert.deepEqual(parse('git commit -am "x"'), parse('git commit -am "x"'));
  });

  test('parse(undefined) no lanza', () => {
    assert.equal(parse(undefined).ok, false);
  });
});
