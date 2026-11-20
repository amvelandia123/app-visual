// Tests unitarios del controlador genérico (ARCHITECTURE §8).
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import git from '../../site/js/modules/git/index.js';
import { createController } from '../../site/js/core/controller.js';

const mk = () => createController(git);
const kinds = (log) => log.map((e) => e.kind);

describe('estado inicial', () => {
  test('arranca en el paso 0, modo guiado, sin offScript', () => {
    const snap = mk().getSnapshot();
    assert.equal(snap.step, 0);
    assert.equal(snap.total, 10);
    assert.equal(snap.mode, 'guided');
    assert.equal(snap.offScript, false);
    assert.deepEqual(snap.state, git.createInitialState());
    assert.equal(snap.lastCommandId, null);
    assert.equal(snap.lastResult, null);
    assert.equal(snap.lastStep, null);
  });

  test('el log inicial es el mensaje de bienvenida (kind system)', () => {
    const { log } = mk().getSnapshot();
    assert.ok(log.length > 0);
    assert.ok(log.every((e) => e.kind === 'system' && e.text));
    assert.deepEqual(log.map((e) => e.text), git.data.scenario.intro);
  });

  test('getSnapshot devuelve una copia del log (no se puede corromper desde fuera)', () => {
    const c = mk();
    c.getSnapshot().log.push({ kind: 'x', text: 'y' });
    assert.equal(c.getSnapshot().log.some((e) => e.kind === 'x'), false);
  });
});

describe('next (§8)', () => {
  test('avanza un paso, ejecuta el comando y anota command + output', () => {
    const c = mk();
    const t = c.next();
    const snap = c.getSnapshot();
    assert.equal(snap.step, 1);
    assert.equal(snap.mode, 'guided');
    assert.equal(snap.lastCommandId, 'init');
    assert.equal(snap.lastStep.id, 'init');
    assert.equal(t.length, 1);
    assert.equal(t[0].kind, 'command');
    assert.equal(t[0].text, 'git init');
    const cmd = snap.log.find((e) => e.kind === 'command');
    assert.deepEqual(cmd, { kind: 'command', text: 'git init', prompt: '~/tienda $' });
    assert.ok(snap.log.some((e) => e.kind === 'output' && /Inicializado repositorio Git vacío/.test(e.text)));
  });

  test('el paso con preparación emite transiciones pre y una command final', () => {
    const c = mk();
    for (let i = 0; i < 6; i++) c.next();
    const t = c.next(); // paso 7: 5 previos + merge
    assert.deepEqual(t.map((x) => x.kind), ['pre', 'pre', 'pre', 'pre', 'pre', 'command']);
    assert.deepEqual(t.map((x) => x.text), [
      ...git.data.scenario.steps[6].before.map((b) => b.command), 'git merge feature/carrito',
    ]);
  });

  test('cada transición enlaza from → to y todas son ok', () => {
    const c = mk();
    for (let i = 0; i < 6; i++) c.next();
    const t = c.next();
    for (let i = 0; i < t.length; i++) {
      assert.equal(t[i].result.ok, true);
      if (i > 0) assert.equal(t[i].from, t[i - 1].to, 'el from de cada transición es el to de la anterior');
    }
    assert.equal(t.at(-1).to, c.getSnapshot().state);
  });

  test('las narraciones de los before van al log como narration; la del paso no (§14.1)', () => {
    const c = mk();
    for (let i = 0; i < 7; i++) c.next();
    const { log, lastStep } = c.getSnapshot();
    const narr = log.filter((e) => e.kind === 'narration').map((e) => e.text);
    for (const b of git.data.scenario.steps[6].before.filter((x) => x.narration)) assert.ok(narr.includes(b.narration));
    assert.equal(narr.includes(lastStep.narration), false);
    assert.ok(lastStep.narration.length > 0, 'la narración principal está en lastStep');
  });

  test('el log contiene command, output, hint, note y error donde corresponde', () => {
    const c = mk();
    c.next(); // init: lleva nota de simplificación
    let kindsSeen = new Set(kinds(c.getSnapshot().log));
    assert.ok(kindsSeen.has('command') && kindsSeen.has('output') && kindsSeen.has('note') && kindsSeen.has('system'));
    c.run('git add');
    kindsSeen = new Set(kinds(c.getSnapshot().log));
    assert.ok(kindsSeen.has('error') && kindsSeen.has('hint'));
  });

  test('al final (paso 10) next devuelve [] y no cambia nada', () => {
    const c = mk();
    for (let i = 0; i < 10; i++) c.next();
    const antes = c.getSnapshot();
    let llamadas = 0;
    c.subscribe(() => llamadas++);
    assert.deepEqual(c.next(), []);
    assert.equal(llamadas, 0, 'no notifica si no hay nada que hacer');
    const despues = c.getSnapshot();
    assert.equal(despues.step, 10);
    assert.deepEqual(despues.state, antes.state);
    assert.equal(despues.log.length, antes.log.length);
  });

  test('el lastResult del paso 10 es el push', () => {
    const c = mk();
    for (let i = 0; i < 10; i++) c.next();
    assert.equal(c.getSnapshot().lastCommandId, 'push');
  });
});

