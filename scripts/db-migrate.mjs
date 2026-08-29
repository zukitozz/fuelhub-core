#!/usr/bin/env node
// scripts/db-migrate.mjs
//
// `npm run db:migrate -- --grupo <grupoId> --env <dev|prod>` (12.6/13.5,
// v1.50) — el script que faltaba para que el paso "Correr migraciones de
// esquema" de `deploy-grupo.yml` (13.5) tuviera algo real que ejecutar.
// Corre `node-pg-migrate` de verdad (`infra/migrations/`, dirección `up`,
// mismo criterio que 12.4), pero conectado vía RDS Data API en vez de una
// conexión `pg` directa — ver el comentario de cabecera de
// `aurora-data-api-db-client.mjs` para el porqué (Data API es la única vía
// de acceso real al cluster: subred privada sin NAT, sección 9.4/12.5).
//
// Descubre `resourceArn`/`secretArn`/`databaseName` leyendo los Outputs de
// `FuelHubDataStack-<grupo>-<env>` por CloudFormation — ese stack ya se
// desplegó en el paso anterior del pipeline (`deploy-grupo.yml`, antes de
// "Correr migraciones") y publica esos 3 valores desde v1.50 (ver
// `infra/lib/stacks/data-stack.ts`). Así este script no necesita su propio
// mecanismo de configuración por grupo/ambiente — reutiliza el que ya existe
// (CloudFormation), sin credenciales nuevas más allá de las que el paso de
// `configure-aws-credentials` de `deploy-grupo.yml` ya deja en el entorno.
//
// NO se pudo correr contra un cluster de Aurora real en esta sesión (sin
// cuenta de AWS disponible, mismo límite ya declarado para el resto del
// CI/CD real, 13.5/v1.45) — lo que sí se verificó: la migración en sí
// (`1787900000000_esquema-inicial.sql`) con el runner real de
// `node-pg-migrate` contra Postgres 16, y la lógica de partición de
// sentencias del adaptador de Data API contra el contenido real de los 3
// archivos de `infra/migrations/` (ver changelog v1.50).

import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import {
  BeginTransactionCommand,
  CommitTransactionCommand,
  RDSDataClient,
  RollbackTransactionCommand,
} from '@aws-sdk/client-rds-data';
import { runner } from 'node-pg-migrate';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crearAuroraDataApiDbClient } from './aurora-data-api-db-client.mjs';

const REGION = 'us-east-2'; // misma región fija que el resto de infra (infra/bin/app.ts)
const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function leerArgs(argv) {
  const args = { grupo: undefined, env: undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--grupo') args.grupo = argv[++i];
    else if (argv[i] === '--env') args.env = argv[++i];
  }
  if (!args.grupo || !args.env) {
    throw new Error('Uso: npm run db:migrate -- --grupo <grupoId> --env <dev|prod>  (sección 13.5)');
  }
  if (args.env !== 'dev' && args.env !== 'prod') {
    throw new Error(`--env inválido: "${args.env}" — debe ser "dev" o "prod" (mismo criterio que infra/bin/app.ts).`);
  }
  return args;
}

async function resolverConexionAuroraDataApi(grupo, ambiente) {
  const stackName = `FuelHubDataStack-${grupo}-${ambiente}`;
  const cfn = new CloudFormationClient({ region: REGION });
  const { Stacks } = await cfn.send(new DescribeStacksCommand({ StackName: stackName }));
  const outputs = Stacks?.[0]?.Outputs ?? [];
  const buscar = (key) => outputs.find((o) => o.OutputKey === key)?.OutputValue;

  const resourceArn = buscar('ClusterArn');
  const secretArn = buscar('SecretArn');
  const database = buscar('DatabaseName');
  if (!resourceArn || !secretArn || !database) {
    throw new Error(
      `No se pudieron leer ClusterArn/SecretArn/DatabaseName de los Outputs del stack "${stackName}". ` +
        '¿Se desplegó DataStack de este grupo/ambiente antes de correr db:migrate (orden de 12.2/deploy-grupo.yml)? ' +
        '¿Es una versión de DataStack anterior a v1.50 (sin estos 3 CfnOutput)?'
    );
  }
  return { resourceArn, secretArn, database };
}

async function main() {
  const { grupo, env } = leerArgs(process.argv.slice(2));
  console.log(`db:migrate — grupo="${grupo}" ambiente="${env}" (región ${REGION})`);

  const { resourceArn, secretArn, database } = await resolverConexionAuroraDataApi(grupo, env);

  const rdsClient = new RDSDataClient({ region: REGION });
  const inicio = await rdsClient.send(new BeginTransactionCommand({ resourceArn, secretArn, database }));
  const transactionId = inicio.transactionId;
  if (!transactionId) {
    throw new Error('RDS Data API no devolvió transactionId al abrir la transacción de la migración.');
  }

  const dbClient = crearAuroraDataApiDbClient({ client: rdsClient, resourceArn, secretArn, database, transactionId });

  try {
    const migracionesCorridas = await runner({
      dbClient,
      dir: path.join(REPO_ROOT, 'infra', 'migrations'),
      direction: 'up',
      migrationsTable: 'pgmigrations',
      singleTransaction: true,
      checkOrder: true,
      log: (msg) => console.log(msg),
    });

    await rdsClient.send(new CommitTransactionCommand({ resourceArn, secretArn, transactionId }));
    console.log(`db:migrate OK — ${migracionesCorridas.length} migración(es) aplicada(s) (o 0 si ya estaba al día).`);
  } catch (error) {
    await rdsClient
      .send(new RollbackTransactionCommand({ resourceArn, secretArn, transactionId }))
      .catch((rollbackError) => {
        console.error('Además falló el ROLLBACK de la transacción de Data API:', rollbackError);
      });
    throw error;
  }
}

main().catch((error) => {
  console.error('db:migrate falló:', error);
  process.exitCode = 1;
});
