// Descriptor del módulo Git (contrato de módulo, ARCHITECTURE §3). Solo partes puras.

import { createInitialState, execute } from './engine.js';
import { parse } from './parser.js';
import { project } from './projection.js';
import * as data from './data.js';

const empty = (state) => ({
  ok: true, state, changed: false, commandId: null, output: [], error: null, hint: null, notes: [], effects: [], ui: null,
});

/**
 * Parsea y ejecuta una línea de la consola. Nunca lanza por la entrada del usuario.
 * @param {object} state
 * @param {string} text
 * @returns {object} Result
 */
function run(state, text) {
  if (!String(text ?? '').trim()) return empty(state);
  try {
    const p = parse(text);
    if (!p.ok) {
      return {
        ok: false, state, changed: false, commandId: null, output: p.output ?? [p.error.message],
        error: p.error, hint: p.hint ?? null, notes: [], effects: [], ui: null,
      };
    }
    return execute(state, p.cmd);
  } catch (e) {
    return {
      ok: false, state, changed: false, commandId: null, output: ['error: fallo interno del simulador'],
      error: { code: 'BAD_SYNTAX', message: 'error: fallo interno del simulador' }, hint: null, notes: [], effects: [], ui: null,
    };
  }
}

/** Prompt de la consola: '~/tienda $' antes de init, '(main) $' después. */
function prompt(state) {
  return state.repo ? `(${state.repo.head}) $` : `${state.cwd} $`;
}

export default {
  id: 'git',
  title: 'Git',
  createInitialState,
  run,
  project,
  prompt,
  data: {
    meta: data.meta,
    commands: data.commands,
    extraCommands: data.extraCommands,
    errors: data.errors,
    scenario: data.scenario,
  },
};