describe('prev y goTo (§8)', () => {
  test('prev en el paso 0 devuelve [] y no notifica', () => {
    const c = mk();
    let n = 0;
    c.subscribe(() => n++);
    assert.deepEqual(c.prev(), []);
    assert.equal(n, 0);
    assert.equal(c.getSnapshot().step, 0);
  });

  test('prev baja un paso con UNA transición jump', () => {
    const c = mk();
    c.next(); c.next(); c.next();
    const t = c.prev();
    assert.equal(t.length, 1);
    assert.equal(t[0].kind, 'jump');
    assert.equal(c.getSnapshot().step, 2);
  });

  test('goTo(n) reconstruye el estado del paso n (igual que avanzar con next)', () => {
    const a = mk();
    for (let i = 0; i < 7; i++) a.next();
    const b = mk();
    const t = b.goTo(7);
    assert.deepEqual(t.map((x) => x.kind), ['jump']);
    assert.deepEqual(b.getSnapshot().state, a.getSnapshot().state);
    assert.equal(b.getSnapshot().step, 7);
    assert.deepEqual(b.getSnapshot().log, a.getSnapshot().log);
    assert.equal(b.getSnapshot().lastCommandId, 'merge');
  });

  test('goTo hacia atrás: replay idéntico (deepEqual) al estado original de ese paso', () => {
    const c = mk();
    const guardados = [c.getSnapshot().state];
    for (let i = 0; i < 10; i++) { c.next(); guardados.push(c.getSnapshot().state); }
    for (const n of [9, 5, 1, 0, 10, 3]) {
      c.goTo(n);
      assert.deepEqual(c.getSnapshot().state, guardados[n], `paso ${n}`);
      assert.equal(c.getSnapshot().step, n);
    }
  });

  test('goTo(0) deja el estado inicial con el log de bienvenida', () => {
    const c = mk();
    c.next(); c.next();
    c.goTo(0);
    const snap = c.getSnapshot();
    assert.deepEqual(snap.state, git.createInitialState());
    assert.deepEqual(snap.log.map((e) => e.text), git.data.scenario.intro);
    assert.equal(snap.lastStep, null);
  });

  test('la transición jump lleva from y to', () => {
    const c = mk();
    c.next(); c.next();
    const from = c.getSnapshot().state;
    const [t] = c.goTo(5);
    assert.equal(t.from, from);
    assert.equal(t.to, c.getSnapshot().state);
  });

  test('goTo limita el rango a 0..total y tolera valores raros', () => {
    const c = mk();
    c.goTo(99);
    assert.equal(c.getSnapshot().step, 10);
    c.goTo(-5);
    assert.equal(c.getSnapshot().step, 0);
    c.goTo('3');
    assert.equal(c.getSnapshot().step, 3);
    c.goTo(NaN);
    assert.equal(c.getSnapshot().step, 0);
  });

  test('tras goTo(n), next continúa en n+1', () => {
    const c = mk();
    c.goTo(4);
    c.next();
    assert.equal(c.getSnapshot().step, 5);
    assert.equal(c.getSnapshot().lastCommandId, 'branch');
  });
});

