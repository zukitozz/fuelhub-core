#!/usr/bin/env node
// scripts/test-integration.mjs
//
// `npm run test:integration -- --grupo <grupoId> --env <dev|prod>` (sección
// 7/12.6) — el script que faltaba para que el paso "Tests de integración"
// de `deploy-grupo.yml` (13.5) tuviera algo real que ejecutar, mismo hueco
// que tenían `lint`/`test:unit`/`db:migrate` antes de v1.50.
//
// No reimplementa un test runner: resuelve `resourceArn`/`secretArn`/
// `database` del `DataStack` de este grupo/ambiente por CloudFormation
// (mismo mecanismo que `db-migrate.mjs`, factorizado en
// `resolver-outputs-datastack.mjs`) — ese stack YA está desplegado en este
// punto del pipeline (`deploy-grupo.yml` corre `db:migrate` recién después
// de `cdk deploy` de `data-stack`) — y los deja en variables de entorno
// (`AURORA_RESOURCE_ARN`/`AURORA_SECRET_ARN`/`AURORA_DATABASE`/`AWS_REGION`)
// para un proceso hijo real de Jest (`jest.integration.config.mjs`), que es
// quien de verdad corre los `*.integration.test.ts` de cada adaptador (ver
// `test/integration/aurora-fixture-helpers.ts` para cómo los leen).
//
// Por qué Jest y no un script de mano como `db-migrate.mjs`: los adaptadores
// que hay que probar (`services/*/src/infrastructure/adapters/*.ts`) son
// TypeScript real, y Jest+ts-jest ya está instalado y probado en este repo
// (`test:unit`, v1.50) — evita agregar una segunda herramienta (ts-node,
// tsx) solo para poder importar esos archivos desde un script suelto.
//
// NO se pudo correr contra un cluster de Aurora real en esta sesión (mismo
// límite ya declarado para `db-migrate.mjs`/el resto del CI/CD real). Lo que
// SÍ se verificó de punta a punta contra Postgres 16 real: la migración
// nueva que este trabajo destapó como faltante
// (`1787920000000_seed-estaciones-nonato.sql` — sin ella, `tanques` quedaba
// con 0 filas en silencio y cualquier ingesta real fallaba por
// "codigoEstacion no reconocido"), y un bug real que apareció al escribir
// estos tests y que ya no hizo falta un cluster real para confirmar por
// lectura de código: `PostgresCierreDiaQueryRepository` armaba su JOIN
// contra `cd.administrador_id` (columna inexistente; la real es
// `usuario_id`) — corregido, ver el comentario de cabecera de ese archivo.
//
// Deliberadamente FUERA de este suite: `EventBridgeCierreDiaPublisher`. El
// bus que usa (`notificacionesBusName`, `api-stack.ts`) es compartido con el
// sistema de notificaciones de WhatsApp — un proyecto aparte, fuera de
// alcance de este documento. Publicarle un evento sintético de prueba en
// `dev` (y más todavía en `prod`) podría disparar un mensaje real a una
// estación real; no vale la pena ese riesgo por la cobertura que da. Si en
// algún momento se quiere probar ese adaptador de verdad, lo correcto es un
// bus de EventBridge dedicado a pruebas, no el compartido.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolverConexionAuroraDataApi } from './resolver-outputs-datastack.mjs';

const REGION = 'us-east-2'; // misma región fija que el resto de infra (infra/bin/app.ts)
const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function leerArgs(argv) {
  const args = { grupo: undefined, env: undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--grupo') args.grupo = argv[++i];
    else if (argv[i] === '--env') args.env = argv[++i];
  }
  if (!args.grupo || !args.env) {
    throw new Error('Uso: npm run test:integration -- --grupo <grupoId> --env <dev|prod>  (sección 13.5)');
  }
  if (args.env !== 'dev' && args.env !== 'prod') {
    throw new Error(`--env inválido: "${args.env}" — debe ser "dev" o "prod" (mismo criterio que infra/bin/app.ts).`);
  }
  return args;
}

function correrJest(envExtra) {
  return new Promise((resolve, reject) => {
    const jestBin = path.join(REPO_ROOT, 'node_modules', '.bin', 'jest');
    const hijo = spawn(jestBin, ['--config', 'jest.integration.config.mjs', '--runInBand'], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      env: { ...process.env, ...envExtra },
    });
    hijo.on('error', reject);
    hijo.on('exit', (code) => resolve(code ?? 1));
  });
}

async function main() {
  const { grupo, env } = leerArgs(process.argv.slice(2));
  console.log(`test:integration — grupo="${grupo}" ambiente="${env}" (región ${REGION})`);

  const { resourceArn, secretArn, database } = await resolverConexionAuroraDataApi(grupo, env, REGION);

  const codigoSalida = await correrJest({
    AURORA_RESOURCE_ARN: resourceArn,
    AURORA_SECRET_ARN: secretArn,
    AURORA_DATABASE: database,
    AWS_REGION: REGION,
  });

  if (codigoSalida !== 0) {
    throw new Error(`test:integration falló — Jest terminó con código ${codigoSalida}.`);
  }
  console.log('test:integration OK.');
}

main().catch((error) => {
  console.error('test:integration falló:', error.message ?? error);
  process.exitCode = 1;
});
