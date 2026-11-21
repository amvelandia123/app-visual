# Laboratorio Visual

![CI](https://github.com/amvelandia123/app-visual/actions/workflows/ci.yml/badge.svg)

Simulador web interactivo para aprender herramientas técnicas viendo qué hace cada comando.
El primer módulo es **Git**: verás cómo cada comando mueve archivos, crea commits y desplaza ramas entre cinco zonas.

**Demo:** https://amvelandia123.github.io/app-visual/

---

## Instalar en el móvil

Laboratorio Visual es una **app instalable** (PWA). Al instalarla:

- Se abre a **pantalla completa**, como una app más.
- Funciona **sin internet** después de la primera visita.
- **No pasa por tiendas**: se instala desde el propio navegador.

### iPhone y iPad

1. Abre la demo en **Safari**.
2. Pulsa **Compartir** (el cuadrado con una flecha ↑).
3. Elige **«Añadir a pantalla de inicio»** y después pulsa **«Añadir»**.

Desde iOS 16.4, Chrome y Edge en iPhone también muestran el menú Compartir, así que el mismo paso funciona desde ellos.

La app tiene además un botón **«Instalar app»** que muestra esta ayuda.

### Android

1. Abre la demo en **Chrome**.
2. Pulsa el botón **«Instalar app»** de la cabecera.
3. Si no aparece, abre el menú **⋮** y elige **«Instalar aplicación»** o **«Añadir a pantalla de inicio»**.

### Ordenador (Chrome o Edge)

Pulsa el icono de instalar en la barra de direcciones, o el botón **«Instalar app»**.

### Sin conexión

Abre la app una vez con internet. Después puedes usarla entera sin red.

### Actualizaciones

Cuando se publica una versión nueva, la app muestra un aviso discreto: **«Hay una actualización — Recargar»**. Pulsa **Recargar** para usar la versión nueva.

### Desinstalar

Mantén pulsado el icono de la app y elige **Eliminar** o **Desinstalar**.

### Problemas frecuentes

| Problema | Qué hacer |
|---|---|
| No aparece «Instalar app». | Tu navegador no lo ofrece, o la app ya está instalada. Prueba con Chrome o Edge. |
| En iPhone no hay opción de instalar. | Usa el menú **Compartir** de Safari, como se indica arriba. |
| No ves la última versión. | Cierra y vuelve a abrir la app, y pulsa **Recargar** en el aviso. |

---

## Qué verás

La pantalla muestra cinco zonas a la vez:

| Zona | Qué representa |
|---|---|
| **WORKING TREE** | Tu carpeta: archivos modificados o sin seguimiento. |
| **STAGING** | Archivos preparados con `git add`, listos para el próximo commit. |
| **STASH** | Cambios guardados aparte con `git stash`. |
| **LOCAL REPO** | Tu historial en `.git`: commits, ramas y `HEAD`. |
| **REMOTE · ORIGIN** | El servidor compartido (GitHub simulado): su historial y su estado. |

---

## Cómo usarlo

### Modo guiado

Recorre un escenario de 10 pasos con los controles:

- **◀ Anterior** y **Siguiente ▶** avanzan o retroceden un paso.
- **⏵ Auto-play** avanza solo. Se detiene al pulsar cualquier control o al escribir.
- **↺ Reiniciar** devuelve todo al estado inicial.
- Haz clic en un comando del panel de pasos para saltar a ese paso.
- Atajos: `←` anterior y `→` siguiente (no actúan mientras escribes en la consola).

### Modo libre

Escribe comandos en la consola y el prompt indicará la rama actual. Algunos ejemplos:

```bash
git init
git status
git add .
git commit -m "Primera versión"
git switch -c feature/carrito
git merge main
```

Además hay comandos auxiliares que simulan el editor y a tu compañera Ana:

| Comando | Qué hace |
|---|---|
| `edit <archivo>` | Simula que editas el archivo (nueva versión). |
| `touch <archivo>` | Crea un archivo vacío sin seguimiento. |
| `ls` | Lista los archivos de la carpeta. |
| `ana-push [archivo]` | Ana sube al servidor un commit que modifica el archivo (por defecto `app.js`). |
| `help` | Muestra los comandos disponibles. |
| `clear` | Limpia la consola. |

También puedes usar el botón **✎** de los archivos limpios de WORKING TREE (equivale a `edit`) y el botón **«☁ Simular push de Ana»** (equivale a `ana-push`).

### Panel «¿Qué pasó?»

Explica el último comando: qué hizo, por qué se usa, el error típico de quien empieza y, si aplica, qué se ha simplificado. Si el comando falló, muestra también la explicación del error.

---

## Los 10 comandos

| Nº | Comando | Etiqueta | Qué hace |
|---|---|---|---|
| 01 | `git init` | NEW REPO | Crea el repositorio (`.git`) en la carpeta actual. |
| 02 | `git status` | WHAT CHANGED | Muestra la rama y el estado de cada archivo. |
| 03 | `git add` | STAGE FILES | Prepara cambios para el próximo commit. |
| 04 | `git commit` | SAVE SNAPSHOT | Guarda en el historial una instantánea de lo preparado. |
| 05 | `git branch` | NEW LINE | Crea, lista o borra ramas (etiquetas que apuntan a un commit). |
| 06 | `git switch` | MOVE HEAD | Cambia de rama y actualiza los archivos. |
| 07 | `git merge` | JOIN LINES | Une otra rama en la actual (fast-forward o commit de merge). |
| 08 | `git stash` | SHELVE WORK | Aparta cambios sin commit; `git stash pop` los recupera. |
| 09 | `git pull` | DOWNLOAD | Descarga los cambios del servidor e integra en tu rama. |
| 10 | `git push` | UPLOAD | Sube tus commits al servidor; con `-u` fija la rama remota. |

Además: `git log`, `git remote`, `git fetch` y `git checkout` (alias de `switch`).

---

## El escenario guiado

Andrés crea una tienda online en `~/tienda` y colabora con Ana.

| Paso | Comando | Preparación previa |
|---|---|---|
| 01 | `git init` | Ninguna. |
| 02 | `git status` | Ninguna. |
| 03 | `git add .` | Ninguna. |
| 04 | `git commit -m "Primera versión de la tienda"` | Ninguna. |
| 05 | `git branch feature/carrito` | Ninguna. |
| 06 | `git switch feature/carrito` | Ninguna. |
| 07 | `git merge feature/carrito` | `edit cart.js`, `git commit -am`, `git switch main`, `edit app.js`, `git commit -am`. |
| 08 | `git stash` | `edit style.css` (rediseño a medias). |
| 09 | `git pull` | `git remote add origin …`, `git push -u origin main`, `ana-push cart.js`. |
| 10 | `git push` | `git stash pop`, `git commit -am "Rediseña los botones"`. |

Las **narraciones de preparación** aparecen atenuadas y en cursiva en la consola. Los comandos que las acompañan son **acciones reales** que ejecuta el motor, no texto decorativo. Así, cada paso tiene sentido aunque no hayas hecho esos comandos a mano.

---

## Ejecutar en local

Requisito: **Node 22** o superior.

```bash
npm ci
npm start
```

Abre http://localhost:4173 en el navegador. Para cambiar el puerto: `PORT=8080 npm start`.

Tests:

```bash
npm test
npm run test:e2e
```

- `npm test` ejecuta los **365 tests unitarios** con `node --test`, sin dependencias (menos de 1 s): cada comando, cada código de error, inmutabilidad, parser, proyección, escenario y controlador.
- `npm run test:e2e` ejecuta los **42 tests en navegador** con Playwright y Chromium (unos 40 s): los 10 pasos comparando el DOM con el estado del motor, Reiniciar, Auto-play, modo libre, teclado, accesibilidad básica y móvil. Todos fallan si aparece un error en la consola del navegador.

Si es la primera vez que ejecutas los tests en navegador, instala Chromium con:

```bash
npx playwright install chromium
```

### Cambios en `site/` (PWA)

La app instalable guarda en caché **todos** los archivos de `site/` para funcionar sin internet.
Por eso, **tras cambiar cualquier archivo de `site/`, ejecuta `npm run pwa:sync`**. Actualiza la lista
de archivos guardados y la versión de la caché en `site/sw.js`. Un test unitario falla si lo olvidas.

```bash
npm run pwa:sync
```

Para comprobar que `sw.js` está al día sin modificarlo:

```bash
npm run pwa:check
```

Si cambias los iconos en `site/icons/*.svg`, regenera los PNG (usa Playwright, solo para desarrollo):

```bash
npm run icons
```

---

## Arquitectura

El simulador separa la lógica de Git de la interfaz. El flujo es este:

```
texto ──► consola ──► controlador ──► módulo.run(estado, texto)
                          │             parser + motor (puros, sin DOM)
                          │                       │
                          ▼                       ▼
                 snapshot + transiciones   módulo.project(estado)  (puro)
                          │                       │
                          ▼                       ▼
                 ui/app.js  ─────────────►  vista (DOM) + animador
```

Tres reglas clave:

1. **El motor es puro y no usa el DOM.** Recibe un estado y devuelve un estado nuevo; no modifica el anterior. Por eso puede probarse en Node.
2. **La interfaz solo dibuja la proyección.** Nunca lee el estado del motor "a mano" ni guarda una copia propia de la verdad.
3. **Los textos viven en `data.js`.** Las explicaciones, los errores didácticos y el escenario están en español en ese archivo.

Estructura de carpetas:

| Ruta | Capa | Contenido |
|---|---|---|
| `site/index.html`, `site/css/` | Interfaz | Esqueleto de la página y estilos (tokens en `base.css`; `fonts.css` carga la tipografía). |
| `site/fonts/` | Interfaz | JetBrains Mono autoalojada (licencia SIL OFL 1.1, texto en `OFL.txt`). Sin Google Fonts. |
| `site/icons/` | Interfaz | Iconos originales: SVG maestro y variante maskable, PNG para la app y `apple-touch-icon`. |
| `site/manifest.webmanifest` | PWA | Manifest: nombre, colores, iconos y modo de pantalla completa. |
| `site/sw.js` | PWA | Service worker: caché offline. Su lista de archivos y su versión las genera `npm run pwa:sync`. |
| `site/js/pwa/` | PWA | `platform.js` (detección de iOS, modo instalado y app nativa) y `register.js` (registro del service worker y aviso de actualización). |
| `site/js/main.js` | Arranque | Monta la aplicación con el módulo Git. |
| `site/js/ui/` | Interfaz genérica | Consola, panel de pasos, «¿Qué pasó?», animador, `app.js` y botón «Instalar app» (`install.js`). |
| `site/js/core/controller.js` | Núcleo puro | Modo guiado y libre, historial y reconstrucción de estados. |
| `site/js/modules/git/` | Módulo Git | `engine.js`, `parser.js`, `projection.js`, `data.js`, `index.js` (puros) y `view.js` (DOM). |
| `tests/unit/`, `tests/helpers/` | Pruebas | Tests con `node:test` y utilidades compartidas. |
| `tests/e2e/` | Pruebas | Tests de navegador con Playwright. |
| `scripts/` | Infraestructura | `serve.mjs` (servidor local), `sync-sw.mjs` (`npm run pwa:sync`: caché y versión de `sw.js`) y `generate-icons.mjs` (`npm run icons`: PNG desde los SVG). |
| `docs/ARCHITECTURE.md` | Documentación | Diseño completo y contratos entre capas. |
| `.claude/agents/` | Equipo | Definición de los agentes que construyeron el proyecto. |
| `.github/workflows/ci.yml` | CI/CD | Tests y despliegue en GitHub Pages. |

**Estrategia offline.** El service worker (`site/sw.js`) guarda en caché, con un número de versión, todos los archivos de `site/` (precaché versionada). Cuando cambia la versión, se crea una caché nueva y se borran las cachés antiguas. Sin internet, la app sigue funcionando; la versión nueva se activa cuando pulsas **Recargar** en el aviso de actualización. El detalle técnico está en [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §16.

Para el diseño completo, consulta [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Cómo añadir un módulo

Ejemplo: un módulo de Docker. Sigue el contrato de módulo de `docs/ARCHITECTURE.md` §3.

1. **Crea la carpeta** `site/js/modules/docker/`. Dentro, como mínimo, `index.js`, `view.js` y `data.js`. Si el módulo necesita motor, parser o proyección, créalos también en esa carpeta, siguiendo el patrón de `modules/git/`.

2. **Escribe `index.js`.** Debe exportar por defecto un objeto con `id`, `title`, `createInitialState`, `run`, `project`, `prompt` y `data`. Un esqueleto mínimo:

   ```js
   // site/js/modules/docker/index.js — descriptor del módulo (sin DOM)
   import { createInitialState, execute } from './engine.js';
   import { parse } from './parser.js';
   import { project } from './projection.js';
   import * as data from './data.js';

   export default {
     id: 'docker',
     title: 'Docker',
     createInitialState,            // → estado nuevo cada vez

     // Nunca lanza por la entrada del usuario (ver git/index.js: entrada vacía y try/catch).
     run(state, text) {
       const parsed = parse(text);
       if (!parsed.ok) {
         return {
           ok: false, state, changed: false, commandId: null,
           output: parsed.output ?? [parsed.error.message],
           error: parsed.error, hint: parsed.hint ?? null,
           notes: [], effects: [], ui: null,
         };
       }
       return execute(state, parsed.cmd);
     },

     project,                       // estado → modelo de vista
     prompt: (state) => `${state.cwd} $`, // ajusta el prompt a tu módulo

     data: {
       meta: data.meta,
       commands: data.commands,
       extraCommands: data.extraCommands,
       errors: data.errors,
       scenario: data.scenario,     // { title, intro: string[], steps: [...] }
     },
   };
   ```

3. **Escribe `view.js`.** Exporta `createDockerView(root, { onCommand })`, que devuelve `{ render(projection, transition) → Promise<void>, destroy() }`. Solo dibuja la proyección y usa `onCommand` para enviar comandos. Sigue `modules/git/view.js` como referencia.

4. **Escribe `data.js`.** Exporta `meta`, `commands` (con `id`, `number`, `name`, `label`, `syntax`, `what`, `why`, `mistake`), `extraCommands`, `errors` (cada código con `title` y `explain`) y `scenario`. Consulta `modules/git/data.js` como ejemplo.

5. **Regístralo en `site/js/main.js`.** Importa el descriptor y la vista, crea el controlador y la vista, y pásalos a `createApp`.

   > Aviso: hoy `main.js` monta **un solo módulo**, y el selector de módulos de `index.html` es estático: Docker, Kubernetes y OT aparecen deshabilitados y no hay código que cambie de módulo. Para tener varios módulos activos, hará falta añadir ese cambio. Esta parte no está implementada todavía.

6. **Añade tests en `tests/unit/`.** Usa `node:test`. `tests/helpers/git.js` muestra cómo congelar el estado para detectar mutaciones accidentales.

---

## CI/CD

El workflow `.github/workflows/ci.yml` tiene dos trabajos:

- **`test`**: en cada Pull Request y en cada push a `main`. Instala Node 22 y las dependencias (`npm ci`), ejecuta `npm test`, instala Chromium y ejecuta `npm run test:e2e`.
- **`build-site`**: solo en push a `main` y si `test` pasa. Empaqueta la carpeta `site/` como artefacto de Pages.
- **`deploy`**: publica ese artefacto en GitHub Pages. Va en un job aparte para que, si GitHub falla de forma pasajera, se pueda reintentar solo este paso (*Re-run failed jobs*) sin duplicar el artefacto.

**Activación única de GitHub Pages.** Antes del primer despliegue, en el repositorio:

> *Settings → Pages → Build and deployment → Source: **GitHub Actions***

Todo es gratuito en repositorios públicos: GitHub Actions y GitHub Pages no tienen coste para este proyecto.

---

## Simplificaciones

El simulador no replica Git al 100 %. Estas simplificaciones están declaradas también en la interfaz (resumen de `docs/ARCHITECTURE.md` §14 y §14.1):

1. **Contenido de archivo como versión.** Si dos ramas cambian el mismo archivo, se trata como conflicto y la fusión se cancela. No hay resolución manual de conflictos.
2. **Hashes de 7 caracteres** generados de forma determinista. Git usa SHA-1 o SHA-256 de 40 o 64 caracteres.
3. **Sin detached HEAD**, sin `rebase`, `reset`, `restore`, `diff` ni `tag`.
4. **Un único servidor remoto simulado.** `pull` asume `pull.rebase=false`.
5. **Sin editor.** `git commit` necesita `-m`. La edición de archivos se simula con `edit` y `touch`.
6. **`stash pop` con conflicto** se cancela y conserva la entrada; no intenta fusionar.
7. **Las estadísticas de commit** cuentan archivos, no líneas.

---

## Mejoras futuras

- **Publicar en App Store y Google Play con Capacitor.** La base ya está preparada (`site/` sirve como `webDir`, rutas relativas, sin red externa). Pasos previstos (`docs/ARCHITECTURE.md` §16.8):
  - `npm i @capacitor/core @capacitor/cli`
  - `npx cap init "Laboratorio Visual" <appId>`, con `webDir: "site"` en la configuración.
  - `npx cap add ios` y `npx cap add android`.
  - Generar los iconos nativos desde `site/icons/icon.svg` (por ejemplo con `@capacitor/assets`).
  - Cuentas de desarrollador: Apple Developer Program (99 USD al año) y Google Play Console (25 USD, pago único).
  - **Tiene coste y requiere decisión del propietario**: las cuentas de tienda cuestan dinero y necesitan sus datos y credenciales. No se abrirán sin su aprobación.
- Capturas de pantalla en el manifest, para que la ficha de instalación sea más rica.
- Atajos (`shortcuts` del manifest) para ir directamente a un modo o a un comando.
- Notificación de la versión en el pie de la app.
- Resolución manual de conflictos (en `merge` y en `stash pop`) con un editor visual.
- Soporte de `git restore`, `git reset`, `git rebase`, `git diff`, `git tag` y detached HEAD.
- `git pull --rebase`, y elegir la estrategia cuando las ramas divergen, como hace Git moderno.
- Autocompletado con `Tab` en la consola.
- Escenarios guiados adicionales: conflicto, trabajo en equipo y hotfix.
- Módulos Docker, Kubernetes y OT.
- Registro de varios módulos y selector de módulo funcional en la cabecera (hoy `main.js` monta solo Git).
- Distinguir visualmente en la consola los comandos de preparación de los pasos guiados.
- Modo claro e idioma inglés.
- Persistencia del progreso en el navegador.
- Compartir un estado concreto mediante una URL.
- Elegir y añadir una licencia al repositorio (decisión pendiente del propietario).

---

## Cómo se construyó

El proyecto lo construyó un equipo de agentes definidos en `.claude/agents/`:

| Agente | Responsabilidad |
|---|---|
| **maestro** (sesión principal) | Arquitectura, reparto, integración, commits y decisiones finales. |
| **git-engine** | Motor de Git, parser, proyección, datos del módulo y controlador. |
| **ui-builder** | HTML, CSS, zonas, animaciones, responsive y accesibilidad. |
| **qa-tester** | Tests y revisión de las entregas contra los criterios de aceptación. |
| **docs-writer** | README y CHANGELOG. |

Flujo de trabajo: ramas por funcionalidad (`feat/...`, `fix/...`), commits con [Conventional Commits](https://www.conventionalcommits.org/es/v1.0.0/) en español y Pull Requests hacia `main`.