describe('reset (§8)', () => {
  test('vuelve al estado inicial, paso 0, log de bienvenida y transición reset', () => {
    const c = mk();
    for (let i = 0; i < 4; i++) c.next();
    c.run('touch x.js');
    const from = c.getSnapshot().state;
    const t = c.reset();
    assert.equal(t.length, 1);
    assert.equal(t[0].kind, 'reset');
    assert.equal(t[0].from, from);
    const snap = c.getSnapshot();
    assert.equal(t[0].to, snap.state);
    assert.deepEqual(snap.state, git.createInitialState());
    assert.equal(snap.step, 0);
    assert.equal(snap.mode, 'guided');
    assert.equal(snap.offScript, false);
    assert.equal(snap.lastResult, null);
    assert.deepEqual(snap.log.map((e) => e.kind), ['system', 'system', 'system']);
  });

  test('después de reset el escenario vuelve a dar los mismos estados', () => {
    const c = mk();
    for (let i = 0; i < 10; i++) c.next();
    const finalA = c.getSnapshot().state;
    c.reset();
    for (let i = 0; i < 10; i++) c.next();
    assert.deepEqual(c.getSnapshot().state, finalA);
  });
});

describe('run: modo libre (§8)', () => {
  test('un comando válido activa modo libre y offScript', () => {
    const c = mk();
    const t = c.run('git init');
    const snap = c.getSnapshot();
    assert.equal(snap.mode, 'free');
    assert.equal(snap.offScript, true);
    assert.equal(snap.lastStep, null);
    assert.equal(snap.step, 0, 'el paso guiado no cambia');
    assert.equal(snap.lastCommandId, 'init');
    assert.equal(t.length, 1);
    assert.equal(t[0].kind, 'command');
    assert.equal(t[0].text, 'git init');
    assert.equal(t[0].result.ok, true);
    assert.ok(snap.state.repo);
  });

  test('el log anota el comando con el prompt previo y su salida', () => {
    const c = mk();
    c.run('git init');
    c.run('git status');
    const cmds = c.getSnapshot().log.filter((e) => e.kind === 'command');
    assert.deepEqual(cmds, [
      { kind: 'command', text: 'git init', prompt: '~/tienda $' },
      { kind: 'command', text: 'git status', prompt: '(main) $' },
    ]);
  });

  test('un error va al log como error + hint y el estado no cambia', () => {
    const c = mk();
    const antes = c.getSnapshot().state;
    const t = c.run('git status');
    const snap = c.getSnapshot();
    assert.equal(snap.state, antes);
    assert.equal(t[0].result.ok, false);
    assert.equal(t[0].result.error.code, 'NOT_A_REPO');
    assert.equal(t[0].from, t[0].to);
    const errs = snap.log.filter((e) => e.kind === 'error');
    assert.ok(errs.some((e) => /no es un repositorio git/.test(e.text)));
    assert.ok(snap.log.some((e) => e.kind === 'hint'));
    assert.equal(snap.lastResult.error.code, 'NOT_A_REPO');
    assert.equal(snap.mode, 'free');
  });

  test('una entrada vacía se ignora: [] y sin notificar', () => {
    const c = mk();
    let n = 0;
    c.subscribe(() => n++);
    assert.deepEqual(c.run(''), []);
    assert.deepEqual(c.run('   '), []);
    assert.deepEqual(c.run(undefined), []);
    assert.equal(n, 0);
    assert.equal(c.getSnapshot().mode, 'guided');
  });

  test('las notas del resultado van al log como note', () => {
    const c = mk();
    c.run('git init');
    assert.ok(c.getSnapshot().log.some((e) => e.kind === 'note' && /init\.defaultBranch=main/.test(e.text)));
  });

  test('las líneas vacías de la salida se conservan con text vacío (§14.1)', () => {
    const c = mk();
    c.run('git init');
    c.run('git status');
    assert.ok(c.getSnapshot().log.some((e) => e.kind === 'output' && e.text === ''));
  });

  test('clear vacía el log (y el propio comando no queda)', () => {
    const c = mk();
    c.run('git init');
    c.run('git status');
    assert.ok(c.getSnapshot().log.length > 3);
    const t = c.run('clear');
    assert.equal(t[0].result.ui.clear, true);
    assert.deepEqual(c.getSnapshot().log, [] );
  });

  test('tras clear, lo siguiente se anota normalmente', () => {
    const c = mk();
    c.run('clear');
    c.run('ls');
    assert.deepEqual(kinds(c.getSnapshot().log), ['command', 'output', 'output', 'output']);
  });

  test('el estado del modo libre evoluciona con varios comandos', () => {
    const c = mk();
    for (const t of ['git init', 'git add .', 'git commit -m "hola"']) c.run(t);
    assert.equal(Object.keys(c.getSnapshot().state.objects).length, 1);
    assert.equal(c.getSnapshot().lastCommandId, 'commit');
  });
});

