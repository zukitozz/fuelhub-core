#!/usr/bin/env node
// scripts/smoke-test.mjs
//
// `npm run smoke-test -- --grupo <grupoId> --env <dev|prod>` (12.3/12.6,
// v1.51) -- el último script que faltaba para que `deploy-grupo.yml` (13.5)
// tuviera algo real que ejecutar; el mismo hueco que ya se cerró para
// `lint`/`test:unit`/`db:migrate` (v1.50) y `test:integration` (v1.51).
//
// A diferencia de `test:integration` (que llama a los adaptadores
// TypeScript directo, sin pasar por HTTP), este script reproduce, contra la
// API real ya desplegada, exactamente lo que se hizo a mano en 9.2.2 al
// verificar el Pre Token Generation Lambda por primera vez:
//
//   1. Pide un token M2M real (`client_credentials`) contra el
//      `TokenEndpoint` de `AuthStack` de este grupo/ambiente, con las
//      credenciales del App Client DEDICADO de pruebas (12.5 -- nunca las de
//      una estación real) -- `SMOKE_TEST_CLIENT_ID`/`SMOKE_TEST_CLIENT_SECRET`,
//      leídas del entorno (GitHub Environment secrets, `deploy-grupo.yml`).
//   2. Decodifica el JWT (sin verificar firma -- no hace falta: se acaba de
//      recibir directo de Cognito por HTTPS, no viene de una fuente no
//      confiable) y confirma que trae `custom:role`/`custom:station_scope`
//      -- si el Pre Token Generation Lambda se rompiera o se desconectara
//      del trigger, acá es donde se notaría.
//   3. `POST /v1/cierres-turno` con un payload sintético (mismo criterio
//      `MARCADOR_CI` que `test/integration/aurora-fixture-helpers.ts`,
//      adaptado a `codigoEstacion` real: se usa el código de
//      `custom:station_scope` del propio token, nunca uno inventado, porque
//      la validación de estación-existente (sección 3.9) es real acá -- no
//      hay mocks entre este script y Postgres).
//   4. `GET /v1/cierres-turno/{id}` con el `id` devuelto por el paso 3 y
//      confirma que lo que se leyó de vuelta coincide con lo que se envió --
//      la misma prueba de desacople escritura/lectura que
//      `PostgresCierreTurnoIngestaRepository.integration.test.ts`, pero acá
//      cruzando la pila completa (API Gateway + Cognito authorizer + Lambda
//      + Postgres), no solo el adaptador.
//
// Decisión propia, a confirmar con Jorge: NO se borra el cierre sintético
// creado (a diferencia de los tests de integración, que sí limpian vía SQL
// directo) -- porque este script solo tiene acceso HTTP a la API pública, y
// el contrato (openapi.yaml) no define ningún endpoint DELETE para cierres
// de turno (sección 11: ninguno de los 11 endpoints borra). El registro
// sintético queda en la base, igual que cualquier cierre real, pero
// claramente marcado (`empleado.codigo`/`detalle[].codigoLocal` con el
// prefijo `MARCADOR_SMOKE_TEST`) para poder excluirlo de reportes si hiciera
// falta -- exactamente lo que ya advierte el propio texto de 12.3 ("un POST
// de prueba... con datos sintéticos"), que nunca menciona limpieza.
//
// `custom:station_scope = '*'` (integrador multi-estación, sección 5.2) no
// sirve para este script -- necesita UN código de estación real concreto
// para poder registrar el cierre. Si el App Client de pruebas quedara
// configurado con ese scope comodín en vez del `station.<CODIGO>` de una
// estación real (12.5), el script falla acá mismo con un mensaje explícito
// en vez de un 400 críptico de la API.
//
// Requiere Node 18+ (usa `fetch`/`crypto.randomUUID` nativos -- CI corre
// Node 22, ver `deploy-grupo.yml`).

import { randomUUID } from 'node:crypto';
import { resolverApiUrlYTokenEndpoint } from './resolver-outputs-api-auth.mjs';

const REGION = 'us-east-2'; // misma región fija que el resto de infra (infra/bin/app.ts)
const MARCADOR_SMOKE_TEST = 'ci-smoke-test'; // mismo espíritu que MARCADOR_CI de test-integration, prefijo distinto para distinguir el origen en un vistazo

