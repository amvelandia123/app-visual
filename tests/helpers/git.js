// Utilidades compartidas por los tests unitarios del módulo Git.
import assert from 'node:assert/strict';
import git from '../../site/js/modules/git/index.js';

export { git };

/** Congela recursivamente un objeto (detecta mutaciones accidentales del motor). */
export function deepFreeze(obj) {
  if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const k of Object.keys(obj)) deepFreeze(obj[k]);
  }
  return obj;
}

/** Estado inicial congelado. */
export function fresh() {
  return deepFreeze(git.createInitialState());
}

/** Ejecuta un comando sobre un estado (congelado) y devuelve el Result. */
export function run(state, text) {
  return git.run(deepFreeze(state), text);
}

/** Encadena comandos; falla si alguno no es ok. Devuelve el estado final (congelado). */
export function runAll(state, cmds) {
  let s = deepFreeze(state);
  for (const c of cmds) {
    const r = git.run(s, c);
    assert.equal(r.ok, true, `El comando '${c}' debía ir bien: ${r.error ? r.error.message : ''}`);
    s = deepFreeze(r.state);
  }
  return s;
}

/** Repo con init + add . + commit raíz ya hechos. */
export function freshRepo() {
  return runAll(fresh(), ['git init', 'git add .', 'git commit -m "Primera versión"']);
}

/** Repo con remoto configurado y main publicado con -u. */
export function repoWithRemote() {
  return runAll(freshRepo(), ['git remote add origin https://github.com/equipo/tienda.git', 'git push -u origin main']);
}

/** Comprueba que un comando falla con el código dado y deja el estado intacto. */
export function assertFails(state, text, code) {
  deepFreeze(state);
  const r = git.run(state, text);
  assert.equal(r.ok, false, `'${text}' debía fallar con ${code}`);
  assert.equal(r.state, state, 'un fallo debe devolver el mismo objeto de estado');
  assert.equal(r.changed, false);
  assert.equal(r.error?.code, code);
  assert.ok(r.output.length > 0, 'un fallo debe tener salida');
  return r;
}

/** Comprueba que un comando va bien y devuelve el Result. */
export function assertOk(state, text) {
  const r = git.run(deepFreeze(state), text);
  assert.equal(r.ok, true, `'${text}' debía ir bien: ${r.error?.message}`);
  assert.equal(r.error, null);
  return r;
}

export const headId = (s) => s.repo.branches[s.repo.head];
