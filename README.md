# Laboratorio Visual

![CI](https://github.com/amvelandia123/app-visual/actions/workflows/ci.yml/badge.svg)

Simulador web interactivo para aprender herramientas técnicas viendo qué hace cada comando.
El primer módulo es **Git**: verás cómo cada comando mueve archivos, crea commits y desplaza ramas entre cinco zonas.

**Demo:** https://amvelandia123.github.io/app-visual/ (estará disponible tras el primer despliegue en `main`).

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

`npm test` ejecuta los tests unitarios con `node --test`, sin dependencias.
`npm run test:e2e` usa Playwright con Chromium. Si es la primera vez, instala el navegador con:

```bash
npx playwright install chromium
```

> Aviso: la carpeta `tests/e2e/` todavía no contiene pruebas. El comando está preparado, pero aún no hay tests de navegador.

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
| `site/index.html`, `site/css/` | Interfaz | Esqueleto de la página y estilos (tokens en `base.css`). |
| `site/js/main.js` | Arranque | Monta la aplicación con el módulo Git. |
| `site/js/ui/` | Interfaz genérica | Consola, panel de pasos, «¿Qué pasó?», animador y `app.js`. |
| `site/js/core/controller.js` | Núcleo puro | Modo guiado y libre, historial y reconstrucción de estados. |
| `site/js/modules/git/` | Módulo Git | `engine.js`, `parser.js`, `projection.js`, `data.js`, `index.js` (puros) y `view.js` (DOM). |
| `tests/unit/`, `tests/helpers/` | Pruebas | Tests con `node:test` y utilidades compartidas. |
| `tests/e2e/` | Pruebas | Tests de navegador con Playwright (pendiente). |
| `scripts/serve.mjs` | Infraestructura | Servidor estático local. |
| `docs/ARCHITECTURE.md` | Documentación | Diseño completo y contratos entre capas. |
| `.claude/agents/` | Equipo | Definición de los agentes que construyeron el proyecto. |
| `.github/workflows/ci.yml` | CI/CD | Tests y despliegue en GitHub Pages. |

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
- **`deploy`**: solo en push a `main` y si `test` pasa. Publica la carpeta `site/` en GitHub Pages.

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

- Resolución manual de conflictos (en `merge` y en `stash pop`) con un editor visual.
- Soporte de `git restore`, `git reset`, `git rebase`, `git diff`, `git tag` y detached HEAD.
- `git pull --rebase`, y elegir la estrategia cuando las ramas divergen, como hace Git moderno.
- Autocompletado con `Tab` en la consola.
- Escenarios guiados adicionales: conflicto, trabajo en equipo y hotfix.
- Módulos Docker, Kubernetes y OT.
- Tests de navegador (`tests/e2e/`) con Playwright.
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