function leerArgs(argv) {
  const args = { grupo: undefined, env: undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--grupo') args.grupo = argv[++i];
    else if (argv[i] === '--env') args.env = argv[++i];
  }
  if (!args.grupo || !args.env) {
    throw new Error('Uso: npm run smoke-test -- --grupo <grupoId> --env <dev|prod>  (sección 12.3/13.5)');
  }
  if (args.env !== 'dev' && args.env !== 'prod') {
    throw new Error(`--env inválido: "${args.env}" — debe ser "dev" o "prod" (mismo criterio que infra/bin/app.ts).`);
  }
  return args;
}

function leerCredencialesClienteDePruebas() {
  const clientId = process.env.SMOKE_TEST_CLIENT_ID;
  const clientSecret = process.env.SMOKE_TEST_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      'Faltan SMOKE_TEST_CLIENT_ID/SMOKE_TEST_CLIENT_SECRET en el entorno. ' +
        'Son los secrets del App Client de pruebas dedicado (sección 12.5) -- se configuran como ' +
        'GitHub Environment secrets en dev-<grupo>/prod-<grupo> (13.5), nunca como secret de repo.'
    );
  }
  return { clientId, clientSecret };
}

async function pedirTokenM2M(tokenEndpoint, clientId, clientSecret) {
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const respuesta = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials', // sin `scope` -- Cognito concede todos los scopes configurados en el App Client (sección 5.1/9.2.2)
  });

  const cuerpo = await respuesta.text();
  if (!respuesta.ok) {
    throw new Error(`Falló POST ${tokenEndpoint} (${respuesta.status}): ${cuerpo}`);
  }

  const { access_token: accessToken } = JSON.parse(cuerpo);
  if (!accessToken) {
    throw new Error(`La respuesta del token endpoint no trajo "access_token": ${cuerpo}`);
  }
  return accessToken;
}

function decodificarClaims(accessToken) {
  // Solo decodifica el payload (base64url) -- no verifica la firma. No hace
  // falta: el token se acaba de recibir directo de Cognito por HTTPS en el
  // paso anterior, no llega de una fuente externa no confiable.
  const partes = accessToken.split('.');
  if (partes.length !== 3) {
    throw new Error('El access token devuelto por Cognito no tiene el formato JWT esperado (header.payload.signature).');
  }
  return JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8'));
}

function validarClaims(claims) {
  const rol = claims['custom:role'];
  const stationScope = claims['custom:station_scope'];

  if (!rol) {
    throw new Error(
      'El access token no trae el claim "custom:role" -- el Pre Token Generation Lambda (9.2.2) no está agregando ' +
        'los claims esperados. Revisar el trigger V3_0 del User Pool de este grupo.'
    );
  }
  if (!stationScope) {
    throw new Error(
      'El access token no trae el claim "custom:station_scope" -- mismo diagnóstico que "custom:role" arriba.'
    );
  }
  if (stationScope === '*') {
    throw new Error(
      'El App Client de pruebas está configurado con custom:station_scope="*" (scope fuelhub-api/station.* o ' +
        'equivalente multi-estación, sección 5.2) -- este script necesita un código de estación concreto para poder ' +
        'registrar el cierre sintético. Configurar el App Client de pruebas (12.5) con el scope de UNA sola ' +
        'estación real (fuelhub-api/station.<CODIGO>), igual que los App Clients de las estaciones reales (9.2.1).'
    );
  }
  console.log(`Token M2M OK -- custom:role="${rol}" custom:station_scope="${stationScope}"`);
  return { rol, codigoEstacion: stationScope };
}

function construirPayloadCierreTurno(codigoEstacion) {
  const ahora = new Date();
  const haceUnaHora = new Date(ahora.getTime() - 60 * 60 * 1000);
  return {
    codigoEstacion,
    turno: 'TURNO1',
    fechaNegocio: ahora.toISOString().slice(0, 10),
    fechaInicio: haceUnaHora.toISOString(),
    fecha: ahora.toISOString(),
    total: 1,
    empleado: { codigo: `${MARCADOR_SMOKE_TEST}-empleado`, nombre: 'Smoke Test (CI)' },
    pagos: [{ medio: 'EFECTIVO', monto: 1 }],
    detalle: [
      {
        codigoLocal: `${MARCADOR_SMOKE_TEST}-producto`,
        producto: 'Smoke Test (CI)',
        totalCantidad: 1,
        totalSoles: 1,
      },
    ],
  };
}

