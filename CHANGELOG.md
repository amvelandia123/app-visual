# Changelog

Todos los cambios notables de este proyecto se documentan en este archivo.

El formato se basa en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/),
y el proyecto usa [Versionado Semántico](https://semver.org/lang/es/).

## [Unreleased]

### Corregido

- CI/CD: empaquetar y publicar en GitHub Pages van en jobs separados, para que un fallo pasajero de la publicación se pueda reintentar sin duplicar el artefacto `github-pages`.

## [0.1.0] - 2026-11-20

### Añadido

- Motor puro de Git, sin DOM, con estado inmutable y hashes deterministas: `init`, `status`, `add`, `commit`, `branch`, `switch`, `merge`, `stash`, `pull` y `push`. Extras: `remote`, `fetch`, `log` y `checkout`.
- Parser de la consola con errores didácticos en español, sugerencias por errata y comillas en los mensajes.
- Escenario guiado de 10 pasos con la historia de Andrés y Ana, y narraciones de preparación.
- Interfaz con las cinco zonas (WORKING TREE, STAGING, STASH, LOCAL REPO y REMOTE · ORIGIN) y grafo de commits con ramas, `HEAD` y sincronización.
- Controles de modo guiado: Anterior, Siguiente, Auto-play, Reiniciar, clic en el panel de pasos y atajos `←` `→`.
- Animaciones de transición entre zonas, con respeto a `prefers-reduced-motion`.
- Modo libre con comandos auxiliares (`edit`, `touch`, `ls`, `ana-push`, `help` y `clear`) y botones de acceso rápido.
- Panel «¿Qué pasó?» con qué hizo cada comando, por qué se usa, el error típico y las simplificaciones.
- 365 tests unitarios con `node --test` (motor, parser, proyección, escenario y controlador) y 42 tests en navegador con Playwright (modo guiado, modo libre, teclado, accesibilidad y móvil).

### Corregido

- El panel «¿Qué pasó?» no explicaba los errores detectados por el parser (`git comit`, `cd ..`, comillas sin cerrar).
- El grafo remoto no mostraba el primer commit en escritorio cuando había 6 o más.
- Las sugerencias de comandos desconocidos eran poco útiles (`git foo` sugería `log`) y un remoto inexistente daba un error genérico.
- Pipeline de CI/CD con GitHub Actions: tests en cada Pull Request y despliegue en GitHub Pages desde `main`.
- Documentación (`README.md` y `docs/ARCHITECTURE.md`) y definición de los agentes del equipo en `.claude/agents/`.
