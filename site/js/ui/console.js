// Consola: log de comandos y salidas, contador de paso, prompt vivo e historial ↑/↓.

const KIND_CLASS = {
  command: 'log-command', output: 'log-output', error: 'log-error', hint: 'log-hint',
  note: 'log-note', narration: 'log-narration', system: 'log-system',
};

/** Convierte `texto con `código`` en nodos seguros (sin innerHTML). */
export function inlineCode(text) {
  const frag = document.createDocumentFragment();
  String(text).split('`').forEach((part, i) => {
    if (!part) return;
    if (i % 2) {
      const c = document.createElement('code');
      c.textContent = part;
      frag.append(c);
    } else frag.append(part);
  });
  return frag;
}

/**
 * @param {{ log: HTMLElement, counter: HTMLElement, form: HTMLFormElement, input: HTMLInputElement,
 *   promptLabel: HTMLElement, onSubmit: (text: string) => void, onInteract?: () => void }} opts
 */
export function createConsole({ log, counter, form, input, promptLabel, onSubmit, onInteract = () => {} }) {
  let rendered = [];
  const history = [];
  let histIdx = -1;
  let draft = '';

  function lineFor(entry) {
    const line = document.createElement('div');
    line.className = `log-line ${KIND_CLASS[entry.kind] ?? 'log-output'}`;
    line.dataset.kind = entry.kind;
    if (entry.kind === 'command') {
      const p = document.createElement('span');
      p.className = 'prompt-text';
      p.textContent = entry.prompt ?? '$';
      line.append(p, entry.text);
    } else if (entry.kind === 'hint') {
      line.append('💡 ', inlineCode(entry.text));
    } else {
      line.append(inlineCode(entry.text));
    }
    return line;
  }

  const sameEntry = (a, b) => a && b && a.kind === b.kind && a.text === b.text && a.prompt === b.prompt;

  /** @param {object} snap snapshot del controlador */
  function update(snap, promptText) {
    const entries = snap.log ?? [];
    const prefixOk = rendered.length <= entries.length && rendered.every((r, i) => sameEntry(r, entries[i]));
    if (!prefixOk) {
      log.replaceChildren();
      rendered = [];
    }
    const frag = document.createDocumentFragment();
    for (let i = rendered.length; i < entries.length; i++) frag.append(lineFor(entries[i]));
    if (frag.childNodes.length) log.append(frag);
    rendered = entries.map((e) => ({ kind: e.kind, text: e.text, prompt: e.prompt }));
    log.scrollTop = log.scrollHeight;

    const total = snap.total ?? 10;
    const pad = (n) => String(n).padStart(2, '0');
    if (snap.mode === 'free') {
      counter.textContent = 'LIBRE';
      counter.dataset.mode = 'free';
      counter.setAttribute('aria-label', 'Modo libre');
    } else {
      counter.textContent = `${pad(snap.step)}/${pad(total)}`;
      counter.dataset.mode = 'guided';
      counter.setAttribute('aria-label', `Paso ${snap.step} de ${total}`);
    }
    if (promptText != null) promptLabel.textContent = promptText;
  }

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    if (history[history.length - 1] !== text) history.push(text);
    histIdx = -1;
    draft = '';
    input.value = '';
    onInteract();
    onSubmit(text);
  });

  input.addEventListener('input', () => onInteract());
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowUp' && history.length) {
      ev.preventDefault();
      if (histIdx === -1) { draft = input.value; histIdx = history.length - 1; } else histIdx = Math.max(0, histIdx - 1);
      input.value = history[histIdx];
    } else if (ev.key === 'ArrowDown' && histIdx !== -1) {
      ev.preventDefault();
      histIdx += 1;
      if (histIdx >= history.length) { histIdx = -1; input.value = draft; } else input.value = history[histIdx];
    }
  });

  return { update, focus: () => input.focus() };
}
