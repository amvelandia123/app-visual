// Punto de entrada: monta la app con el módulo Git.

import gitModule from './modules/git/index.js';
import { createController } from './core/controller.js';
import { createGitView } from './modules/git/view.js';
import { createApp } from './ui/app.js';
import { registerServiceWorker } from './pwa/register.js';
import { setupInstall } from './ui/install.js';

const controller = createController(gitModule);

// La vista necesita `onCommand`, que a su vez usa la app: se enlaza con una referencia diferida.
let app = null;
const view = createGitView(document.getElementById('stage'), {
  onCommand: (text) => app?.onViewCommand(text),
});
app = createApp({ module: gitModule, controller, view });

// Gancho de solo lectura para tests e2e.
window.__LAB__ = {
  getSnapshot: () => controller.getSnapshot(),
  project: (state) => gitModule.project(state),
};

// PWA: botón instalar y service worker (no registra nada en app nativa ni en orígenes inseguros).
setupInstall(window);
window.__LAB__.pwa = registerServiceWorker(window);
