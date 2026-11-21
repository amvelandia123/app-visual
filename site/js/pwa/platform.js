// Detección de plataforma (PURO: sin DOM al importarse). ARCHITECTURE §16.1.

/**
 * ¿iPhone/iPad? Detecta también iPadOS, que se identifica como MacIntel con pantalla táctil.
 * @param {{ userAgent?: string, platform?: string, maxTouchPoints?: number }} [nav]
 */
export function isIOS({ userAgent = '', platform = '', maxTouchPoints = 0 } = {}) {
  if (/iPhone|iPad|iPod/.test(userAgent)) return true;
  return platform === 'MacIntel' && maxTouchPoints > 1;
}

/**
 * ¿La app corre ya instalada (modo standalone)?
 * @param {{ matchMedia?: Function, navigator?: { standalone?: boolean } }} [env]
 */
export function isStandalone({ matchMedia, navigator: nav } = {}) {
  if (nav?.standalone === true) return true;
  try {
    return Boolean(matchMedia?.('(display-mode: standalone)')?.matches);
  } catch {
    return false;
  }
}

/** ¿Dentro de un contenedor nativo (Capacitor)? */
export function isNativeApp(win) {
  try {
    return Boolean(win?.Capacitor?.isNativePlatform?.());
  } catch {
    return false;
  }
}
