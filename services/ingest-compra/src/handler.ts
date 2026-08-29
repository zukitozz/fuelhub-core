// handler.ts — composición raíz del Lambda `ingest-compra` (sección 4.1).
//
// Sin `makeIdempotent`: a diferencia de los dos Lambdas de cierres, este
// endpoint no es idempotente por header (bajo volumen, sin reintentos
// automáticos esperados — sección 11.2 del contrato OpenAPI) — no hace falta
// la tabla DynamoDB de idempotencia ni esa variable de entorno acá.

import { RDSDataClient } from '@aws-sdk/client-rds-data';
import { parseAuthContext } from '@fuelhub/shared-kernel';
import { jsonResponse, mapErrorToResponse, type ApiResponse } from '@fuelhub/shared-kernel';
import { RegistrarCompra } from './application/use-cases/RegistrarCompra';
import { PostgresCompraIngestaRepository, type AuroraDataApiConfig } from './infrastructure/adapters/PostgresCompraIngestaRepository';
import { parsearCompraInput, type ApiGatewayEventLike } from './infrastructure/http/ApiGatewayRequestMapper';

const config: AuroraDataApiConfig = {
  resourceArn: requiredEnv('AURORA_CLUSTER_ARN'),
  secretArn: requiredEnv('AURORA_SECRET_ARN'),
  database: requiredEnv('AURORA_DATABASE_NAME'),
};

const rdsClient = new RDSDataClient({});
const repo = new PostgresCompraIngestaRepository(rdsClient, config);
const registrarCompra = new RegistrarCompra(repo);

export const handler = async (event: ApiGatewayEventLike): Promise<ApiResponse> => {
  try {
    const auth = parseAuthContext(event);
    const input = parsearCompraInput(event);
    const resultado = await registrarCompra.ejecutar(auth, input);
    return jsonResponse(201, resultado);
  } catch (err) {
    return mapErrorToResponse(err);
  }
};

function requiredEnv(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) {
    throw new Error(`Variable de entorno requerida no configurada: ${nombre}`);
  }
  return valor;
}
