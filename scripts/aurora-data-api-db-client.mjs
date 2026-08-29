// scripts/aurora-data-api-db-client.mjs
//
// Adaptador entre `node-pg-migrate` y RDS Data API — lo que hace posible
// `db:migrate` (sección 12.6/13.5, v1.50) contra un cluster de Aurora que
// SOLO es alcanzable por Data API. Es un hallazgo real de esta versión, no
// un detalle menor: `DataStack` (12.4) crea el cluster con
// `enableDataApi: true` y en una subred `PRIVATE_ISOLATED` sin NAT — el
// mismo diseño que ya usan los 7 Lambdas de negocio (todos hablan con
// Postgres vía `@aws-sdk/client-rds-data`, nunca con `pg` directo, ver
// cualquier `Postgres*Repository.ts`). Un runner de GitHub Actions (fuera de
// la VPC, sección 12.5) NO puede abrir una conexión TCP directa al cluster
// — así que el `databaseUrl` que `node-pg-migrate` espera por defecto (una
// cadena de conexión `pg`) no es una opción real acá.
//
// La solución no es reescribir `node-pg-migrate` ni cambiar de herramienta
// (12.4 ya la eligió, con buena razón): su runner programático acepta un
// `dbClient` — cualquier objeto con un método `.query()` compatible con
// `pg.ClientBase` (verificado leyendo `node_modules/node-pg-migrate/dist/legacy/db.js`
// — ver el comentario de `crearAuroraDataApiDbClient` abajo para el detalle
// exacto de qué llama). Este archivo es ese objeto, respaldado por
// `RDSDataClient` en vez de una conexión TCP real — mismo patrón exacto que
// ya usan los adaptadores Postgres de los Lambdas (`ExecuteStatementCommand`
// con `formatRecordsAs: 'JSON'`, ver `PostgresTanqueRepository.ejecutar`),
// reutilizado acá para consistencia en vez de inventar un mapeo de
// columnMetadata/records propio.
//
// Dos límites reales de Data API que este adaptador tiene que resolver,
// ninguno documentado en `node-pg-migrate` porque nunca fue pensado para
// correr sobre Data API:
//
//   1. **Sin sentencias múltiples por llamada.** `node-pg-migrate` arma el
//      bloque completo de "Up Migration" (varios `CREATE TABLE`/`CREATE
//      INDEX`/etc. separados por `;`) como UN SOLO string y lo manda con una
//      sola llamada a `db.query(...)` — funciona sobre `pg` real porque el
//      protocolo "simple query" sí acepta varias sentencias en un mismo
//      mensaje. La documentación de troubleshooting de RDS Data API es
//      explícita en que esto NO está soportado ahí ("Multi-statements are
//      not supported in the Data API for Aurora serverless and provisioned
//      clusters"). `dividirEnSentencias()` de abajo parte ese bloque en
//      sentencias individuales (respetando strings/identificadores citados,
//      comentarios y bloques `$tag$...$tag$`) y las manda una por una.
//
//   2. **Sin sesión persistente entre llamadas sueltas.** El candado de
//      migración de `node-pg-migrate` (`pg_advisory_lock`/`pg_try_advisory_lock`/
//      `pg_advisory_unlock`, ver `node_modules/node-pg-migrate/dist/legacy/runner.js`)
//      es de alcance de SESIÓN — solo tiene sentido si la conexión que lo
//      toma es la misma que después lo libera. Cada `ExecuteStatement`
//      suelto (sin `transactionId`) puede resolverse contra una conexión de
//      pool distinta en el lado de Data API, así que ese candado se
//      liberaría solo apenas termina la llamada que lo tomó — inútil. La
//      solución: TODA la corrida de `db:migrate` (`db-migrate.mjs`) abre
//      UNA transacción de Data API (`BeginTransactionCommand`) antes de
//      llamar a `runner()`, y todas las llamadas de este cliente —
//      candado, `ensureMigrationsTable`, cada migración, el candado de
//      salida — pasan el mismo `transactionId`. Data API sí garantiza que
//      una transacción vive en una sola conexión real de principio a fin
//      (es lo que hace que `BeginTransaction`/`CommitTransaction` tengan
//      sentido). El literal `"BEGIN"`/`"COMMIT"`/`"ROLLBACK"` que el propio
//      `runner()` de node-pg-migrate manda internamente (con
//      `singleTransaction: true`, el default — ver runner.js línea ~152) se
//      ignora acá a propósito (ver `query()` abajo): la transacción real ya
//      la maneja `db-migrate.mjs` por fuera, una sola vez, así que un doble
//      `BEGIN` no aporta nada y ya no hace falta interceptarlo por separado.
//
// NO verificado contra una cuenta de AWS real en esta sesión (no hay acceso
// — mismo límite ya declarado para el CI/CD real en 13.5/v1.45). Lo que SÍ
// se verificó: `dividirEnSentencias()` con un set de casos reales (strings
// con `;` y comillas escapadas, comentarios `--`/`/* */`, el propio archivo
// `1787900000000_esquema-inicial.sql`) y la migración en sí, de punta a
// punta, con el runner REAL de `node-pg-migrate` contra Postgres 16 (ver
// changelog v1.50) — lo que queda sin probar es específicamente la llamada
// a `RDSDataClient.send(...)`, que requiere un cluster real.

