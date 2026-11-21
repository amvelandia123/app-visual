// Botón «Instalar app» y ayuda de iOS (ARCHITECTURE §16.6).
import { isIOS, isStandalone, isNativeApp } from '../pwa/platform.js';

/** Conecta #btn-install y <dialog id="install-help">. */
export function setupInstall(win = window) {
  const doc = win.document;
  const btn = doc.getElementById('btn-install');
  const dialog = doc.getElementById('install-help');
  if (!btn) return;
  if (isStandalone({ matchMedia: win.matchMedia?.bind(win), navigator: win.navigator }) || isNativeApp(win)) return;

  let deferred = null;
  const hide = () => { btn.hidden = true; deferred = null; };

  win.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event;
    btn.hidden = false;
  });
  win.addEventListener('appinstalled', hide);

  const ios = isIOS(win.navigator);
  if (ios) btn.hidden = false;

  btn.addEventListener('click', async () => {
    if (deferred) {
      const ev = deferred;
      deferred = null;
      try {
        await ev.prompt();
      } finally {
        hide(); // aceptado o rechazado: el evento ya no se puede reutilizar
      }
    } else if (ios && dialog) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
  });

  // Escape lo gestiona <dialog>; al cerrarse devolvemos el foco al botón.
  dialog?.addEventListener('close', () => btn.focus());
  dialog?.querySelector('[data-close]')?.addEventListener('click', () => {
    if (dialog.close) dialog.close(); else dialog.removeAttribute('open');
  });
  // Clic en el fondo (fuera de la caja) también cierra.
  dialog?.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
}
