// handler.ts — composición raíz del Lambda `admin-tanques` (sección 4.1/3.8.4).
//
// Un solo Lambda para las 2 operaciones (GET /tanques, PUT /tanques/{id}),
// mismo criterio que consulta-cierres: se enruta por `httpMethod`, no hace
// falta un Lambda separado porque ambas comparten el mismo agregado
// (`tanques`) y el mismo bajo volumen de tráfico.

import { RDSDataClient } from '@aws-sdk/client-rds-data';
import { parseAuthContext } from '@fuelhub/shared-kernel';
import { jsonResponse, mapErrorToResponse, type ApiResponse } from '@fuelhub/shared-kernel';
import { ListarTanques } from './application/use-cases/ListarTanques';
import { ActualizarTanque } from './application/use-cases/ActualizarTanque';
import { PostgresTanqueRepository, type AuroraDataApiConfig } from './infrastructure/adapters/PostgresTanqueRepository';
import {
  extraerEstacionCodigoQuery,
  extraerId,
  parsearTanqueUpdateInput,
  type ApiGatewayEventLike,
} from './infrastructure/http/ApiGatewayRequestMapper';

const config: AuroraDataApiConfig = {
  resourceArn: requiredEnv('AURORA_CLUSTER_ARN'),
  secretArn: requiredEnv('AURORA_SECRET_ARN'),
  database: requiredEnv('AURORA_DATABASE_NAME'),
};

const rdsClient = new RDSDataClient({});
const repo = new PostgresTanqueRepository(rdsClient, config);
const listarTanques = new ListarTanques(repo);
const actualizarTanque = new ActualizarTanque(repo);

export const handler = async (event: ApiGatewayEventLike): Promise<ApiResponse> => {
  try {
    const auth = parseAuthContext(event);

    if (event.httpMethod === 'PUT') {
      const id = extraerId(event);
      if (!id) {
        return jsonResponse(400, { error: 'PARAMETROS_INVALIDOS', message: 'Falta el parámetro de ruta "id".' });
      }
      const cambios = parsearTanqueUpdateInput(event);
      const resultado = await actualizarTanque.ejecutar(auth, id, cambios);
      return jsonResponse(200, resultado);
    }

    // GET /tanques (default) — la ruta la fija el api-stack, este handler
    // solo necesita distinguir PUT del resto.
    const estacionCodigo = extraerEstacionCodigoQuery(event);
    const resultado = await listarTanques.ejecutar(auth, estacionCodigo);
    return jsonResponse(200, resultado);
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
