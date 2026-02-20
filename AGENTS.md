# AGENTS.md

## Flujo de trabajo obligatorio para cambios

Estas reglas aplican a cualquier cambio nuevo en este repositorio:

1. Nunca trabajar ni hacer commit directo en `main`.
2. Para cada solicitud nueva, crear una rama nueva desde `main`.
3. Hacer los cambios y commits en esa rama.
4. Publicar la rama en GitHub.
5. Crear un Pull Request apuntando a `main`.
6. Esperar aprobación en GitHub antes de mergear.

## Convención de ramas

- `feat/<descripcion-corta>`
- `fix/<descripcion-corta>`
- `chore/<descripcion-corta>`

## Checklist mínimo antes de cerrar una tarea

1. Rama creada desde `main`.
2. Cambios commiteados en la rama.
3. PR creado con `base: main`.
4. URL del PR compartida al usuario.
