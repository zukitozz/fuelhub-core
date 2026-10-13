// handler.ts — composición raíz del Lambda `ingest-reporte-top-facturas`
// (v1.89), POST /reportes/top-facturas.
//
// Idempotencia (`Idempotency-Key`) envolviendo el handler completo con
// Lambda Powertools, mismo criterio y mismo motivo que ingest-cierre-dia/
// ingest-cierre-turno (ver la nota de cabecera de RegistrarReporteTopFacturas.ts):
// el PUT a S3 ya es idempotente por sí solo, pero publicar el evento dos
// veces por un reintento HTTP duplicaría la notificación de WhatsApp.
// `withNormalizedIdempotencyKeyHeader` ANTES del wrapper, mismo bug real de
// casing HTTP/2 documentado en ingest-cierre-turno/src/handler.ts.

import type { Context } from 'aws-lambda';
import { RDSDataClient } from '@aws-sdk/client-rds-data';
import { S3Client } from '@aws-sdk/client-s3';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { IdempotencyConfig, makeIdempotent } from '@aws-lambda-powertools/idempotency';
import { DynamoDBPersistenceLayer } from '@aws-lambda-powertools/idempotency/dynamodb';
import { parseAuthContext, withNormalizedIdempotencyKeyHeader } from '@fuelhub/shared-kernel';
import { downgradeReplayStatusTo200, jsonResponse, mapErrorToResponse, type ApiResponse } from '@fuelhub/shared-kernel';
import { fuenteEventBridgePara, type Ambiente } from '@fuelhub/shared-kernel';
import { RegistrarReporteTopFacturas } from './application/use-cases/RegistrarReporteTopFacturas';
import { PostgresEstacionLookupRepository, type AuroraDataApiConfig } from './infrastructure/adapters/PostgresEstacionLookupRepository';
import { S3ReporteTopFacturasStorageRepository } from './infrastructure/adapters/S3ReporteTopFacturasStorageRepository';
import { EventBridgeReporteTopFacturasPublisher } from './infrastructure/adapters/EventBridgeReporteTopFacturasPublisher';
import { parsearReporteTopFacturasInput, type ApiGatewayEventLike } from './infrastructure/http/ApiGatewayRequestMapper';

const config: AuroraDataApiConfig = {
  resourceArn: requiredEnv('AURORA_CLUSTER_ARN'),
  secretArn: requiredEnv('AURORA_SECRET_ARN'),
  database: requiredEnv('AURORA_DATABASE_NAME'),
};

const rdsClient = new RDSDataClient({});
const estaciones = new PostgresEstacionLookupRepository(rdsClient, config);

const s3Client = new S3Client({});
const repo = new S3ReporteTopFacturasStorageRepository(s3Client, requiredEnv('REPORTES_BUCKET_NAME'));

const eventBridgeClient = new EventBridgeClient({});
const publicadorEventos = new EventBridgeReporteTopFacturasPublisher(
  eventBridgeClient,
  requiredEnv('EVENTBRIDGE_BUS_NAME'),
  fuenteEventBridgePara(requiredEnv('AMBIENTE') as Ambiente)
);

const registrarReporteTopFacturas = new RegistrarReporteTopFacturas(estaciones, repo, publicadorEventos);

const persistenceStore = new DynamoDBPersistenceLayer({ tableName: requiredEnv('IDEMPOTENCY_TABLE_NAME') });
const idempotencyConfig = new IdempotencyConfig({
  eventKeyJmesPath: 'headers."Idempotency-Key"',
  throwOnNoIdempotencyKey: true,
  responseHook: downgradeReplayStatusTo200,
});

const manejarRequest = async (event: ApiGatewayEventLike, _context: Context): Promise<ApiResponse> => {
  try {
    const auth = parseAuthContext(event);
    const input = parsearReporteTopFacturasInput(event);
    const resultado = await registrarReporteTopFacturas.ejecutar(auth, input);
    return jsonResponse(201, resultado);
  } catch (err) {
    return mapErrorToResponse(err);
  }
};

const handlerIdempotente = makeIdempotent(manejarRequest, {
  persistenceStore,
  config: idempotencyConfig,
});

export const handler = (event: ApiGatewayEventLike, context: Context): Promise<ApiResponse> =>
  handlerIdempotente(withNormalizedIdempotencyKeyHeader(event), context);

function requiredEnv(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) {
    throw new Error(`Variable de entorno requerida no configurada: ${nombre}`);
  }
  return valor;
}
