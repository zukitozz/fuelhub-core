// handler.ts — composición raíz del Lambda `consulta-cierre-detalle`
// (sección 4.1). Lambda separado de consulta-cierres a propósito, decidido
// por Jorge para trazabilidad independiente (logs/métricas/IAM propios).

import { RDSDataClient } from '@aws-sdk/client-rds-data';
import { parseAuthContext } from '@fuelhub/shared-kernel';
import { jsonResponse, mapErrorToResponse, errorBody, type ApiResponse } from '@fuelhub/shared-kernel';
import { ObtenerCierreTurnoDetalle } from './application/use-cases/ObtenerCierreTurnoDetalle';
import { PostgresCierreTurnoDetalleRepository, type AuroraDataApiConfig } from './infrastructure/adapters/PostgresCierreTurnoDetalleRepository';
import { extraerId, type ApiGatewayEventLike } from './infrastructure/http/ApiGatewayRequestMapper';

const config: AuroraDataApiConfig = {
  resourceArn: requiredEnv('AURORA_CLUSTER_ARN'),
  secretArn: requiredEnv('AURORA_SECRET_ARN'),
  database: requiredEnv('AURORA_DATABASE_NAME'),
};

const rdsClient = new RDSDataClient({});
const detalleRepo = new PostgresCierreTurnoDetalleRepository(rdsClient, config);
const obtenerCierreTurnoDetalle = new ObtenerCierreTurnoDetalle(detalleRepo);

export const handler = async (event: ApiGatewayEventLike): Promise<ApiResponse> => {
  try {
    const auth = parseAuthContext(event);
    const id = extraerId(event);

    if (!id) {
      return jsonResponse(400, errorBody('PARAMETROS_INVALIDOS', 'Falta el parámetro de ruta "id".'));
    }

    const resultado = await obtenerCierreTurnoDetalle.ejecutar(auth, id);
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
