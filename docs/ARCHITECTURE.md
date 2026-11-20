# Arquitectura — Laboratorio Visual (`app-visual`)

> Documento de diseño y **contrato entre capas**. Los agentes implementan exactamente lo que
> aquí se define. Si algo no cuadra al implementar, se documenta la decisión en este archivo.

Índice: 1 Visión · 2 Capas y carpetas · 3 Contrato de módulo · 4 Estado de Git ·
5 Semántica de comandos · 6 Parser · 7 Proyección · 8 Controlador · 9 Escenario guiado ·
10 Interfaz · 11 Accesibilidad y responsive · 12 Tests y QA · 13 CI/CD ·
14 Simplificaciones · 15 Tareas por fase

---

## 1. Visión

Web estática (GitHub Pages) que simula visualmente Git. El usuario ve a la vez cinco zonas
(WORKING TREE, STAGING, STASH, LOCAL REPO, REMOTE · ORIGIN) y cómo cada comando mueve
archivos, crea commits y desplaza ramas. Dos modos:

- **Guiado**: un escenario coherente de 10 pasos (`git init` … `git push`) con
  Anterior / Siguiente / Auto-play / Reiniciar.
- **Libre**: el usuario escribe comandos; errores didácticos en español al estilo de Git.

Panel **«¿Qué pasó?»**: qué hizo el comando, por qué se usa, error típico de principiante y,
si aplica, qué se ha simplificado.

## 2. Capas y carpetas

```
              ┌─────────────────────────── navegador ───────────────────────────┐
 texto ─────► │ ui/console.js ──► core/controller.js ──► module.run(state,text) │
              │      ▲                    │  (puro)            │ parser+engine  │
              │      │              snapshot + transiciones    ▼ (puros)        │
              │ ui/app.js ◄──────────────┘          module.project(state)       │
              │   ├─ ui/stepper.js   (panel 01–10)          │ (puro)          │
              │   ├─ ui/explain.js   («¿Qué pasó?»)          ▼                 │
              │   └─ modules/git/view.js (zonas) + ui/animator.js (FLIP)        │
              └─────────────────────────────────────────────────────────────────┘
```

| Archivo | Capa | DOM | Responsable |
|---|---|---|---|
| `site/js/modules/git/engine.js` | motor | ❌ | git-engine |
| `site/js/modules/git/parser.js` | motor | ❌ | git-engine |
| `site/js/modules/git/projection.js` | motor→vista | ❌ | git-engine |
| `site/js/modules/git/data.js` | datos | ❌ | git-engine |
| `site/js/modules/git/index.js` | descriptor | ❌ | git-engine |
| `site/js/core/controller.js` | núcleo | ❌ | git-engine |
| `site/js/modules/git/view.js` | interfaz | ✅ | ui-builder |
| `site/js/ui/{app,console,stepper,explain,animator}.js` | interfaz | ✅ | ui-builder |
| `site/js/main.js`, `site/index.html`, `site/css/*.css` | interfaz | ✅ | ui-builder |
| `tests/unit/*.test.js`, `tests/e2e/*.test.js` | QA | — | qa-tester |
| `scripts/serve.mjs`, `package.json` | infraestructura | — | maestro |

Todo el código del navegador usa rutas relativas (`./js/...`) para funcionar bajo
`https://<usuario>.github.io/app-visual/`.

## 3. Contrato de módulo

Un módulo es un objeto (export por defecto de `modules/<id>/index.js`) **sin DOM**:

```js
export default {
  id: 'git',
  title: 'Git',
  createInitialState(),          // → State (nuevo objeto cada vez)
  run(state, text),              // → Result  (parse + execute; nunca lanza por input del usuario)
  project(state),                // → Projection (modelo de vista, §7)
  prompt(state),                 // → string del prompt: '~/tienda $' | '(main) $'
  data: { meta, commands, extraCommands, errors, scenario }, // §4.5 y §9
};
```

La vista del módulo se registra aparte (porque usa DOM):
`modules/git/view.js` exporta `createGitView(rootElement, { onCommand })` → `{ render(projection, transition?) → Promise<void>, destroy() }`.

### 3.1 Result (salida de `run`)

```js
{
  ok: boolean,               // false si el comando falla (el estado NO cambia)
  state: State,              // estado resultante (=== estado de entrada si ok=false o sin cambios)
  changed: boolean,          // true si el estado cambió
  commandId: string | null,  // 'init'|'status'|'add'|'commit'|'branch'|'switch'|'merge'|'stash'|'pull'|'push'
                             // o extra: 'log'|'remote'|'fetch'|'checkout'|'edit'|'touch'|'ana-push'|'ls'|'help'|'clear'
  output: string[],          // líneas de consola (al estilo de Git en español), incluidas las de error
  error: null | { code: string, message: string },   // code ∈ §5.13
  hint: string | null,       // consejo didáctico en español (se muestra con 💡)
  notes: string[],           // aclaraciones contextuales ("Ha sido un fast-forward porque…", simplificaciones)
  effects: Effect[],         // pistas para animar (opcionales, la UI anima también por diff)
  ui: null | { clear: true } // acciones de interfaz (solo `clear`)
}
```

`Effect` ∈ `{type:'commit', id}`, `{type:'merge', id, kind:'fast-forward'|'merge-commit'}`,
`{type:'push', ids:[...]}`, `{type:'fetch', ids:[...]}`, `{type:'stash-push'}`,
`{type:'stash-pop'}`, `{type:'switch', from, to}`, `{type:'remote-commit', id}`.

## 4. Estado de Git (motor)