describe('offScript y vuelta al guion (§8)', () => {
  test('next tras modo libre emite primero una transición jump y luego el paso', () => {
    const c = mk();
    c.next(); c.next(); // paso 2
    const estadoPaso2 = c.getSnapshot().state;
    c.run('git add .');
    c.run('touch otro.js');
    assert.equal(c.getSnapshot().offScript, true);
    const t = c.next();
    assert.deepEqual(t.map((x) => x.kind), ['jump', 'command']);
    assert.deepEqual(t[0].to, estadoPaso2, 'el jump reconstruye el estado del paso 2');
    assert.equal(t[1].text, 'git add .');
    const snap = c.getSnapshot();
    assert.equal(snap.step, 3);
    assert.equal(snap.mode, 'guided');
    assert.equal(snap.offScript, false);
    assert.equal('otro.js' in snap.state.worktree, false, 'lo hecho en modo libre se descarta');
  });

  test('el log al volver al guion añade el mensaje system «Volviendo al escenario guiado»', () => {
    const c = mk();
    c.next();
    c.run('ls');
    c.next();
    const log = c.getSnapshot().log;
    const i = log.findIndex((e) => e.kind === 'system' && /Volviendo al escenario guiado/.test(e.text));
    assert.ok(i > 0);
    assert.ok(log.slice(i + 1).some((e) => e.kind === 'command' && e.text === 'git status'));
    assert.ok(log.some((e) => e.kind === 'command' && e.text === 'ls'), 'el historial libre se conserva en el log');
  });

  test('un fallo en modo libre también deja offScript', () => {
    const c = mk();
    c.run('git foo');
    assert.equal(c.getSnapshot().offScript, true);
  });

  test('goTo y reset limpian offScript', () => {
    const c = mk();
    c.run('ls');
    c.goTo(2);
    assert.equal(c.getSnapshot().offScript, false);
    c.run('ls');
    c.reset();
    assert.equal(c.getSnapshot().offScript, false);
  });

  test('next sin offScript NO emite jump', () => {
    const c = mk();
    assert.equal(c.next().some((x) => x.kind === 'jump'), false);
  });
});

