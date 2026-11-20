// Panel de los 10 comandos (2 columnas: 01–05 y 06–10). Los datos vienen de `module.data.commands`.

/**
 * @param {{ container: HTMLElement, commands: Array<{number:string,name:string,label:string}>, onSelect: (n:number)=>void }} opts
 */
export function createStepper({ container, commands, onSelect }) {
  const buttons = commands.map((cmd, i) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'step-btn';
    btn.dataset.stepItem = String(i + 1);
    btn.dataset.status = 'pending';
    btn.title = `Ir al paso ${i + 1}: ${cmd.name}`;
    const num = Object.assign(document.createElement('span'), { className: 'step-num', textContent: cmd.number ?? String(i + 1).padStart(2, '0') });
    const name = Object.assign(document.createElement('span'), { className: 'step-name', textContent: cmd.name });
    const label = Object.assign(document.createElement('span'), { className: 'step-label', textContent: cmd.label });
    const check = Object.assign(document.createElement('span'), { className: 'step-check', textContent: '✓' });
    check.setAttribute('aria-hidden', 'true');
    const state = Object.assign(document.createElement('span'), { className: 'sr-only' });
    btn.append(num, name, label, check, state);
    btn.addEventListener('click', () => onSelect(i + 1));
    li.append(btn);
    container.append(li);
    return { btn, state };
  });
  // Dos columnas: filas 1–5 con 5 elementos por columna.
  container.style.gridTemplateRows = `repeat(${Math.ceil(commands.length / 2)}, auto)`;

  return {
    /** @param {{step:number}} snap */
    update(snap) {
      buttons.forEach(({ btn, state }, i) => {
        const n = i + 1;
        const status = n < snap.step ? 'done' : n === snap.step ? 'active' : 'pending';
        btn.dataset.status = status;
        if (status === 'active') btn.setAttribute('aria-current', 'step');
        else btn.removeAttribute('aria-current');
        state.textContent = status === 'done' ? ' (completado)' : status === 'active' ? ' (paso actual)' : '';
      });
    },
  };
}