Objeto plano, serializable con `JSON.stringify`, **inmutable** desde fuera (el motor clona con
`structuredClone` y nunca muta la entrada).

```js
State = {
  cwd: '~/tienda',
  seq: 0,                          // contador global → hashes y versiones deterministas
  versions: { 'app.js': 1, ... },  // última versión generada por archivo
  worktree: { 'app.js': 'app.js@v1', 'cart.js': 'cart.js@v1', 'style.css': 'style.css@v1' },
  repo: null | Repo,               // null hasta `git init`
  server: {                        // el repositorio en GitHub ("origin"), siempre existe
    url: 'https://github.com/equipo/tienda.git',
    branches: { /* nombre → commitId */ },   // empieza vacío
  },
  objects: { /* commitId → Commit */ },      // almacén ÚNICO de commits (local + servidor)
}

Repo = {
  index: { /* path → Content */ },   // staging area completo (tras commit === árbol de HEAD)
  branches: { /* nombre → commitId */ },// una rama sin commits ("unborn") NO aparece aquí
  head: 'main',                       // HEAD simbólico: SIEMPRE una rama (sin detached HEAD)
  stash: StashEntry[],                // stash[0] === stash@{0} (el más reciente)
  remotes: { /* nombre → url */ },    // `git remote add`
  tracking: { /* 'origin/main' → commitId */ }, // ramas de seguimiento remoto
  upstream: { /* 'main' → 'origin/main' */ },   // `push -u` / `--set-upstream`
}

Commit = { id, message, parents: string[], tree: { path → Content }, author: 'Andrés'|'Ana', seq }
Content = string                     // token de versión, p. ej. 'cart.js@v2'
StashEntry = {
  message,                           // 'WIP on main: a1b2c3d Primera versión…' u 'On main: <msg>'
  branch, base,                      // rama y commit sobre los que se guardó
  index: { path → Content },         // instantánea completa del índice
  worktree: { path → Content },      // instantánea de los archivos rastreados (+ sin seguimiento si -u)
  includeUntracked: boolean,
}
```

### 4.1 Derivados (funciones puras exportadas por `engine.js`)

- `headCommit(state)` → id | null; `headTree(state)` → `{}` si no hay commits.
- `getStatus(state)` → `{ staged: [{path, kind:'new'|'modified'|'deleted'}], unstaged: [{path, kind:'modified'|'deleted'}], untracked: [path] }`
  - staged: `index[p] !== headTree[p]` para p ∈ index ∪ headTree.
  - unstaged: p ∈ index y `worktree[p] !== index[p]`.
  - untracked: p ∈ worktree y p ∉ index.
- `isAncestor(state, a, b)` (¿a es ancestro de b o igual?), `mergeBase(state, a, b)`
  (ancestro común con mayor `seq`), `reachable(state, ids)` (conjunto alcanzable).
- `aheadBehind(state, branch)` → `{ upstream, ahead, behind } | null`.

### 4.2 Identificadores deterministas

`id` = 7 caracteres hex de FNV‑1a 32 bits sobre
`` `${seq}|${message}|${parents.join(',')}|${JSON.stringify(sortedTree)}` `` (rellenar con ceros).
El mismo historial produce siempre los mismos ids (necesario para replay y tests).
Contenido nuevo de un archivo: `versions[path]++` → `'<path>@v<n>'`.

### 4.3 Estado inicial

Carpeta `~/tienda` con `app.js`, `cart.js`, `style.css` (todos `@v1`), `repo: null`,
servidor vacío, `seq: 0`. Autor local «Andrés», compañera «Ana».

### 4.4 Visibilidad de commits

- Grafo LOCAL: commits alcanzables desde `repo.branches` ∪ `repo.tracking`.
- Grafo REMOTO: commits alcanzables desde `server.branches`.
  (Un commit que Ana sube al servidor existe en `objects` pero no se ve en local hasta `fetch`/`pull`.)

### 4.5 `data.meta`

`{ cwd: '~/tienda', absPath: '/home/andres/tienda', remoteUrl: 'https://github.com/equipo/tienda.git', user: 'Andrés', teammate: 'Ana', defaultBranch: 'main' }`

## 5. Semántica de comandos

Salidas al estilo de Git en español (aproximadas; mensajes de commit por defecto de Git en
inglés como hace Git real: `Merge branch 'x'`). Todo comando git distinto de `init` sobre una
carpeta sin repo → `NOT_A_REPO`: `fatal: no es un repositorio git (ni ninguno de los directorios superiores): .git`.

### 5.1 `git init`
- Crea `repo` con `head: 'main'` (se asume `init.defaultBranch=main`; nota en explicación), índice vacío.
- Salida: `Inicializado repositorio Git vacío en /home/andres/tienda/.git/`.
- Si ya existe: `Reinicializado el repositorio Git existente en /home/andres/tienda/.git/` (ok, sin cambios).

