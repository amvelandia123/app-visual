# Changelog

Todos los cambios notables de este proyecto se documentan en este archivo.

El formato se basa en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/),
y el proyecto usa [Versionado Semántico](https://semver.org/lang/es/).

## [Unreleased]

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
- Tests unitarios del motor con `node --test`.
- Pipeline de CI/CD con GitHub Actions: tests en cada Pull Request y despliegue en GitHub Pages desde `main`.
- Documentación (`README.md` y `docs/ARCHITECTURE.md`) y definición de los agentes del equipo en `.claude/agents/`.
