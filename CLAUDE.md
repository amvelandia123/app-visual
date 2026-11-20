# CLAUDE.md — Reglas del proyecto «Laboratorio Visual» (`app-visual`)

Simulador web **estático** e interactivo para aprender herramientas técnicas viendo
gráficamente qué hace cada comando. Módulo 1: **Git** (10 comandos). Se publica en
GitHub Pages. El diseño completo y los contratos entre capas están en
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): **léelo antes de tocar código.**

---

## ⚖️ Ley del proyecto (no negociable)

1. **No tocar nada existente del propietario fuera de este repositorio.** Todo el trabajo
   vive en `amvelandia123/app-visual`. Está prohibido modificar, hacer push, crear ramas,
   abrir PRs, borrar o cambiar la configuración de cualquier otro repositorio
   (por ejemplo `amvelandia123/github`), aunque haya acceso. Leer no es tocar, pero ni
   siquiera eso hace falta salvo petición expresa.
2. **Coste cero.** Nada de servicios, APIs, cuentas en la nube ni compras de pago. Si algo lo
   requiere: detenerse y preguntar explicando el coste.
3. **Sin credenciales.** No pedir ni usar contraseñas, tokens ni claves. Si algo las necesita:
   detenerse y explicar al propietario qué debe hacer él.
4. **Autonomía.** Preguntar solo si hay (a) coste, (b) una decisión irreversible o
   (c) un bloqueo real. En ese caso: una pregunta corta con opciones (responde desde el móvil).
5. **Alcance.** Si una tarea crece mucho más de lo previsto: simplificar, anotarlo en la sección
   «Mejoras futuras» del README y seguir.

---

## Arquitectura en una frase

`DATOS del módulo` + `MOTOR puro (estado → estado)` → `PROYECCIÓN (modelo de vista)` →
`INTERFAZ (render + animaciones)`; un `CONTROLADOR` genérico orquesta el modo guiado y el libre.

```
site/
  index.html              # esqueleto de la página (sin build)
  css/                    # base.css (tokens), layout.css, git.css
  js/main.js              # punto de entrada: monta la app con el módulo Git
  js/core/controller.js   # PURO, genérico: modo guiado/libre, historial, replay
  js/ui/*.js              # DOM genérico: consola, panel de pasos, panel ¿Qué pasó?, animador
  js/modules/git/
    engine.js             # PURO: estado de Git + transiciones (sin DOM)
    parser.js             # PURO: texto → comando estructurado
    projection.js         # PURO: estado → modelo de vista (zonas, grafo)
    data.js               # DATOS: comandos, textos en español, errores, escenario guiado
    index.js              # descriptor del módulo (solo partes puras)
    view.js               # DOM: dibuja las zonas de Git a partir de la proyección
tests/unit/               # node:test, sin dependencias
tests/e2e/                # Playwright (navegador real)
scripts/serve.mjs         # servidor estático local sin dependencias
```

Reglas de capas (se comprueban en revisión):
- `engine.js`, `parser.js`, `projection.js`, `data.js`, `core/controller.js` **no** usan
  `document`, `window` ni ninguna API del navegador. Deben poder importarse en Node.
- El motor es **inmutable**: nunca muta el estado recibido; devuelve uno nuevo.
- La interfaz **solo** dibuja a partir de `project(state)`; nunca lee el estado del motor
  "a mano" ni guarda una copia propia de la verdad.
- Los textos para el usuario (explicaciones, errores didácticos, escenario) viven en `data.js`.
- Un módulo nuevo (Docker, Kubernetes, OT…) = una carpeta nueva en `site/js/modules/` que
  cumpla el contrato de módulo. No se reescribe el núcleo.

## Fidelidad a Git

La semántica simulada debe ser fiel a Git real (fast-forward frente a commit de merge,
stash push/pop, ramas, upstream, ahead/behind). **Toda simplificación se declara**, tanto
en `docs/ARCHITECTURE.md` (§ Simplificaciones) como en el panel «¿Qué pasó?» del comando
afectado. Las salidas imitan a Git configurado en español.

## Convenciones de código

- HTML + CSS + JavaScript con **ES modules**. Sin frameworks, sin paso de build, sin
  dependencias de ejecución. Las únicas dependencias permitidas son de desarrollo (Playwright).
- **Comentarios en español; identificadores (variables, funciones, archivos) en inglés.**
- Funciones pequeñas y puras siempre que se pueda. JSDoc en las funciones públicas.
- Accesibilidad obligatoria: contraste AA, todo usable con teclado, `aria-live` para cambios,
  `prefers-reduced-motion` respetado.
- Responsive: debe verse y usarse bien en un móvil (≥ 360 px de ancho, sin scroll horizontal).

## Comandos

```bash
npm start            # servidor local en http://localhost:4173
npm test             # tests unitarios (node --test)
npm run test:e2e     # tests en navegador (Playwright)
```

## Git y flujo de trabajo

- Rama de trabajo por funcionalidad (`feat/...`, `fix/...`); se integra en `main` por Pull Request.
- **Conventional Commits** en español: `feat(git): …`, `fix(ui): …`, `test: …`, `docs: …`, `ci: …`, `chore: …`.
- Commits pequeños y con mensajes claros. Nunca `push --force` sobre `main`.
- Los subagentes **no** hacen commit ni push: entregan archivos; el agente maestro integra y hace commit.
- El push a `main` dispara CI + despliegue en GitHub Pages (`.github/workflows/ci.yml`).

## Equipo de agentes (`.claude/agents/`)

| Agente | Modelo | Responsabilidad |
|---|---|---|
| maestro (sesión principal) | el de la sesión | arquitectura, diseño, reparto, integración, commits, decisiones finales |
| `git-engine` | sonnet | motor de Git, parser, proyección, datos del módulo, controlador |
| `ui-builder` | sonnet | HTML/CSS, zonas, animaciones, responsive, accesibilidad |
| `qa-tester` | sonnet | escribe y ejecuta tests; revisa entregas contra criterios de aceptación. **Nada se integra sin pasar por él.** |
| `docs-writer` | haiku | README, CHANGELOG |

Delegar en tareas grandes y bien definidas, con instrucciones autocontenidas
(los subagentes no ven la conversación principal).

## Criterios de aceptación (v1)

- Los 10 comandos (init, status, add, commit, branch, switch, merge, stash, pull, push)
  funcionan en modo guiado y en modo libre; el estado visual coincide siempre con el del motor.
- «Reiniciar» devuelve todo al estado inicial.
- Sin errores en la consola del navegador.
- Todos los tests pasan en CI.
- Se ve y se usa bien en un móvil.
