// Parser del modo libre: texto -> comando estructurado. Sin DOM. (ARCHITECTURE §6)

const AUX = new Set(['edit', 'touch', 'ls', 'ana-push', 'help', 'clear']);

/** Subcomandos de git que el simulador implementa. */
export const SUPPORTED = ['init', 'status', 'add', 'commit', 'branch', 'switch', 'checkout', 'merge', 'stash', 'remote', 'fetch', 'pull', 'push', 'log'];
/** Subcomandos reales que aún no están en el simulador v1. */
export const UNSUPPORTED = ['restore', 'reset', 'rebase', 'diff', 'rm', 'mv', 'clone', 'tag', 'cherry-pick', 'revert', 'show'];

/**
 * Especificación por subcomando: opciones reconocidas, valores por defecto y máximo de argumentos.
 * `opts[nombre] = { key, takes?, value? }`.
 */
const SPECS = {
  init: { defaults: {}, opts: {}, max: 0 },
  status: { defaults: {}, opts: {}, max: 0 },
  add: { defaults: { all: false }, opts: { '-A': { key: 'all' }, '--all': { key: 'all' } }, max: Infinity },
  commit: {
    defaults: { message: null, all: false },
    opts: { '-m': { key: 'message', takes: true }, '--message': { key: 'message', takes: true }, '-a': { key: 'all' }, '--all': { key: 'all' } },
    max: Infinity,
  },
  branch: {
    defaults: { delete: false, force: false },
    opts: { '-d': { key: 'delete' }, '--delete': { key: 'delete' }, '-D': { key: 'delete', also: { force: true } }, '-f': { key: 'force' }, '--force': { key: 'force' } },
    max: 1,
  },
  switch: { defaults: { create: false }, opts: { '-c': { key: 'create' }, '--create': { key: 'create' } }, max: 1 },
  checkout: { defaults: { create: false }, opts: { '-b': { key: 'create' } }, max: 1 },
  merge: { defaults: { noFf: false }, opts: { '--no-ff': { key: 'noFf' }, '--ff': { key: 'ff' } }, max: 1 },
  stash: {
    defaults: { action: 'push', message: null, includeUntracked: false },
    opts: { '-m': { key: 'message', takes: true }, '--message': { key: 'message', takes: true }, '-u': { key: 'includeUntracked' }, '--include-untracked': { key: 'includeUntracked' } },
    max: 2,
  },
  remote: { defaults: { action: 'list', verbose: false }, opts: { '-v': { key: 'verbose' }, '--verbose': { key: 'verbose' } }, max: 3 },
  fetch: { defaults: {}, opts: {}, max: 1 },
  pull: { defaults: {}, opts: { '--no-rebase': { key: 'noRebase' } }, unsupported: ['--rebase', '-r'], max: 2 },
  push: {
    defaults: { setUpstream: false },
    opts: { '-u': { key: 'setUpstream' }, '--set-upstream': { key: 'setUpstream' } },
    unsupported: ['--force', '-f', '--force-with-lease'],
    max: 2,
  },
  log: { defaults: { oneline: false, all: false }, opts: { '--oneline': { key: 'oneline' }, '--all': { key: 'all' } }, max: 0 },
};

/** Tokeniza respetando comillas simples y dobles. @returns {{tokens:string[]}|{error:string}} */
export function tokenize(text) {
  const tokens = [];
  let cur = '';
  let has = false;
  let quote = null;
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (has || cur) tokens.push(cur);
      cur = '';
      has = false;
    } else {
      cur += ch;
      has = true;
    }
  }
  if (quote) return { error: `comilla ${quote === '"' ? 'doble' : 'simple'} sin cerrar` };
  if (has || cur) tokens.push(cur);
  return { tokens };
}

/** Distancia de Levenshtein entre dos cadenas. */
export function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

/** Subcomando soportado más parecido a `word` (o null). */
export function suggest(word) {
  let best = null;
  let bestD = Infinity;
  for (const c of [...SUPPORTED, ...UNSUPPORTED]) {
    const d = levenshtein(word, c);
    if (d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return bestD <= Math.max(2, Math.floor(word.length / 3)) ? best : null;
}

const err = (code, message, hint = null, output = null) => ({ ok: false, error: { code, message }, hint, output: output ?? [message] });

function setOpt(flags, o, value) {
  if (o.takes) flags[o.key] = flags[o.key] != null && o.key === 'message' ? `${flags[o.key]}\n\n${value}` : value;
  else flags[o.key] = true;
  if (o.also) Object.assign(flags, o.also);
}

/** Procesa las opciones de un subcomando. @returns {{flags,args}|{fail}} */
function parseOptions(sub, rest) {
  const spec = SPECS[sub];
  const flags = { ...spec.defaults };
  const args = [];
  let onlyArgs = false;
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i];
    if (onlyArgs || t === '-' || !t.startsWith('-')) {
      args.push(t);
      continue;
    }
    if (t === '--') {
      onlyArgs = true;
      continue;
    }
    if (spec.unsupported?.includes(t)) {
      return { fail: err('UNSUPPORTED', `git ${sub} ${t}: aún no está en el simulador v1.`, t.includes('force') || t === '-f'
        ? 'Forzar el push puede borrar el trabajo de otras personas, por eso no está en el simulador. Lo correcto es git pull y luego git push.'
        : 'El simulador solo soporta pull con merge (pull.rebase=false).') };
    }
    const unknown = () => ({ fail: err('INVALID_OPTION', `error: opción desconocida '${t.replace(/=.*/, '')}'`, `Mira qué opciones soporta 'git ${sub}' en el panel «¿Qué pasó?» o escribe help.`) });
    const needsValue = (name) => ({ fail: err('MISSING_ARG', `error: la opción '${name.replace(/^-+/, '')}' requiere un valor`, 'Ejemplo: git commit -m "Mi mensaje"') });
    if (t.startsWith('--')) {
      const eq = t.indexOf('=');
      const name = eq === -1 ? t : t.slice(0, eq);
      const o = spec.opts[name];
      if (!o) return unknown();
      if (o.takes) {
        let v = eq === -1 ? rest[++i] : t.slice(eq + 1);
        if (v === undefined) return needsValue(name);
        setOpt(flags, o, v);
      } else {
        if (eq !== -1) return unknown();
        setOpt(flags, o, true);
      }
      continue;
    }
    // Opciones cortas, posiblemente agrupadas (-am "msg", -m=msg, -mmsg).
    const chars = t.slice(1);
    for (let k = 0; k < chars.length; k++) {
      const name = `-${chars[k]}`;
      const o = spec.opts[name];
      if (!o) return { fail: err('INVALID_OPTION', `error: opción desconocida '${chars[k]}'`, `Mira qué opciones soporta 'git ${sub}' o escribe help.`) };
      if (o.takes) {
        let v = chars.slice(k + 1);
        if (v.startsWith('=')) v = v.slice(1);
        if (v === '') {
          v = rest[++i];
          if (v === undefined) return needsValue(name);
        }
        setOpt(flags, o, v);
        break;
      }
      setOpt(flags, o, true);
    }
  }
  return { flags, args };
}

