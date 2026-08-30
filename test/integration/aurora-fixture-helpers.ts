// test/integration/aurora-fixture-helpers.ts
//
// Utilidades compartidas por los `*.integration.test.ts` de cada adaptador
// (sección 12.6) — expuestas vía el alias `@fuelhub/test-integration-support`
// (ver `jest.integration.config.mjs`), mismo criterio que
// `@fuelhub/shared-kernel`. Un solo lugar para: leer la config de Aurora
// Data API del entorno, ejecutar una sentencia suelta (sin transacción
// explícita — cada test usa el `registrar()` real del adaptador que SÍ abre
// su propia transacción; esto es solo para el setup/verificación/limpieza
// alrededor), y resolver datos "semilla" reales (una estación, un producto,
// un tanque) sin hardcodear un UUID.
//
// Estrategia de limpieza (decisión deliberada, léase antes de copiar el
// patrón): cada test captura el `id` real que le devuelve `registrar()` y en
// su `afterAll` borra ESA fila puntual (`DELETE ... WHERE id = :id`), nunca
// un `WHERE cliente_origen = ...` amplio — más preciso, y no hay forma de
// que un test se lleve puesto algo que no creó él mismo. Los `usuarios`
// auto-provisionados por `empleado`/`administrador` (sección 3.7) NO se
// borran — quedan como filas fijas y reconocibles (`usuario` empieza con
// `ci-`, `nombre` dice "CI Test Integración") que el propio UPSERT de cada
// adaptador reutiliza en la próxima corrida. Evita a propósito la cadena de
// borrado en el orden correcto de FKs (cierres_turno → SET NULL automático
// vía ON DELETE SET NULL; cierres_dia → RESTRICT, sin ON DELETE, así que
// habría que borrar el cierre_dia ANTES que su usuario) — no vale la pena el
// riesgo de un bug de limpieza que tire abajo todo el suite por una fila de
// prueba de `usuarios` que no le hace daño a nadie.

import { ExecuteStatementCommand, RDSDataClient, type SqlParameter } from '@aws-sdk/client-rds-data';

export interface AuroraDataApiConfig {
  readonly resourceArn: string;
  readonly secretArn: string;
  readonly database: string;
}

/** Prefijo común para todo dato sintético que este suite crea — fácil de reconocer a simple vista en `dev`. */
export const MARCADOR_CI = 'ci-test-integracion';

let clienteCacheado: RDSDataClient | undefined;

export function cliente(): RDSDataClient {
  if (!clienteCacheado) {
    clienteCacheado = new RDSDataClient({ region: process.env.AWS_REGION ?? 'us-east-2' });
  }
  return clienteCacheado;
}

export function config(): AuroraDataApiConfig {
  const resourceArn = process.env.AURORA_RESOURCE_ARN;
  const secretArn = process.env.AURORA_SECRET_ARN;
  const database = process.env.AURORA_DATABASE;
  if (!resourceArn || !secretArn || !database) {
    throw new Error(
      'Faltan AURORA_RESOURCE_ARN/AURORA_SECRET_ARN/AURORA_DATABASE en el entorno. ' +
        'Este suite no se corre con "npx jest" directo — usar "npm run test:integration -- --grupo <g> --env <e>" ' +
        '(scripts/test-integration.mjs los resuelve por CloudFormation antes de lanzar Jest).'
    );
  }
  return { resourceArn, secretArn, database };
}

export async function ejecutar(sql: string, parameters: SqlParameter[] = []): Promise<Record<string, unknown>[]> {
  const { resourceArn, secretArn, database } = config();
  const resultado = await cliente().send(
    new ExecuteStatementCommand({ resourceArn, secretArn, database, sql, parameters, formatRecordsAs: 'JSON' })
  );
  return resultado.formattedRecords ? (JSON.parse(resultado.formattedRecords) as Record<string, unknown>[]) : [];
}

function paramTexto(name: string, value: string): SqlParameter {
  return { name, value: { stringValue: value } };
}

/**
 * La primera estación real sembrada (orden alfabético de `codigo`, estable
 * entre corridas) — nunca hardcodea CHANCAYLLO/MALA/etc. por nombre, para
 * que este suite siga funcionando igual si algún día "nonato" cambia sus
 * estaciones o se corre contra el `dev` de un grupo distinto (sección 13).
 */
export async function primeraEstacionSembrada(): Promise<{ id: string; codigo: string }> {
  const filas = await ejecutar('SELECT id, codigo FROM estaciones ORDER BY codigo LIMIT 1');
  const fila = filas[0];
  if (!fila) {
    throw new Error(
      'No hay ninguna fila en "estaciones" — ¿corrió db:migrate en este entorno? ' +
        '(incluye 1787920000000_seed-estaciones-nonato.sql, sección 12.6).'
    );
  }
  return { id: String(fila.id), codigo: String(fila.codigo) };
}

export async function primerProductoActivo(): Promise<{ id: string; nombre: string }> {
  const filas = await ejecutar('SELECT id, nombre FROM productos_maestro WHERE activo = true ORDER BY nombre LIMIT 1');
  const fila = filas[0];
  if (!fila) throw new Error('No hay ningún producto activo en "productos_maestro" — ¿corrió el seed 1787936588637?');
  return { id: String(fila.id), nombre: String(fila.nombre) };
}

export async function primerTanqueDeEstacion(estacionCodigo: string): Promise<{ id: string; productoId: string; nombre: string }> {
  const filas = await ejecutar(
    `SELECT t.id, t.producto_id, t.nombre
     FROM tanques t JOIN estaciones e ON e.id = t.estacion_id
     WHERE e.codigo = :codigo AND t.activo = true
     ORDER BY t.nombre LIMIT 1`,
    [paramTexto('codigo', estacionCodigo)]
  );
  const fila = filas[0];
  if (!fila) {
    throw new Error(
      `No hay ningún tanque activo para la estación "${estacionCodigo}" — ¿corrió el seed 1787936588638_seed-tanques.sql?`
    );
  }
  return { id: String(fila.id), productoId: String(fila.producto_id), nombre: String(fila.nombre) };
}
