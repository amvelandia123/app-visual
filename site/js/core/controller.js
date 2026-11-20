// Controlador genérico (puro, sin DOM): orquesta el modo guiado y el libre.
// No sabe nada de Git: solo usa el contrato de módulo. (ARCHITECTURE §8)

/**
 * @param {object} module módulo con createInitialState, run, prompt y data.scenario
 * @returns {{getSnapshot:Function, next:Function, prev:Function, goTo:Function, reset:Function, run:Function, subscribe:Function}}
 */
export function createController(module) {
  const steps = module.data.scenario.steps;
  const total = steps.length;
  const listeners = new Set();

  let state;
  let step;
  let mode;
  let log;
  let lastResult;
  let lastCommandId;
  let lastStep;
  let offScript;

  const welcome = () => module.data.scenario.intro.map((text) => ({ kind: 'system', text }));

  function init() {
    state = module.createInitialState();
    step = 0;
    mode = 'guided';
    log = welcome();
    lastResult = null;
    lastCommandId = null;
    lastStep = null;
    offScript = false;
  }

  /** Ejecuta una línea y la anota en el log. */
  function exec(text) {
    const prompt = module.prompt(state);
    const result = module.run(state, text);
    log.push({ kind: 'command', text, prompt });
    if (result.ui && result.ui.clear) log = [];
    for (const line of result.output) log.push({ kind: result.ok ? 'output' : 'error', text: line });
    if (result.hint) log.push({ kind: 'hint', text: result.hint });
    for (const n of result.notes) log.push({ kind: 'note', text: n });
    state = result.state;
    return result;
  }

  /** Ejecuta el paso `i` (1..total) y devuelve sus transiciones. */
  function playStep(i) {
    const s = steps[i - 1];
    const transitions = [];
    for (const b of s.before) {
      if (b.narration) log.push({ kind: 'narration', text: b.narration });
      const from = state;
      const result = exec(b.command);
      if (!result.ok) throw new Error(`Escenario roto: paso ${i} (previo) '${b.command}' falló: ${result.error.message}`);
      transitions.push({ kind: 'pre', text: b.command, result, from, to: state });
    }
    const from = state;
    const result = exec(s.command);
    if (!result.ok) throw new Error(`Escenario roto: paso ${i} '${s.command}' falló: ${result.error.message}`);
    transitions.push({ kind: 'command', text: s.command, result, from, to: state });
    step = i;
    mode = 'guided';
    offScript = false;
    lastStep = s;
    lastResult = result;
    lastCommandId = result.commandId;
    return transitions;
  }

  /** Reconstruye desde cero hasta el paso n (con log). */
  function replay(n) {
    init();
    for (let i = 1; i <= n; i++) playStep(i);
  }

  function getSnapshot() {
    return { mode, step, total, state, log: log.slice(), lastCommandId, lastResult, lastStep, offScript };
  }

  function notify(transitions) {
    const snap = getSnapshot();
    for (const fn of [...listeners]) fn(snap, transitions);
    return transitions;
  }

  function next() {
    if (step >= total) return [];
    const transitions = [];
    if (offScript) {
      // Volver al estado del paso actual (descarta lo hecho en modo libre).
      const from = state;
      const savedLog = log;
      replay(step);
      log = [...savedLog, { kind: 'system', text: '↺ Volviendo al escenario guiado' }];
      transitions.push({ kind: 'jump', from, to: state });
    }
    transitions.push(...playStep(step + 1));
    return notify(transitions);
  }

  function goTo(n) {
    const target = Math.max(0, Math.min(total, Math.trunc(Number(n)) || 0));
    const from = state;
    replay(target);
    return notify([{ kind: 'jump', from, to: state }]);
  }

  function prev() {
    return step > 0 ? goTo(step - 1) : [];
  }

  function reset() {
    const from = state;
    init();
    return notify([{ kind: 'reset', from, to: state }]);
  }

  function run(text) {
    if (!String(text ?? '').trim()) return [];
    const from = state;
    const result = exec(text);
    mode = 'free';
    offScript = true;
    lastStep = null;
    lastResult = result;
    lastCommandId = result.commandId;
    return notify([{ kind: 'command', text, result, from, to: state }]);
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  init();
  return { getSnapshot, next, prev, goTo, reset, run, subscribe };
}