### 5.2 `git status`
Formato (secciones solo si tienen contenido):
```
En la rama main
[No hay commits todavía]                              ← si la rama no tiene commits
[Tu rama está actualizada con 'origin/main'.]         ← si hay upstream (ver ahead/behind abajo)
Cambios a ser confirmados:
  (usa "git restore --staged <archivo>..." para sacar del área de stage)
	nuevo archivo:  app.js | modificado:     app.js
Cambios no rastreados para el commit:
  (usa "git add <archivo>..." para actualizar lo que será confirmado)
	modificado:     style.css
Archivos sin seguimiento:
  (usa "git add <archivo>..." para incluirlo a lo que será confirmado)
	cart.js
<pie>
```
Pie: limpio → `nada para hacer commit, el árbol de trabajo está limpio`; solo sin seguimiento →
`no hay nada agregado al commit pero hay archivos sin seguimiento presentes (usa "git add" para hacerles seguimiento)`;
cambios no preparados sin nada preparado → `sin cambios agregados al commit (usa "git add" y/o "git commit -a")`.
Ahead/behind: `Tu rama está adelantada a 'origin/main' por N commit(s).` /
`Tu rama está detrás de 'origin/main' por N commit(s), y puede ser avanzada rápido.` /
`Tu rama y 'origin/main' han divergido, y tienen N y M commits diferentes cada una, respectivamente.`
(Git no hace fetch en `status`: compara con la última información conocida, y la explicación lo dice.)

### 5.3 `git add`
- `git add .` | `-A` | `--all`: prepara todo (sin seguimiento + modificados). Sin salida.
- `git add <ruta>...`: cada ruta debe existir en worktree o índice; si no →
  `PATHSPEC`: `fatal: ruta especificada 'x' no concordó con ningún archivo`.
- Sin argumentos → `NOTHING_SPECIFIED`: `Nada especificado, nada agregado.` + `hint: Tal vez quisiste decir 'git add .'?`
- Efecto: `index[p] = worktree[p]`.

### 5.4 `git commit`
- Requiere `-m "<msg>"` (acepta `-m msg`, `-m "msg con espacios"`, `-am "msg"`, `-a -m`, `--message=`).
  Sin `-m` → `NEEDS_MESSAGE` (en Git real se abriría un editor; aquí no hay editor).
- `-a`: antes de confirmar, prepara los archivos **rastreados** modificados (no los sin seguimiento).
- Nada preparado → `NOTHING_TO_COMMIT` (árbol limpio) o `NOTHING_STAGED` (hay cambios sin preparar
  o sin seguimiento); la salida reproduce el `status` correspondiente.
- Crea `Commit { parents: head ? [head] : [], tree: copia(index), author:'Andrés' }`, `seq++`,
  mueve la rama actual. Salida: `[main (commit-raíz) a1b2c3d] mensaje` (raíz) o `[main a1b2c3d] mensaje`
  y ` N archivo(s) cambiado(s)`. Effect `commit`.