import { ExecuteStatementCommand } from '@aws-sdk/client-rds-data';

/**
 * Parte un bloque de SQL en sentencias individuales, sobre los `;` de nivel
 * superior — respeta strings `'...'` (con `''` como escape), identificadores
 * `"..."`, comentarios de línea (`-- ...`) y de bloque estilo C, y bloques `$tag$...$tag$` (no
 * usados hoy en `infra/migrations/`, pero un futuro `CREATE FUNCTION` sí los
 * necesitaría — se soportan desde ya para no dejar una trampa).
 */
export function dividirEnSentencias(sql) {
  const sentencias = [];
  let actual = '';
  let i = 0;
  const n = sql.length;

  while (i < n) {
    const c = sql[i];

    if (c === "'") {
      actual += c;
      i++;
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          actual += "''";
          i += 2;
          continue;
        }
        actual += sql[i];
        if (sql[i] === "'") {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    if (c === '"') {
      actual += c;
      i++;
      while (i < n) {
        if (sql[i] === '"' && sql[i + 1] === '"') {
          actual += '""';
          i += 2;
          continue;
        }
        actual += sql[i];
        if (sql[i] === '"') {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    if (c === '-' && sql[i + 1] === '-') {
      while (i < n && sql[i] !== '\n') {
        actual += sql[i];
        i++;
      }
      continue;
    }

    if (c === '/' && sql[i + 1] === '*') {
      actual += '/*';
      i += 2;
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) {
        actual += sql[i];
        i++;
      }
      if (i < n) {
        actual += '*/';
        i += 2;
      }
      continue;
    }

    if (c === '$') {
      const resto = sql.slice(i);
      const m = /^\$[A-Za-z0-9_]*\$/.exec(resto);
      if (m) {
        const tag = m[0];
        const cierre = sql.indexOf(tag, i + tag.length);
        const hasta = cierre === -1 ? n : cierre + tag.length;
        actual += sql.slice(i, hasta);
        i = hasta;
        continue;
      }
    }

    if (c === ';') {
      sentencias.push(actual);
      actual = '';
      i++;
      continue;
    }

    actual += c;
    i++;
  }

  if (actual.trim().length > 0) sentencias.push(actual);
  return sentencias.map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * Construye el objeto `dbClient` que se pasa a `runner({ dbClient, ... })`
 * (`node-pg-migrate`, ver `RunnerOptionClient` en su `.d.ts`). Solo necesita
 * exponer `.query()` — es lo único que `node-pg-migrate` llama en todo el
 * flujo de `up`/`down` (confirmado leyendo `db.js`/`runner.js`/`migration.js`
 * de la librería instalada: nunca usa `.select()`/`.column()` con un
 * `dbClient` externo por su cuenta — esos son wrappers de conveniencia sobre
 * `.query()` que arma el propio `db()` de node-pg-migrate, no algo que este
 * adaptador tenga que implementar aparte).
 *
 * `transactionId` es FIJO para toda la vida de este cliente — lo abre/cierra
 * `db-migrate.mjs`, no este archivo (ver el punto 2 del comentario de
 * cabecera). Por eso los literales "BEGIN"/"COMMIT"/"ROLLBACK" que
 * `node-pg-migrate` manda internamente se ignoran acá (se devuelven como
 * no-op con `{ rows: [] }`) en vez de mapearse a Begin/Commit/RollbackTransactionCommand:
 * ya hay una transacción de Data API abierta por fuera durante toda la
 * corrida, y abrir una segunda por dentro no tiene ningún efecto útil.
 *
 * `client` se recibe ya construido (no se instancia un `RDSDataClient` acá
 * adentro) — mismo criterio de inyección que ya usan los adaptadores
 * Postgres de los Lambdas (`PostgresTanqueRepository`, etc.: reciben el
 * `RDSDataClient` por constructor). Además de consistencia, es lo que
 * permite probar `dividirEnSentencias()` + el resto de esta lógica con un
 * `client` de prueba (cualquier objeto con `.send()`) sin necesitar
 * credenciales de AWS reales — ver `scripts/verificar-aurora-data-api-db-client.mjs`.
 */
export function crearAuroraDataApiDbClient({ client, resourceArn, secretArn, database, transactionId }) {
  async function ejecutarUnaSentencia(sql) {
    const resultado = await client.send(
      new ExecuteStatementCommand({
        resourceArn,
        secretArn,
        database,
        sql,
        transactionId,
        formatRecordsAs: 'JSON',
      })
    );
    return resultado.formattedRecords ? JSON.parse(resultado.formattedRecords) : [];
  }

  return {
    async query(sqlTextOrConfig) {
      const sql = typeof sqlTextOrConfig === 'string' ? sqlTextOrConfig : sqlTextOrConfig.text;
      const normalizado = sql.trim().replace(/;+\s*$/, '');

      if (normalizado === 'BEGIN' || normalizado === 'COMMIT' || normalizado === 'ROLLBACK') {
        return { rows: [] };
      }

      const sentencias = dividirEnSentencias(sql);
      let filas = [];
      for (const sentencia of sentencias) {
        filas = await ejecutarUnaSentencia(sentencia);
      }
      return { rows: filas };
    },
  };
}
