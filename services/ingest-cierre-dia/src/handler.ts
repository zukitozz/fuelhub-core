// handler.ts — composición raíz del Lambda `ingest-cierre-dia` (sección 4.1).
//
// Igual que ingest-cierre-turno: la idempotencia se resuelve envolviendo el
// handler completo con Powertools (`makeIdempotent`), no en el caso de uso.
// La diferencia acá es un puerto adicional cableado en este composition root:
// `EventBridgeCierreDiaPublisher`, para el evento `CierreDiaRegistrado`. Mismo
// `responseHook` (`downgradeReplayStatusTo200`) que ingest-cierre-turno para
// el 201→200 del reintento (11.2) — ver v1.48.

import type { Context } from 'aws-lambda';
import { RDSDataClient } from '@aws-sdk/client-rds-data';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { IdempotencyConfig, makeIdempotent } from '@aws-lambda-powertools/idempotency';
import { DynamoDBPersistenceLayer } from '@aws-lambda-powertools/idempotency/dynamodb';
import { parseAuthContext } from '@fuelhub/shared-kernel';
import { downgradeReplayStatusTo200, jsonResponse, mapErrorToResponse, type ApiResponse } from '@fuelhub/shared-kernel';
import { RegistrarCierreDia } from './application/use-cases/RegistrarCierreDia';
import { PostgresCierreDiaIngestaRepository, type AuroraDataApiConfig } from './infrastructure/adapters/PostgresCierreDiaIngestaRepository';
import { EventBridgeCierreDiaPublisher } from './infrastructure/adapters/EventBridgeCierreDiaPublisher';
import { parsearCierreDiaInput, type ApiGatewayEventLike } from './infrastructure/http/ApiGatewayRequestMapper';

const config: AuroraDataApiConfig = {
  resourceArn: requiredEnv('AURORA_CLUSTER_ARN'),
  secretArn: requiredEnv('AURORA_SECRET_ARN'),
  database: requiredEnv('AURORA_DATABASE_NAME'),
};

const rdsClient = new RDSDataClient({});
const repo = new PostgresCierreDiaIngestaRepository(rdsClient, config);

const eventBridgeClient = new EventBridgeClient({});
const publicadorEventos = new EventBridgeCierreDiaPublisher(eventBridgeClient, requiredEnv('EVENTBRIDGE_BUS_NAME'));

const registrarCierreDia = new RegistrarCierreDia(repo, publicadorEventos);

const persistenceStore = new DynamoDBPersistenceLayer({ tableName: requiredEnv('IDEMPOTENCY_TABLE_NAME') });
const idempotencyConfig = new IdempotencyConfig({
  eventKeyJmesPath: 'headers."Idempotency-Key"',
  throwOnNoIdempotencyKey: true,
  responseHook: downgradeReplayStatusTo200,
});

const manejarRequest = async (event: ApiGatewayEventLike, _context: Context): Promise<ApiResponse> => {
  try {
    const auth = parseAuthContext(event);
    const input = parsearCierreDiaInput(event);
    const resultado = await registrarCierreDia.ejecutar(auth, input);
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