### 5.5 `git branch`
- Sin args: lista ordenada, `* ` delante de la actual. Sin commits → salida vacía.
- `git branch <nombre>`: en el commit actual. Sin commits → `NO_COMMITS`
  (`fatal: no es un nombre de objeto válido: 'main'.`). Existe → `BRANCH_EXISTS`
  (`fatal: ya existe una rama llamada 'x'.`). Nombre inválido (espacios, `..`, empieza por `-` o `/`,
  termina en `/` o `.lock`, contiene `~^:?*[\`) → `INVALID_BRANCH_NAME`.
- `-d <nombre>`: actual → `BRANCH_IN_USE`; no fusionada en HEAD → `BRANCH_NOT_MERGED`
  (sugiere `-D`); no existe → `BRANCH_NOT_FOUND`. `-D` fuerza. Salida `Eliminada la rama x (era a1b2c3d).`

### 5.6 `git switch` (y alias `git checkout`)
- `git switch <rama>`: no existe → `INVALID_REF` (`fatal: referencia inválida: x`) + hint
  `¿Querías crearla? usa git switch -c x`. Misma rama → `Ya en 'main'` (ok).
- `git switch -c <rama>`: crea + cambia (si existe → `BRANCH_EXISTS`). Funciona también sin commits
  (renombra la rama "unborn").
- Algoritmo: `from = headTree`, `to = árbol destino`. Para cada p con `from[p] !== to[p]`:
  si p está sucio (`worktree[p] !== index[p]` o `index[p] !== from[p]`) → conflicto →
  `LOCAL_CHANGES_OVERWRITTEN`: `error: Tus cambios locales a los siguientes archivos serían sobrescritos por checkout:` + lista +
  `Por favor, confirma tus cambios o guárdalos antes de cambiar de rama.` + `Abortando`.
  Si `to[p]` existe y p está sin seguimiento con contenido distinto → `UNTRACKED_OVERWRITTEN`.
  Sin conflictos: para esos p, `index[p] = worktree[p] = to[p]` (o se borran si `to[p]` no existe).
  Los cambios locales que no chocan **viajan** con el usuario a la otra rama.
- Salida: `Cambiado a rama 'x'` / `Cambiado a nueva rama 'x'`. Effect `switch`.
- `git checkout <rama>` ≡ switch; `git checkout -b <rama>` ≡ `switch -c` (nota: hoy se recomienda `switch`).

### 5.7 `git merge <ref>`
- `<ref>`: rama local o ref de seguimiento (`origin/main`). Sin arg → `MISSING_ARG`.
  No existe → `INVALID_REF` (`merge: x - no es algo que podamos fusionar`).
- Destino ya contenido en HEAD → `Ya está actualizado.` (ok, sin cambios).
- Rama actual sin commits → avance rápido a destino.
- **Fast-forward** (HEAD es ancestro del destino, sin `--no-ff`): solo mueve la rama;
  actualiza índice/worktree de los archivos que cambian (mismas reglas de conflicto local que switch,
  con `merge` en lugar de `checkout` en el mensaje). Salida:
  `Actualizando a1b2c3d..e4f5a6b` / `Avance rápido` / ` cart.js | cambiado`. Effect `merge` kind `fast-forward`.
- **Merge de 3 vías** (historias divergentes o `--no-ff`): base = `mergeBase`. Por archivo:
  ours===base → theirs; theirs===base → ours; ours===theirs → ours; si no → **conflicto**.
  - Con conflicto → `MERGE_CONFLICT`: `Auto-fusionando app.js` / `CONFLICTO (contenido): Conflicto de fusión en app.js` /
    `Fusión automática falló; arregla los conflictos y luego realiza un commit con el resultado.`
    + nota de simplificación: el simulador **cancela** la fusión (equivale a `git merge --abort`); estado intacto.
  - Cambios locales sucios en archivos que la fusión modifica → `LOCAL_CHANGES_OVERWRITTEN`.
  - Éxito: commit con `parents: [head, destino]`, mensaje `Merge branch '<rama>'`
    (o `Merge remote-tracking branch 'origin/main'`), salida `Merge hecho por la estrategia 'ort'.` + archivos.
    Effect `merge` kind `merge-commit`.

### 5.8 `git stash`
- `git stash` ≡ `git stash push`. Opciones: `-m "<msg>"`, `-u`/`--include-untracked`.
  Sin commits → `NO_COMMITS` (`No tienes el commit inicial todavía`).
  Sin cambios rastreados (ni sin seguimiento con `-u`) → `No hay cambios locales para guardar` (ok, sin cambios).
- Éxito: inserta entrada al principio; `index = headTree`; archivos rastreados del worktree = headTree;
  con `-u` también se retiran los sin seguimiento. Los sin seguimiento sin `-u` se quedan en el worktree.
  Salida: `Directorio de trabajo y estado de índice WIP on main: a1b2c3d <msg> guardados`. Effect `stash-push`.
- `git stash list`: `stash@{0}: WIP on main: a1b2c3d <msg>` (más reciente primero).
- `git stash pop` | `apply` [`stash@{n}`]: sin entradas → `NO_STASH` (`error: No se encontraron entradas de stash.`).
  Cambios del stash = diferencias de `entry.worktree` respecto a `base.tree` (+ sin seguimiento con -u).
  Conflicto si p (cambiado en el stash) está sucio en el worktree actual, o si el HEAD actual
  cambió p respecto a `base` → `STASH_CONFLICT`, el stash se conserva
  (`La entrada de stash se guardó en caso de que la vuelvas a necesitar.`).
  Éxito: aplica al worktree; los archivos **nuevos** (añadidos al índice en el stash) quedan
  preparados; las modificaciones que estaban preparadas vuelven **sin preparar** (como Git sin `--index`).
  `pop` elimina la entrada (`Descartado refs/stash@{0} (a1b2c3d…)`), `apply` no. Effect `stash-pop`.
- `git stash drop` [`stash@{n}`]: elimina la entrada.

### 5.9 `git remote`
- `git remote` → nombres; `git remote -v` → `origin\t<url> (fetch)` y `(push)`.
- `git remote add <nombre> <url>`: existe → `REMOTE_EXISTS` (`error: remoto origin ya existe.`).
  Faltan args → `MISSING_ARG`. Todos los remotos apuntan al único servidor simulado (simplificación).

### 5.10 `git fetch` [`<remoto>`]
Sin remoto → `NO_REMOTE`. Copia `server.branches[b]` → `tracking['origin/b']`. Salida tipo
`Desde https://github.com/equipo/tienda.git` / ` * [nueva rama]      main       -> origin/main` /
`   a1b2c3d..e4f5a6b  main       -> origin/main`. Sin novedades → sin salida. Effect `fetch`.

### 5.11 `git pull` [`<remoto> <rama>`]
- Sin remoto → `NO_REMOTE`. Sin args y sin upstream → `NO_UPSTREAM`
  (`No hay información de rastreo para la rama actual.` + cómo usar `git pull <remoto> <rama>` o
  `git branch --set-upstream-to=origin/<rama> main`).
- Rama remota inexistente en el servidor → `REMOTE_REF_NOT_FOUND` (`fatal: no se encontró la referencia remota main`).
- = `fetch` + `merge` de `origin/<rama>` en la rama actual (fast-forward o commit de merge
  `Merge branch 'main' of https://github.com/equipo/tienda.git`; conflictos como §5.7).
  Se asume `pull.rebase=false` configurado (sin él, Git moderno pide elegir estrategia ante ramas
  divergentes): la explicación lo indica. `--rebase` → `UNSUPPORTED`.

### 5.12 `git push` [`-u`|`--set-upstream`] [`<remoto>` [`<rama>`]]
- Sin remoto → `NO_REMOTE` (`fatal: No se ha configurado un destino para el push.` + pasos con `git remote add`).
- Sin args y sin upstream → `NO_UPSTREAM`:
  `fatal: La rama actual main no tiene una rama upstream.` /
  `Para hacer push de la rama actual y establecer el remoto como upstream, usa` / `    git push --set-upstream origin main`.
- Rama local sin commits → `NO_COMMITS` (`error: src refspec main no concuerda con ninguno`).
- Si el servidor tiene la rama y **no** es ancestro del local → `PUSH_REJECTED`:
  ` ! [rechazado]        main -> main (fetch first)` / `error: falló el push de algunas referencias a '<url>'` /
  `ayuda: Las actualizaciones fueron rechazadas porque el remoto contiene trabajo que no tienes localmente…`.
- Igual que el servidor → `Todo actualizado` (ok, sin cambios).
- Éxito: `server.branches[b] = local`, `tracking['origin/b'] = local`; con `-u` fija `upstream[b]`
  (`rama 'main' configurada para rastrear 'origin/main'.`). Salida `To <url>` + ` * [new branch]      main -> main`
  o `   a1b2c3d..e4f5a6b  main -> main`. Effect `push` con los ids nuevos en el servidor.

### 5.13 Códigos de error
`NOT_A_REPO, BAD_SYNTAX, NOT_GIT, UNKNOWN_COMMAND, UNSUPPORTED, INVALID_OPTION, MISSING_ARG,
PATHSPEC, NOTHING_SPECIFIED, NEEDS_MESSAGE, NOTHING_TO_COMMIT, NOTHING_STAGED, NO_COMMITS,
BRANCH_EXISTS, INVALID_BRANCH_NAME, BRANCH_NOT_FOUND, BRANCH_IN_USE, BRANCH_NOT_MERGED,
INVALID_REF, LOCAL_CHANGES_OVERWRITTEN, UNTRACKED_OVERWRITTEN, MERGE_CONFLICT, NO_STASH,
STASH_CONFLICT, NO_REMOTE, REMOTE_EXISTS, NO_UPSTREAM, REMOTE_REF_NOT_FOUND, PUSH_REJECTED,
FILE_NOT_FOUND, FILE_EXISTS`.
Cada código tiene en `data.errors[code]` un `{ title, explain }` didáctico en español.

### 5.14 Comandos auxiliares (no son Git; simulan el editor y al equipo)
| Comando | Efecto |
|---|---|
| `edit <archivo>` | "editas" el archivo: nueva versión de contenido. No existe → `FILE_NOT_FOUND` (sugiere `touch`). |
| `touch <archivo>` | crea un archivo vacío sin seguimiento; si ya existe, no cambia nada. |
| `ls` | lista los archivos de la carpeta. |
| `ana-push [archivo]` | Ana (la compañera) sube al servidor un commit que edita `archivo` (por defecto `app.js`) sobre `server.branches.main`. Si el servidor aún no tiene `main` → error didáctico (`haz primero git push -u origin main`). Effect `remote-commit`. |
| `help` | lista de comandos soportados. |
| `clear` | limpia la consola (`ui: {clear:true}`). |
Cualquier otra cosa que no empiece por `git` → `NOT_GIT` con sugerencia de `help`.

## 6. Parser (`parser.js`)

`parse(text) → { ok: true, cmd } | { ok: false, error: {code, message}, hint }`

- Tokeniza respetando comillas simples y dobles (`-m "hola mundo"`); comilla sin cerrar → `BAD_SYNTAX`.
- `cmd = { program: 'git'|'edit'|'touch'|'ls'|'ana-push'|'help'|'clear', sub: 'add'|…|null, args: string[], flags: {…}, raw }`.
- Flags normalizadas por subcomando (p. ej. commit: `{ message, all }`; switch: `{ create }`;
  branch: `{ delete, force }`; merge: `{ noFf }`; stash: `{ action:'push'|'pop'|'apply'|'list'|'drop', message, includeUntracked }`;
  push: `{ setUpstream }`; remote: `{ action:'list'|'add', verbose }`; log: `{ oneline }`).
  Combinaciones `-am`, `-m=` y `--message=` soportadas. Flag desconocida → `INVALID_OPTION`
  (`error: opción desconocida 'x'`).
- Subcomando git desconocido → `UNKNOWN_COMMAND` con sugerencia por distancia de Levenshtein
  (`git: 'comit' no es un comando de git. Mira 'git --help'.` / `El comando más parecido es` / `\tcommit`).
- Subcomandos reales no simulados (`restore, reset, rebase, diff, rm, mv, clone, tag, cherry-pick, revert, show`)
  → `UNSUPPORTED` (“aún no está en el simulador v1”).
- `git log [--oneline] [--all]` también se soporta (lista desde HEAD por `seq` descendente;
  decoraciones `(HEAD -> main, origin/main, feature/carrito)`).

## 7. Proyección (`projection.js`) — único contrato que consume la interfaz

```js
project(state) → {
  initialized: boolean,
  prompt: string,                         // '~/tienda $' antes de init; '(main) $' después
  branch: string | null,                  // rama actual
  working: [{ path, status: 'untracked'|'modified' }],  // cambios NO preparados + sin seguimiento (orden alfabético)
  clean:   [path],                        // archivos del worktree sin cambios respecto al índice ni sin seguimiento (atenuados)
  staging: [{ path, status: 'new'|'modified' }],         // cambios preparados (índice ≠ HEAD)
  stash:   [{ ref: 'stash@{0}', message, files: [path] }],
  local:  Graph,                          // §4.4
  remote: { connected: boolean, name: 'origin'|null, url, graph: Graph },
  sync:   null | { branch, upstream: 'origin/main', ahead, behind },
}
Graph = {
  commits: [{ id, message, parents, author, lane, column }],    // ordenados por column
  refs: [{ name, kind: 'branch'|'head'|'tracking', target, current: boolean }],
  lanes: number,
  unborn: string | null,                  // rama actual sin commits ('main') o null (solo local)
}
```

- Antes de `git init`: `working` = todos los archivos como `untracked`, grafos vacíos.
- Un archivo puede estar a la vez en `staging` y en `working` (preparado y luego editado de nuevo).
- `column` = posición por `seq` ascendente dentro de ese grafo (0..n-1).
- `lane` (determinista): se recorren las refs en este orden → `main`, resto de ramas locales en
  orden alfabético, refs de seguimiento; para cada una se sigue la cadena de **primer padre**
  desde su punta asignando el siguiente carril libre a los commits aún sin carril
  (un carril nuevo solo si la ref aportó algún commit). Commits restantes → carriles nuevos.
  Tras un fast-forward un commit puede cambiar de carril: es correcto (la historia es lineal) y la UI lo anima.
- refs locales: cada rama (`kind:'branch'`, `current` si es HEAD), `HEAD` (`kind:'head'`, target = commit actual;
  se omite si unborn) y `origin/x` (`kind:'tracking'`). refs remotas: ramas del servidor con nombre sin prefijo.

## 8. Controlador (`core/controller.js`, genérico y puro)

```js
createController(module) → {
  getSnapshot(), next(), prev(), goTo(n), reset(), run(text), subscribe(fn) → unsubscribe
}
Snapshot = {
  mode: 'guided'|'free', step: 0..total, total, state,
  log: LogEntry[],          // { kind: 'command'|'output'|'error'|'hint'|'note'|'narration'|'system', text, prompt? }
  lastCommandId, lastResult, lastStep /* paso guiado actual o null */, offScript: boolean,
}
Transition = { kind: 'pre'|'command'|'jump'|'reset', text?, result?, from: State, to: State }
```

- `next()`: si `step === total` → `[]`. Si `offScript`, primero una transición `jump` que reconstruye el
  estado del paso actual por replay (y un log `system` "↺ Volviendo al escenario guiado"). Después ejecuta
  cada `before[i]` (log `narration` si la tiene + `command` + salida; transición `pre`) y el comando principal
  (transición `command`). `step++`, `mode='guided'`. Si algún paso del escenario falla → `throw` (es un bug).
- `prev()` = `goTo(step - 1)`; `goTo(n)` reconstruye desde el estado inicial ejecutando los pasos 1..n
  (log incluido) y emite **una** transición `jump`. `reset()` → estado inicial, `step 0`, log con un mensaje
  de bienvenida (`system`), transición `reset`.
- `run(text)` (modo libre): ignora vacío; `module.run`; log: `command` (con el prompt previo), `output`
  (o `error` si `!ok`), `hint`, `note`s; si `ui.clear` vacía el log. `mode='free'`, `offScript=true`.
- Cada acción notifica a los suscriptores `(snapshot, transitions)` **una vez**, después de calcular todo.
- El controlador es determinista: mismo escenario → mismos estados (tests de replay).

## 9. Escenario guiado (`data.scenario`)

Historia: Andrés crea la tienda online `~/tienda` (app.js, cart.js, style.css) y colabora con Ana.
Cada paso: `{ id, command, label, before: [{ command, narration? }], narration }`.
Los `before` son acciones previas reales (se ejecutan con el motor) para que el paso tenga sentido.

| # | id | before (preparación) | comando | resultado esperado |
|---|---|---|---|---|
| 01 | init | — | `git init` | repo vacío en `main` |
| 02 | status | — | `git status` | 3 archivos sin seguimiento |
| 03 | add | — | `git add .` | 3 archivos en STAGING |
| 04 | commit | — | `git commit -m "Primera versión de la tienda"` | C1, main → C1 |
| 05 | branch | — | `git branch feature/carrito` | nueva etiqueta en C1 |
| 06 | switch | — | `git switch feature/carrito` | HEAD → feature/carrito |
| 07 | merge | `edit cart.js` · `git commit -am "Calcula el total del carrito"` · `git switch main` · `edit app.js` · `git commit -am "Mejora la portada"` | `git merge feature/carrito` | commit de merge con 2 padres (las líneas se unen) |
| 08 | stash | `edit style.css` (rediseño a medias; Ana avisa de cambios urgentes) | `git stash` | style.css pasa a STASH, árbol limpio |
| 09 | pull | `git remote add origin https://github.com/equipo/tienda.git` · `git push -u origin main` · `ana-push cart.js` | `git pull` | fast-forward al commit de Ana |
| 10 | push | `git stash pop` · `git commit -am "Rediseña los botones"` | `git push` | origin/main = main, ahead 0 |

La narración del paso 07 explica que, si `main` no hubiera avanzado, habría sido un fast-forward
(probable en modo libre). La del 09 aclara que el primer `push -u` se hizo como preparación y que
el paso 10 lo explica a fondo.

`data.commands` = los 10 en orden:
`{ id, number:'01', name:'git init', label:'NEW REPO', syntax, what, why, mistake, simplification? }`.
Etiquetas: NEW REPO, WHAT CHANGED, STAGE FILES, SAVE SNAPSHOT, NEW LINE, MOVE HEAD, JOIN LINES,
SHELVE WORK, DOWNLOAD, UPLOAD. `data.extraCommands[id]` = `{ name, what, why, mistake? }`.

## 10. Interfaz

### 10.1 Diseño visual (original, estética de consola)
Tokens en `site/css/base.css`:

| token | valor | uso |
|---|---|---|
| `--bg` | `#050a16` | fondo azul marino muy oscuro |
| `--panel` / `--panel-2` | `#0a1324` / `#0e1a31` | tarjetas y zonas |
| `--line` | `#1b2a47` | bordes, rejilla |
| `--text` / `--muted` | `#d7e3ff` / `#8295bb` | texto (AA sobre `--bg`) |
| `--green` | `#3dffa2` | neón: paso activo, HEAD, éxito, LOCAL REPO |
| `--cyan` | `#2fd6f0` | STAGING, foco, enlaces |
| `--amber` | `#ffc145` | WORKING TREE, avisos |
| `--violet` | `#b18cff` | STASH |
| `--blue` | `#4d8dff` | check de paso completado, REMOTE |
| `--red` | `#ff5d7d` | errores |

Tipografía monoespaciada: `"JetBrains Mono"` (Google Fonts, `display=swap`) con respaldo
`ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`. Detalles: rejilla tenue de fondo,
brillo (`box-shadow`) neón sutil en elementos activos, esquinas 10–12 px.

### 10.2 Disposición
- **Cabecera**: «LABORATORIO VISUAL» + selector de módulo (Git activo; Docker/Kubernetes/OT deshabilitados «pronto»).
- **Panel de comandos**: 10 botones en 2 columnas (01–05 / 06–10): número, `git <cmd>`, etiqueta.
  `data-status`: `done` (check azul ✓), `active` (resaltado verde neón), `pending`. Clic → `goTo(n)`.
- **Consola**: historial (`(main) $ git add .` + salida; errores en rojo; 💡 hints en ámbar; narraciones en
  cursiva atenuada), contador `03/10` (o `LIBRE`), campo de entrada con el prompt actual, historial ↑/↓.
- **Controles**: ◀ Anterior · Siguiente ▶ · ⏵ Auto-play (⏸) · ↺ Reiniciar.
- **Escenario (stage)**: WORKING TREE · STAGING · STASH en una fila; LOCAL REPO (ancho) · REMOTE · ORIGIN debajo.
  Todas visibles a la vez en escritorio.
- **«¿Qué pasó?»**: narración del paso, qué hizo, por qué se usa, error típico, simplificación, notas y,
  si hubo error, su explicación (`data.errors[code]`).

### 10.3 Zonas (`modules/git/view.js`)
- Tarjetas de archivo (`app.js`, `cart.js`, `style.css`…) con icono, nombre y estado (U / M / A).
  WORKING TREE muestra además los archivos limpios atenuados (botón ✎ para `edit`).
- STASH: pila de entradas `stash@{n}` con sus archivos.
- LOCAL REPO: grafo horizontal (columna = x, carril = y). Nodos con hash corto (mensaje en `title`/tooltip),
  aristas en SVG, etiquetas de rama (verde la actual), `HEAD` (pegada a su rama), `origin/main` (azul).
  Indicador de sincronización `↑ahead ↓behind`.
- REMOTE · ORIGIN: URL, estado (conectado o no) y su grafo; botón «☁ Simular push de Ana» (`ana-push`).

### 10.4 Animaciones (`ui/animator.js`)
- La UI reproduce las transiciones del controlador **en cola** (una tras otra): `pre` ~400 ms,
  `command` ~700 ms, `jump`/`reset` sin vuelos (fundido corto). Durante la cola `body[data-animating="true"]`.
- **FLIP por clave**: antes de renderizar se miden los rectángulos de cada elemento con `data-anim-key`;
  tras renderizar, los que cambiaron de sitio se animan desde la posición anterior con Web Animations API.
  Para cruzar de zona se usa un **clon fantasma** en una capa `position: fixed` (no lo recortan los
  `overflow` de las zonas).
- Archivos (clave = ruta): working → staging (`add`), staging → nodo del commit nuevo y desaparece (`commit`),
  working/staging → stash (`stash`), stash → working/staging (`pop`).
- Commits: el nodo nuevo aparece con escala + brillo; las etiquetas de rama/HEAD se deslizan.
  `push`: un clon del nodo local vuela al grafo remoto; `pull`/`fetch`: del remoto al local.
- `prefers-reduced-motion: reduce` → sin vuelos ni transiciones (cambios instantáneos).

### 10.5 Contrato DOM (para tests e2e)
| Selector | Significado |
|---|---|
| `#command-form`, `#command-input`, `#prompt-label` | entrada del modo libre y prompt actual |
| `#console-log`, `#console-counter` | historial de consola, contador `03/10` / `LIBRE` |
| `#btn-prev`, `#btn-next`, `#btn-play` (`aria-pressed`), `#btn-reset` | controles |
| `[data-step-item="1..10"][data-status]` | panel de comandos |
| `[data-zone="working|staging|stash|local|remote"]` | zonas |
| `[data-zone=working] [data-file="app.js"][data-file-status]` | tarjeta de archivo (igual en staging) |
| `[data-clean-file="app.js"]` | archivo limpio en WORKING TREE |
| `[data-stash-index="0"]` | entrada de stash (contiene `[data-file]`) |
| `[data-commit="a1b2c3d"]` | nodo de commit (en local y en remote) |
| `[data-ref="main"][data-target="a1b2c3d"]` | etiqueta de ref (`HEAD`, `origin/main`…) |
| `[data-sync]` | indicador ahead/behind |
| `#explain[data-explain-command]` | panel «¿Qué pasó?» |
| `body[data-animating]` | `"true"` mientras hay animaciones en cola |
| `window.__LAB__` | `{ getSnapshot(), project(state) }` — gancho de solo lectura para tests |

## 11. Accesibilidad y responsive

- `lang="es"`, landmarks (`header`, `main`, `section` con `aria-labelledby`), orden de foco lógico.
- Todo accionable es `<button>`/`<input>`; foco visible (`:focus-visible`, contorno cian).
- Atajos: `←`/`→` = anterior/siguiente, solo cuando el foco **no** está en el campo de texto
  (para no interferir con la escritura). Se documentan en `help` y en el `title` de los botones.
- `aria-live="polite"` en la consola y en «¿Qué pasó?»; el contador anuncia «Paso 3 de 10».
- Contraste AA (≥ 4.5:1 texto normal). El estado nunca se comunica solo por color (iconos ✓, U/M/A).
- `prefers-reduced-motion` respetado; autoplay se para al interactuar.
- Responsive: ≥ 1100 px rejilla completa; 700–1099 px dos columnas; < 700 px una columna,
  WORKING TREE y STAGING lado a lado, grafo con scroll horizontal **interno**, controles en barra
  fija inferior. Nunca scroll horizontal de página (probado a 360 px).

## 12. Tests y QA

- **Unitarios** (`npm test` = `node --test tests/unit/`), sin dependencias:
  `engine.test.js` (cada comando, cada código de error, inmutabilidad), `parser.test.js`,
  `projection.test.js` (zonas, carriles, refs, sync), `scenario.test.js` (los 10 pasos ok, estado final
  esperado, determinismo), `controller.test.js` (next/prev/goTo/reset/run/offScript).
- **E2E** (`npm run test:e2e`, Playwright Chromium, servidor `scripts/serve.mjs` en puerto libre):
  sin errores de consola; los 10 pasos con Siguiente y tras cada uno **DOM ≡ `project(state)`**
  (archivos por zona, ids de commits local/remoto, `data-target` de refs); Anterior/Reiniciar;
  modo libre (comandos válidos y errores); móvil (360×740 e iPhone): sin scroll horizontal y controles usables;
  teclado (←/→, Enter en el campo).
- El agente `qa-tester` revisa cada entrega contra §12 y los criterios de aceptación.

## 13. CI/CD

`.github/workflows/ci.yml`: en `pull_request` y `push` a `main` → job `test` (Node 22, `npm ci`,
`npm test`, instalar Chromium de Playwright, `npm run test:e2e`). En `push` a `main`, si `test` pasa →
job `deploy` (`actions/configure-pages`, `actions/upload-pages-artifact` con `path: site`,
`actions/deploy-pages`). Requisito manual único: en GitHub, *Settings → Pages → Source: GitHub Actions*.
Todo gratuito en repos públicos.

## 14. Simplificaciones (declaradas también en la UI)

1. Contenido de archivo = token de versión; si dos ramas cambian el **mismo archivo**, se trata como conflicto
   (Git real podría fusionar líneas distintas) y la fusión se cancela: sin resolución manual de conflictos en v1.
2. Hashes de 7 caracteres generados de forma determinista (Git usa SHA‑1/SHA‑256 de 40/64).
3. Sin detached HEAD, sin `rebase`, `reset`, `restore`, `diff`, `tag`… (mejoras futuras).
4. Un único servidor remoto simulado; `pull` asume `pull.rebase=false`.
5. Sin editor: `git commit` necesita `-m`; la edición de archivos se simula con `edit`/`touch`.
6. `stash pop` con conflicto no intenta fusionar: se cancela y conserva la entrada.
7. Las estadísticas de commit no cuentan líneas (`N archivos cambiados`).

### 14.1 Decisiones de implementación (git-engine, fase 1)

- **Log del controlador**: una `LogEntry` por **línea** de salida (`{kind:'output'|'error', text}`); las líneas vacías
  tienen `text: ''` (la vista debe respetar los espacios, p. ej. `white-space: pre`). `command` lleva `prompt`.
  El `narration` principal de cada paso **no** va al log (se muestra en «¿Qué pasó?» vía `lastStep.narration`);
  solo las narraciones de los `before`.
- **Parser**: `parse()` devuelve además `output: string[]` en los errores (p. ej. la sugerencia multilínea de
  `UNKNOWN_COMMAND`). `git` solo, `git help` y `git --help` equivalen a `help`. `git commit -m hola mundo`
  → `PATHSPEC` con consejo de comillas. `push --force/-f` y `pull --rebase` → `UNSUPPORTED`.
- **`ana-push` sin `main` en el servidor** → `REMOTE_REF_NOT_FOUND`; archivo inexistente en el servidor → `FILE_NOT_FOUND`.
  El commit de Ana se llama `Ana actualiza <archivo>`.
- **`touch` de un archivo existente**: ok sin cambios (`FILE_EXISTS` queda definido en `data.errors` pero no se emite).
- **`pull` con fallo de merge**: se cancela todo (también el fetch) para respetar «`ok:false` ⇒ mismo estado».
- **`switch <rama>`** que solo existe como `origin/<rama>` crea la rama con upstream (DWIM de Git).
- **Merge de 3 vías con cambios sin preparar no relacionados**: se conservan; solo se aplican al índice/árbol las rutas que la fusión cambia.
- **`push` a un destino igual al servidor** con `-u`: «Todo actualizado» + fija upstream (`changed: true`).
- **`push` de una rama local inexistente**: `NO_COMMITS` (mismo mensaje `src refspec` que Git).
- `getStatus`, `headTree`, etc. se exportan desde `engine.js`; el motor expone `execute(state, cmd)` y `statusLines(state)`.

## 15. Tareas por fase

| Fase | Entregable | Agente | Estado |
|---|---|---|---|
| 0 | CLAUDE.md, este documento, `.claude/agents/`, scaffolding (`package.json`, `scripts/serve.mjs`) | maestro | ✅ |
| 1 | `engine.js`, `projection.js`, `index.js`, `core/controller.js` | git-engine | ⏳ |
| 2 | `index.html`, CSS, `ui/*.js`, `view.js`, `main.js` (zonas + animaciones + controles) | ui-builder | ⏳ |
| 3 | `parser.js` + `data.js` (textos, errores, escenario) · consola libre + «¿Qué pasó?» | git-engine + ui-builder | ⏳ |
| 4 | tests unitarios + e2e, revisión de criterios, correcciones | qa-tester (+ los demás) | ⏳ |
| 5 | `.github/workflows/ci.yml`, README, CHANGELOG, Pull Request | maestro + docs-writer | ⏳ |