describe('subscribe (§8)', () => {
  test('se notifica UNA vez por acción con (snapshot, transiciones)', () => {
    const c = mk();
    const llamadas = [];
    c.subscribe((snap, trans) => llamadas.push({ snap, trans }));
    c.next();
    assert.equal(llamadas.length, 1);
    assert.equal(llamadas[0].snap.step, 1);
    assert.equal(llamadas[0].trans.length, 1);
    for (let i = 0; i < 6; i++) c.next();
    assert.equal(llamadas.length, 7, 'una por next, aunque el paso 7 tenga 6 transiciones');
    assert.equal(llamadas.at(-1).trans.length, 6);
    c.run('ls');
    assert.equal(llamadas.length, 8);
    c.goTo(2);
    assert.equal(llamadas.length, 9);
    c.prev();
    assert.equal(llamadas.length, 10);
    c.reset();
    assert.equal(llamadas.length, 11);
  });

  test('la notificación llega después de calcularlo todo (snapshot ya final)', () => {
    const c = mk();
    c.next(); c.next(); c.next(); c.next(); c.next(); c.next();
    let visto;
    c.subscribe((snap, trans) => { visto = { step: snap.step, to: trans.at(-1).to, state: snap.state }; });
    c.next();
    assert.equal(visto.step, 7);
    assert.equal(visto.to, visto.state);
  });

  test('unsubscribe deja de notificar', () => {
    const c = mk();
    let n = 0;
    const off = c.subscribe(() => n++);
    c.next();
    assert.equal(n, 1);
    off();
    c.next();
    c.run('ls');
    c.reset();
    assert.equal(n, 1);
  });

  test('varios suscriptores independientes', () => {
    const c = mk();
    let a = 0; let b = 0;
    const offA = c.subscribe(() => a++);
    c.subscribe(() => b++);
    c.next();
    offA();
    c.next();
    assert.deepEqual([a, b], [1, 2]);
  });

  test('un suscriptor que se da de baja durante la notificación no rompe a los demás', () => {
    const c = mk();
    let b = 0;
    const off = c.subscribe(() => off());
    c.subscribe(() => b++);
    assert.doesNotThrow(() => c.next());
    assert.equal(b, 1);
  });
});

describe('determinismo del controlador', () => {
  test('dos controladores con las mismas acciones terminan idénticos', () => {
    const a = mk();
    const b = mk();
    for (const c of [a, b]) {
      c.next(); c.next(); c.run('git init'); c.next(); c.goTo(8); c.run('git status'); c.prev();
    }
    assert.deepEqual(a.getSnapshot(), b.getSnapshot());
  });

  test('el controlador es genérico: funciona con un módulo mínimo falso', () => {
    const fake = {
      createInitialState: () => ({ n: 0 }),
      run: (s, text) => (text === 'inc'
        ? { ok: true, state: { n: s.n + 1 }, changed: true, commandId: 'inc', output: [`n=${s.n + 1}`], error: null, hint: null, notes: [], effects: [], ui: null }
        : { ok: false, state: s, changed: false, commandId: null, output: ['mal'], error: { code: 'X', message: 'mal' }, hint: null, notes: [], effects: [], ui: null }),
      prompt: () => '$',
      data: { scenario: { intro: ['hola'], steps: [{ id: 'a', command: 'inc', before: [] }, { id: 'b', command: 'inc', before: [{ command: 'inc' }] }] } },
    };
    const c = createController(fake);
    c.next(); c.next();
    assert.equal(c.getSnapshot().state.n, 3);
    assert.equal(c.getSnapshot().total, 2);
    c.goTo(1);
    assert.equal(c.getSnapshot().state.n, 1);
    c.run('zzz');
    assert.equal(c.getSnapshot().log.at(-1).kind, 'error');
  });

  test('si un paso del escenario falla, next lanza (es un bug del escenario, §8)', () => {
    const roto = {
      createInitialState: () => ({}),
      run: (s) => ({ ok: false, state: s, changed: false, commandId: null, output: ['x'], error: { code: 'X', message: 'boom' }, hint: null, notes: [], effects: [], ui: null }),
      prompt: () => '$',
      data: { scenario: { intro: [], steps: [{ id: 'a', command: 'x', before: [] }] } },
    };
    assert.throws(() => createController(roto).next(), /Escenario roto/);
  });
});
