import { defineRailway, project, service, volume } from "railway/iac";

// Despliegue de goldhair en Railway (Infrastructure as Code).
// Viene de railway.toml (Config as Code), que Railway deja de leer el 1/12/2026: aquí están todos
// los ajustes que tenía, sin quitar ninguno.
// Escrito a mano, sin un proyecto de Railway enlazado. ANTES de aplicarlo en un proyecto real:
// enlazar el proyecto y hacer `railway config pull` y fusionar con esto, para no borrar recursos
// existentes (bases de datos, volúmenes, variables, dominios). Quitar un recurso de aquí lo BORRA
// al aplicar, y el nombre del servicio ("goldhair") debe coincidir con el que tenga en Railway.

export default defineRailway(() => {
  const datos = volume("data");
  // Comando de arranque propio del proyecto: no cambiarlo por `npm start` sin revisar package.json.
  // railway.toml pedía un volumen montado en /data ([[volumes]]). Aquí se declara como
  // volumen "data": si en Railway ya existe con otro nombre, `railway config pull` lo mostrará
  // y hay que usar ese nombre, o se crearía uno nuevo vacío y se borraría el existente.
  const web = service("goldhair", {
    build: { builder: "NIXPACKS" },
    start: "node server.js",
    healthcheck: "/api/health",
    healthcheckTimeout: 30,
    deploy: { restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 3 },
    volumeMounts: { "/data": datos },
  });

  return project("goldhair", {
    resources: [web, datos],
  });
});
