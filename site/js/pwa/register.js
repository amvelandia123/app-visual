// Registro del service worker y aviso de actualización (ARCHITECTURE §16.5).
import { isNativeApp } from './platform.js';

/** Origen seguro: https o localhost/127.0.0.1. */
function isSecureOrigin(loc) {
  return loc.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(loc.hostname);
}

/**
 * Registra el SW y gestiona el aviso de actualización.
 * @returns {{ ready: Promise<ServiceWorkerRegistration|null>, version: () => Promise<string|null> }}
 */
export function registerServiceWorker(win = window) {
  const doc = win.document;
  const nav = win.navigator;
  if (!('serviceWorker' in nav) || !isSecureOrigin(win.location) || isNativeApp(win)) {
    return { ready: Promise.resolve(null), version: async () => null };
  }

  const toast = doc.getElementById('update-toast');
  const reloadBtn = doc.getElementById('btn-update-reload');
  const closeBtn = doc.getElementById('btn-update-close');
  let userRequested = false;
  let registration = null;

  const showToast = () => { if (toast) toast.hidden = false; };
  const hideToast = () => { if (toast) toast.hidden = true; };

  // Hay versión nueva solo si la página ya estaba controlada por un SW anterior.
  const watch = (reg) => {
    const check = (worker) => { if (worker && nav.serviceWorker.controller) showToast(); };
    check(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => { if (worker.state === 'installed') check(reg.waiting || worker); });
    });
  };

  reloadBtn?.addEventListener('click', () => {
    userRequested = true;
    const waiting = registration?.waiting;
    if (waiting) waiting.postMessage({ type: 'SKIP_WAITING' });
    else win.location.reload();
  });
  closeBtn?.addEventListener('click', hideToast);

  // Solo se recarga si lo pidió el usuario; la primera toma de control no recarga.
  nav.serviceWorker.addEventListener('controllerchange', () => { if (userRequested) win.location.reload(); });

  const ready = new Promise((resolve) => {
    const start = () => {
      nav.serviceWorker.register('./sw.js').then((reg) => {
        registration = reg;
        watch(reg);
        doc.addEventListener('visibilitychange', () => {
          if (doc.visibilityState === 'visible') reg.update().catch(() => {});
        });
        resolve(reg);
      }).catch(() => resolve(null));
    };
    if (doc.readyState === 'complete') start();
    else win.addEventListener('load', start, { once: true });
  });

  const version = async () => {
    await ready;
    const sw = nav.serviceWorker.controller;
    if (!sw) return null;
    return new Promise((resolve) => {
      const onMsg = (e) => {
        if (e.data?.type !== 'VERSION') return;
        nav.serviceWorker.removeEventListener('message', onMsg);
        resolve(e.data.version);
      };
      nav.serviceWorker.addEventListener('message', onMsg);
      sw.postMessage({ type: 'GET_VERSION' });
    });
  };

  return { ready, version };
}