/**
 * Convierte el texto de la consola en un comando estructurado.
 * @param {string} text
 * @returns {{ok:true, cmd:{program:string, sub:string|null, args:string[], flags:object, raw:string}} | {ok:false, error:{code:string,message:string}, hint:string|null, output:string[]}}
 */
export function parse(text) {
  const raw = String(text ?? '');
  const tk = tokenize(raw);
  if (tk.error) return err('BAD_SYNTAX', `error: ${tk.error}`, 'Cierra la comilla: -m "mensaje con espacios".');
  const tokens = tk.tokens;
  if (tokens.length === 0) return err('BAD_SYNTAX', 'error: comando vacío', 'Escribe help para ver los comandos.');
  const [first, ...rest] = tokens;
  if (AUX.has(first)) {
    return { ok: true, cmd: { program: first, sub: null, args: rest.filter((t) => !t.startsWith('-')), flags: {}, raw } };
  }
  if (first !== 'git') {
    return err('NOT_GIT', `bash: ${first}: orden no encontrada`, "Este simulador entiende comandos 'git ...' y algunos ayudantes. Escribe help para verlos.");
  }
  const sub = rest[0];
  if (sub === undefined || sub === 'help' || sub === '--help' || sub === '-h') {
    return { ok: true, cmd: { program: 'help', sub: null, args: [], flags: {}, raw } };
  }
  if (sub.startsWith('-')) return err('INVALID_OPTION', `error: opción desconocida '${sub}'`, 'Prueba git --help.');
  if (!SPECS[sub]) {
    if (UNSUPPORTED.includes(sub)) {
      return err('UNSUPPORTED', `git: '${sub}' aún no está en el simulador v1.`, `'git ${sub}' existe en Git real, pero esta versión solo simula 10 comandos esenciales. Escribe help para verlos.`);
    }
    const near = suggest(sub);
    const output = [`git: '${sub}' no es un comando de git. Mira 'git --help'.`];
    if (near) output.push('', 'El comando más parecido es', `\t${near}`);
    return { ok: false, error: { code: 'UNKNOWN_COMMAND', message: output[0] }, hint: near ? `¿Querías escribir 'git ${near}'?` : 'Escribe help para ver los comandos soportados.', output };
  }
  const r = parseOptions(sub, rest.slice(1));
  if (r.fail) return r.fail;
  const flags = { ...r.flags };
  // stash y remote llevan una "acción" como primer argumento posicional.
  if (sub === 'stash' && r.args.length) {
    const a = r.args[0];
    if (['push', 'pop', 'apply', 'list', 'drop'].includes(a)) {
      flags.action = a;
      r.args.shift();
    } else {
      return err('BAD_SYNTAX', `error: subcomando de stash desconocido: ${a}`, 'Subcomandos: push, pop, apply, list, drop. Para guardar con mensaje: git stash push -m "mensaje".');
    }
  }
  if (sub === 'remote' && r.args.length) {
    if (r.args[0] === 'add') {
      flags.action = 'add';
      r.args.shift();
    } else {
      return err('UNSUPPORTED', `git remote ${r.args[0]}: aún no está en el simulador v1.`, "Solo se soporta 'git remote', 'git remote -v' y 'git remote add <nombre> <url>'.");
    }
  }
  if (sub === 'commit' && r.args.length) {
    return err('PATHSPEC', `error: la ruta especificada '${r.args[0]}' no concordó con ningún archivo conocido por git`, 'Si tu mensaje tiene espacios, enciérralo entre comillas: git commit -m "Mi mensaje largo".');
  }
  if (sub === 'stash' && flags.action === 'push' && r.args.length) {
    return err('BAD_SYNTAX', `error: argumentos no esperados en 'git stash': ${r.args.join(' ')}`, 'Para guardar con mensaje usa git stash push -m "mensaje".');
  }
  if (r.args.length > SPECS[sub].max) {
    return err('BAD_SYNTAX', `error: demasiados argumentos para 'git ${sub}'`, `Revisa la sintaxis de git ${sub} en el panel «¿Qué pasó?».`);
  }
  return { ok: true, cmd: { program: 'git', sub, args: r.args, flags, raw } };
}
