// handler.ts — composición raíz del Lambda `consulta-reportes` (sección
// 4.1 / 3.8.2). Último Lambda del inventario inicial: expone las 2 rutas de
// reportes cross-estación (`GET /reportes/margen`, `GET /reportes/abastecimiento`)
// bajo un solo Lambda, mismo criterio que consulta-cierres.

import { RDSDataClient } from '@aws-sdk/client-rds-data';
import { parseAuthContext } from '@fuelhub/shared-kernel';
import { jsonResponse, mapErrorToResponse, type ApiResponse } from '@fuelhub/shared-kernel';
import { ObtenerReporteMargen } from './application/use-cases/ObtenerReporteMargen';
import { ObtenerReporteAbastecimiento } from './application/use-cases/ObtenerReporteAbastecimiento';
import { PostgresReporteMargenQueryRepository, type AuroraDataApiConfig } from './infrastructure/adapters/PostgresReporteMargenQueryRepository';
import { PostgresReporteAbastecimientoQueryRepository } from './infrastructure/adapters/PostgresReporteAbastecimientoQueryRepository';
import {
  mapObtenerReporteAbastecimientoQuery,
  mapObtenerReporteMargenQuery,
  resolverOperacion,
  type ApiGatewayEventLike,
} from './infrastructure/http/ApiGatewayRequestMapper';

const config: AuroraDataApiConfig = {
  resourceArn: requiredEnv('AURORA_CLUSTER_ARN'),
  secretArn: requiredEnv('AURORA_SECRET_ARN'),
  database: requiredEnv('AURORA_DATABASE_NAME'),
};

const rdsClient = new RDSDataClient({});
const margenRepo = new PostgresReporteMargenQueryRepository(rdsClient, config);
const abastecimientoRepo = new PostgresReporteAbastecimientoQueryRepository(rdsClient, config);
const obtenerReporteMargen = new ObtenerReporteMargen(margenRepo);
const obtenerReporteAbastecimiento = new ObtenerReporteAbastecimiento(abastecimientoRepo);

export const handler = async (event: ApiGatewayEventLike): Promise<ApiResponse> => {
  try {
    const auth = parseAuthContext(event);
    const operacion = resolverOperacion(event);

    switch (operacion) {
      case 'margen': {
        const query = mapObtenerReporteMargenQuery(event);
        const resultado = await obtenerReporteMargen.ejecutar(auth, query);
        return jsonResponse(200, resultado);
      }
      case 'abastecimiento': {
        const query = mapObtenerReporteAbastecimientoQuery(event);
        const resultado = await obtenerReporteAbastecimiento.ejecutar(auth, query);
        return jsonResponse(200, resultado);
      }
      default:
        return jsonResponse(404, { error: 'RUTA_NO_ENCONTRADA', message: `Ruta no reconocida: ${event.resource ?? event.path ?? '(desconocida)'}` });
    }
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
