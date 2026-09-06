// handler.ts — composición raíz del Lambda `ingest-compra` (sección 4.1).
//
// Sin `makeIdempotent`: a diferencia de los dos Lambdas de cierres, este
// endpoint no es idempotente por header (bajo volumen, sin reintentos
// automáticos esperados — sección 11.2 del contrato OpenAPI) — no hace falta
// la tabla DynamoDB de idempotencia ni esa variable de entorno acá.
//
// v1.66: mismo Lambda pasa a resolver también PUT /compras/{id} (edición
// parcial + anulación, sección 3.8.6) — se enruta por `httpMethod`, mismo
// criterio que `admin-tanques` (GET /tanques + PUT /tanques/{id} comparten
// Lambda porque ambas rutas operan sobre el mismo agregado y bajo volumen).

import { RDSDataClient } from '@aws-sdk/client-rds-data';
import { parseAuthContext } from '@fuelhub/shared-kernel';
import { jsonResponse, mapErrorToResponse, type ApiResponse } from '@fuelhub/shared-kernel';
import { RegistrarCompra } from './application/use-cases/RegistrarCompra';
import { ActualizarCompra } from './application/use-cases/ActualizarCompra';
import { PostgresCompraIngestaRepository, type AuroraDataApiConfig } from './infrastructure/adapters/PostgresCompraIngestaRepository';
import {
  extraerId,
  parsearCompraInput,
  parsearCompraUpdateInput,
  type ApiGatewayEventLike,
} from './infrastructure/http/ApiGatewayRequestMapper';

const config: AuroraDataApiConfig = {
  resourceArn: requiredEnv('AURORA_CLUSTER_ARN'),
  secretArn: requiredEnv('AURORA_SECRET_ARN'),
  database: requiredEnv('AURORA_DATABASE_NAME'),
};

const rdsClient = new RDSDataClient({});
const repo = new PostgresCompraIngestaRepository(rdsClient, config);
const registrarCompra = new RegistrarCompra(repo);
const actualizarCompra = new ActualizarCompra(repo);

export const handler = async (event: ApiGatewayEventLike): Promise<ApiResponse> => {
  try {
    const auth = parseAuthContext(event);

    if (event.httpMethod === 'PUT') {
      const id = extraerId(event);
      if (!id) {
        return jsonResponse(400, { error: 'PARAMETROS_INVALIDOS', message: 'Falta el parámetro de ruta "id".' });
      }
      const cambios = parsearCompraUpdateInput(event);
      const resultado = await actualizarCompra.ejecutar(auth, id, cambios);
      return jsonResponse(200, resultado);
    }

    // POST /compras (default) — la ruta la fija el api-stack, este handler
    // solo necesita distinguir PUT del resto.
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
