#!/usr/bin/env node
// scripts/verificar-aurora-data-api-db-client.mjs
//
// Verificación manual (NO es parte de `test:unit` ni de ningún paso del
// CI/CD — necesita un Postgres real corriendo en localhost, igual que la
// validación de migraciones de v1.43/v1.50) del adaptador
// `aurora-data-api-db-client.mjs`: corre el runner REAL de `node-pg-migrate`
// sobre las 3 migraciones reales de `infra/migrations/`, pero en vez de un
// `RDSDataClient` real (que necesitaría una cuenta de AWS — no disponible en
// esta sesión), usa un `client` falso cuyo único método (`.send()`) traduce
// cada `ExecuteStatementCommand`/`Begin/Commit/RollbackTransactionCommand`
// a la llamada equivalente sobre una conexión `pg` real — así se prueba de
// punta a punta la lógica de ESTE adaptador (partición de sentencias,
// manejo de BEGIN/COMMIT/ROLLBACK, el formato de fila que espera
// `node-pg-migrate`) contra un motor Postgres real, sin necesitar AWS.
//
// Lo que este script NO prueba (y no puede probar sin una cuenta de AWS
// real): que `ExecuteStatementCommand`/`formatRecordsAs: 'JSON'` se comporte
// exactamente así contra el servicio real de RDS Data API — eso ya está
// establecido por el resto del código base (mismo patrón exacto que
// `PostgresTanqueRepository.ejecutar`, en producción desde v1.39), no es
// algo nuevo de este archivo.
//
// Uso: node scripts/verificar-aurora-data-api-db-client.mjs
// (requiere Postgres 16 en localhost:5432, usuario/clave postgres/postgres
// — mismo setup que se usó para validar las migraciones, ver changelog v1.50)

import pg from 'pg';
import { runner } from 'node-pg-migrate';
import { crearAuroraDataApiDbClient } from './aurora-data-api-db-client.mjs';

const DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/fuelhub_test_data_api';

async function crearBaseLimpia() {
  const admin = new pg.Client('postgres://postgres:postgres@localhost:5432/postgres');
  await admin.connect();
  await admin.query('DROP DATABASE IF EXISTS fuelhub_test_data_api');
  await admin.query('CREATE DATABASE fuelhub_test_data_api');
  await admin.end();
}

/** Fake de RDSDataClient — SOLO para esta verificación local. */
function crearFakeRdsDataClient(pgClient) {
  let txDepth = 0; // pg no anida BEGIN reales; Data API sí nos da 1 transactionId lógico — alcanza con un contador de sanity-check
  return {
    async send(command) {
      const nombre = command.constructor.name;
      if (nombre === 'BeginTransactionCommand') {
        if (txDepth > 0) throw new Error('fake: ya había una transacción abierta');
        await pgClient.query('BEGIN');
        txDepth++;
        return { transactionId: 'fake-tx-1' };
      }
      if (nombre === 'CommitTransactionCommand') {
        await pgClient.query('COMMIT');
        txDepth--;
        return { transactionStatus: 'Transaction Committed' };
      }
      if (nombre === 'RollbackTransactionCommand') {
        await pgClient.query('ROLLBACK');
        txDepth--;
        return { transactionStatus: 'Rollback Complete' };
      }
      if (nombre === 'ExecuteStatementCommand') {
        const { rows } = await pgClient.query(command.input.sql);
        return { formattedRecords: JSON.stringify(rows) };
      }
      throw new Error(`fake RDSDataClient: comando no soportado en esta verificación: ${nombre}`);
    },
  };
}

async function main() {
  await crearBaseLimpia();

  const pgClient = new pg.Client(DATABASE_URL);
  await pgClient.connect();
  const fakeClient = crearFakeRdsDataClient(pgClient);

  // 1) Abrir la transacción "de Data API" (en realidad un BEGIN real de pg)
  //    ANTES de crear el dbClient — mismo orden que hace db-migrate.mjs.
  const inicio = await fakeClient.send({ constructor: { name: 'BeginTransactionCommand' } });
  const dbClient = crearAuroraDataApiDbClient({
    client: fakeClient,
    resourceArn: 'arn:aws:rds:us-east-2:000000000000:cluster:fake',
    secretArn: 'arn:aws:secretsmanager:us-east-2:000000000000:secret:fake',
    database: 'fuelhub_test_data_api',
    transactionId: inicio.transactionId,
  });

  console.log('--- Corriendo las 3 migraciones reales de infra/migrations/ vía el adaptador de Data API (con Postgres real por debajo) ---');
  const migraciones = await runner({
    dbClient,
    dir: 'infra/migrations',
    direction: 'up',
    migrationsTable: 'pgmigrations',
    singleTransaction: true,
    checkOrder: true,
    log: console.log,
  });
  await fakeClient.send({ constructor: { name: 'CommitTransactionCommand' } });
  console.log(`OK — ${migraciones.length} migración(es) corridas.`);

  const { rows: tablas } = await pgClient.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`
  );
  const { rows: productos } = await pgClient.query('SELECT COUNT(*)::int AS n FROM productos_maestro');
  console.log(
    'Tablas creadas:', tablas.map((r) => r.table_name),
    '| productos_maestro:', productos[0].n, 'filas'
  );

  if (tablas.length !== 10 || productos[0].n !== 5) {
    throw new Error('Verificación FALLÓ: no quedó el esquema/seed esperado.');
  }

  await pgClient.end();
  console.log('\nVerificación del adaptador de Data API: OK.');
}

main().catch((err) => {
  console.error('Verificación FALLÓ:', err);
  process.exitCode = 1;
});