async function registrarCierreTurnoDePrueba(apiUrl, accessToken, codigoEstacion) {
  const payload = construirPayloadCierreTurno(codigoEstacion);
  const respuesta = await fetch(new URL('v1/cierres-turno', apiUrl), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': randomUUID(), // única por corrida -- nunca debe pisar un intento anterior (sección 2.3)
    },
    body: JSON.stringify(payload),
  });

  const cuerpo = await respuesta.text();
  if (respuesta.status !== 201) {
    throw new Error(`POST /v1/cierres-turno esperaba 201, devolvió ${respuesta.status}: ${cuerpo}`);
  }

  const registrado = JSON.parse(cuerpo);
  if (!registrado.id) {
    throw new Error(`POST /v1/cierres-turno devolvió 201 sin "id" en el cuerpo: ${cuerpo}`);
  }

  if (registrado.codigoEstacion !== payload.codigoEstacion || registrado.total !== payload.total) {
    throw new Error(
      `POST /v1/cierres-turno devolvió un cuerpo inesperado -- se envió codigoEstacion="${payload.codigoEstacion}" ` +
        `total=${payload.total}, se recibió codigoEstacion="${registrado.codigoEstacion}" total=${registrado.total}.`
    );
  }

  console.log(`POST /v1/cierres-turno OK -- id="${registrado.id}"`);
  return { id: registrado.id, payload };
}

async function releerCierreTurnoDePrueba(apiUrl, accessToken, id, payloadEnviado) {
  const respuesta = await fetch(new URL(`v1/cierres-turno/${id}`, apiUrl), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const cuerpo = await respuesta.text();
  if (respuesta.status !== 200) {
    throw new Error(`GET /v1/cierres-turno/${id} esperaba 200, devolvió ${respuesta.status}: ${cuerpo}`);
  }

  const releido = JSON.parse(cuerpo);
  const errores = [];
  if (releido.id !== id) errores.push(`id: esperado "${id}", recibido "${releido.id}"`);
  if (releido.codigoEstacion !== payloadEnviado.codigoEstacion) {
    errores.push(`codigoEstacion: esperado "${payloadEnviado.codigoEstacion}", recibido "${releido.codigoEstacion}"`);
  }
  if (releido.total !== payloadEnviado.total) {
    errores.push(`total: esperado ${payloadEnviado.total}, recibido ${releido.total}`);
  }
  if (releido.empleado?.codigo !== payloadEnviado.empleado.codigo) {
    errores.push(`empleado.codigo: esperado "${payloadEnviado.empleado.codigo}", recibido "${releido.empleado?.codigo}"`);
  }
  if (!Array.isArray(releido.detalle) || releido.detalle.length !== payloadEnviado.detalle.length) {
    errores.push(`detalle: esperado ${payloadEnviado.detalle.length} línea(s), recibido ${releido.detalle?.length ?? 0}`);
  }

  if (errores.length > 0) {
    throw new Error(`GET /v1/cierres-turno/${id} no coincide con lo enviado en el POST:\n  - ${errores.join('\n  - ')}`);
  }

  console.log(`GET /v1/cierres-turno/${id} OK -- coincide con lo enviado.`);
}

async function main() {
  const { grupo, env } = leerArgs(process.argv.slice(2));
  console.log(`smoke-test — grupo="${grupo}" ambiente="${env}" (región ${REGION})`);

  const { clientId, clientSecret } = leerCredencialesClienteDePruebas();
  const { apiUrl, tokenEndpoint } = await resolverApiUrlYTokenEndpoint(grupo, env, REGION);

  const accessToken = await pedirTokenM2M(tokenEndpoint, clientId, clientSecret);
  const claims = decodificarClaims(accessToken);
  const { codigoEstacion } = validarClaims(claims);

  const { id, payload } = await registrarCierreTurnoDePrueba(apiUrl, accessToken, codigoEstacion);
  await releerCierreTurnoDePrueba(apiUrl, accessToken, id, payload);

  console.log('smoke-test OK.');
}

main().catch((error) => {
  console.error('smoke-test falló:', error.message ?? error);
  process.exitCode = 1;
});
