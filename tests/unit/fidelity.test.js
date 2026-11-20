// Tests de regresión de fidelidad a Git (ajustes del maestro tras la revisión de QA).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import gitModule from '../../site/js/modules/git/index.js';
import { levenshtein, suggest } from '../../site/js/modules/git/parser.js';
import { deepFreeze } from '../helpers/git.js';

/** Ejecuta comandos encadenados y devuelve el último resultado. */
function runSeq(cmds) {
  let state = gitModule.createInitialState();
  let result = null;
  for (const text of cmds) {
    result = gitModule.run(deepFreeze(state), text);
    state = result.state;
  }
  return result;
}

describe('sugerencias de comandos desconocidos', () => {
  test('una transposición de letras cuenta como un solo error (psuh → push)', () => {
    assert.equal(levenshtein('psuh', 'push'), 1);
    assert.equal(suggest('psuh'), 'push');
  });

  test('las erratas habituales siguen sugiriendo el comando correcto', () => {
    assert.equal(suggest('comit'), 'commit');
    assert.equal(suggest('stauts'), 'status');
    assert.equal(suggest('brnach'), 'branch');
  });

  test('palabras sin parecido real no reciben sugerencia (foo no sugiere log)', () => {
    assert.equal(suggest('foo'), null);
    const r = runSeq(['git foo']);
    assert.equal(r.error.code, 'UNKNOWN_COMMAND');
    assert.ok(!r.output.join('\n').includes('El comando más parecido'));
  });

  test('git edit avisa de que edit es un ayudante del simulador y no de Git', () => {
    const r = runSeq(['git edit app.js']);
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'UNKNOWN_COMMAND');
    assert.match(r.hint, /ayudante del simulador/);
    assert.match(r.hint, /edit app\.js/);
  });
});

describe('remoto con nombre inexistente', () => {
  const base = ['git init', 'git add .', 'git commit -m "uno"'];

  test('push a un remoto inexistente sin remotos configurados da el error real de Git', () => {
    const r = runSeq([...base, 'git push foo main']);
    assert.equal(r.error.code, 'NO_REMOTE');
    assert.match(r.output[0], /'foo' no parece ser un repositorio git/);
  });

  test('fetch y pull a un remoto inexistente dan el mismo error', () => {
    for (const cmd of ['git fetch foo', 'git pull foo main']) {
      const r = runSeq([...base, cmd]);
      assert.equal(r.error.code, 'NO_REMOTE', cmd);
      assert.match(r.output[0], /'foo' no parece ser un repositorio git/, cmd);
    }
  });

  test('push sin nombre y sin remotos sigue explicando cómo configurar uno', () => {
    const r = runSeq([...base, 'git push']);
    assert.equal(r.error.code, 'NO_REMOTE');
    assert.match(r.output.join('\n'), /git remote add <nombre> <url>/);
  });
});
