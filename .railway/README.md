# Railway en goldhair

Desde el 23/11/2026 la configuración de despliegue vive en `.railway/railway.ts` (Infrastructure as Code).
`railway.toml` ya no existe: Railway deja de leerlo el 1/12/2026.

Ajustes (los mismos que tenía `railway.toml`): builder NIXPACKS; arranque `node server.js`; comprobación de salud `/api/health` (30 s); reinicio ON_FAILURE (3 reintentos); volumen en `/data`.

Este proyecto no está en la cuenta de Railway de Denis, así que el archivo está escrito a mano y
**no se ha aplicado**. Para usarlo en un proyecto de Railway:

1. `cd .railway; npm install` (instala el SDK `railway`; la app no lo necesita).
2. Desde la raíz: `railway link` al proyecto y `railway config pull`, y fusionar lo que traiga
   con `railway.ts`. Quitar un recurso de `railway.ts` lo BORRA en Railway.
3. `railway config plan` (no cambia nada) y, si el plan es correcto, `railway config apply`.

En Windows, antes de plan/apply:
`$env:_ = "$env:APPDATA\npm\node_modules\@railway\cli\bin\railway.exe"`
(el SDK comprueba la versión del CLI con `$env:_` y no puede lanzar el `.cmd`).

`.railway` está en `.railwayignore`: los despliegues no suben esta carpeta.
