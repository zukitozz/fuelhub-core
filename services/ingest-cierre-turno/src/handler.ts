// handler.ts — composición raíz del Lambda `ingest-cierre-turno` (sección 4.1).
//
// La idempotencia (`Idempotency-Key`, sección 2.3) se resuelve acá, envolviendo
// el handler completo con `makeIdempotent` de AWS Lambda Powertools — no en el
// caso de uso, que se mantiene libre de esta preocupación de infraestructura
// (ver el comentario en `RegistrarCierreTurno.ts`). `eventKeyJmesPath` apunta
// al header `Idempotency-Key` del evento de API Gateway; Powertools guarda el
// resultado en DynamoDB (tabla via `IDEMPOTENCY_TABLE_NAME`) y, ante un
// reintento con la misma key, devuelve la respuesta cacheada sin volver a
// ejecutar `manejarRequest` (o sea, sin volver a tocar Postgres). El
// `responseHook` (`downgradeReplayStatusTo200`, `@fuelhub/shared-kernel`)
// baja el `201` cacheado a `200` solo en ese reintento, tal como pide el
// contrato (11.2) — ver v1.48.

import type { Context } from 'aws-lambda';
import { RDSDataClient } from '@aws-sdk/client-rds-data';
import { IdempotencyConfig, makeIdempotent } from '@aws-lambda-powertools/idempotency';
import { DynamoDBPersistenceLayer } from '@aws-lambda-powertools/idempotency/dynamodb';
import { parseAuthContext } from '@fuelhub/shared-kernel';
import { downgradeReplayStatusTo200, jsonResponse, mapErrorToResponse, type ApiResponse } from '@fuelhub/shared-kernel';
import { RegistrarCierreTurno } from './application/use-cases/RegistrarCierreTurno';
import { PostgresCierreTurnoIngestaRepository, type AuroraDataApiConfig } from './infrastructure/adapters/PostgresCierreTurnoIngestaRepository';
import { parsearCierreTurnoInput, type ApiGatewayEventLike } from './infrastructure/http/ApiGatewayRequestMapper';

const config: AuroraDataApiConfig = {
  resourceArn: requiredEnv('AURORA_CLUSTER_ARN'),
  secretArn: requiredEnv('AURORA_SECRET_ARN'),
  database: requiredEnv('AURORA_DATABASE_NAME'),
};

const rdsClient = new RDSDataClient({});
const repo = new PostgresCierreTurnoIngestaRepository(rdsClient, config);
const registrarCierreTurno = new RegistrarCierreTurno(repo);

const persistenceStore = new DynamoDBPersistenceLayer({ tableName: requiredEnv('IDEMPOTENCY_TABLE_NAME') });
const idempotencyConfig = new IdempotencyConfig({
  eventKeyJmesPath: 'headers."Idempotency-Key"',
  throwOnNoIdempotencyKey: true, // API Gateway ya exige el header (parámetro requerido del contrato, sección 11.2) — si llegara a faltar, es un bug de configuración, no un caso a tolerar en silencio
  responseHook: downgradeReplayStatusTo200, // ver nota de cabecera y v1.48 — solo corre en un reintento, baja el 201 cacheado a 200
});

const manejarRequest = async (event: ApiGatewayEventLike, _context: Context): Promise<ApiResponse> => {
  try {
    const auth = parseAuthContext(event);
    const input = parsearCierreTurnoInput(event);
    const resultado = await registrarCierreTurno.ejecutar(auth, input);
    return jsonResponse(201, resultado);
  } catch (err) {
    return mapErrorToResponse(err);
  }
};

export const handler = makeIdempotent(manejarRequest, {
  persistenceStore,
  config: idempotencyConfig,
});

function requiredEnv(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) {
    throw new Error(`Variable de entorno requerida no configurada: ${nombre}`);
  }
  return valor;
}
