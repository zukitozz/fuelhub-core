// handler.ts — composición raíz del Lambda `consulta-cierres` (sección 4.1).
//
// Único punto donde se instancian adaptadores concretos (RDS Data API) y se
// inyectan en los casos de uso — nada de lógica de negocio vive acá, solo
// wiring + traducción HTTP (sección 4, regla 3).

import { RDSDataClient } from '@aws-sdk/client-rds-data';
import { parseAuthContext } from '@fuelhub/shared-kernel';
import { jsonResponse, mapErrorToResponse, type ApiResponse } from '@fuelhub/shared-kernel';
import { ListarCierresTurno } from './application/use-cases/ListarCierresTurno';
import { ListarCierresDia } from './application/use-cases/ListarCierresDia';
import { PostgresCierreTurnoQueryRepository, type AuroraDataApiConfig } from './infrastructure/adapters/PostgresCierreTurnoQueryRepository';
import { PostgresCierreDiaQueryRepository } from './infrastructure/adapters/PostgresCierreDiaQueryRepository';
import {
  mapListarCierresDiaQuery,
  mapListarCierresTurnoQuery,
  resolverOperacion,
  type ApiGatewayEventLike,
} from './infrastructure/http/ApiGatewayRequestMapper';

// Configuración leída de variables de entorno del stack CDK (sección 6.1) —
// se resuelve una sola vez por contenedor Lambda, no en cada invocación.
const config: AuroraDataApiConfig = {
  resourceArn: requiredEnv('AURORA_CLUSTER_ARN'),
  secretArn: requiredEnv('AURORA_SECRET_ARN'),
  database: requiredEnv('AURORA_DATABASE_NAME'),
};

const rdsClient = new RDSDataClient({});
const cierreTurnoRepo = new PostgresCierreTurnoQueryRepository(rdsClient, config);
const cierreDiaRepo = new PostgresCierreDiaQueryRepository(rdsClient, config);
const listarCierresTurno = new ListarCierresTurno(cierreTurnoRepo);
const listarCierresDia = new ListarCierresDia(cierreDiaRepo);

export const handler = async (event: ApiGatewayEventLike): Promise<ApiResponse> => {
  try {
    const auth = parseAuthContext(event);
    const operacion = resolverOperacion(event);

    switch (operacion) {
      case 'cierres-turno': {
        const query = mapListarCierresTurnoQuery(event);
        const resultado = await listarCierresTurno.ejecutar(auth, query);
        return jsonResponse(200, resultado);
      }
      case 'cierres-dia': {
        const query = mapListarCierresDiaQuery(event);
        const resultado = await listarCierresDia.ejecutar(auth, query);
        return jsonResponse(200, resultado);
      }
      default:
        // No debería ocurrir si el API Gateway está bien configurado (sección
        // 12.2) — cada ruta del contrato apunta a este Lambda explícitamente.
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
