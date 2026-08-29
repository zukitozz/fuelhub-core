// infrastructure/http/ApiGatewayRequestMapper.ts
//
// Traduce el evento crudo de API Gateway (REST API, sección 5.1) a los DTOs
// de query que esperan los casos de uso — es la única capa que conoce la
// forma del evento de Lambda; los casos de uso nunca ven `queryStringParameters`.

import type { ListarCierresTurnoQuery } from '../../application/use-cases/ListarCierresTurno';
import type { ListarCierresDiaQuery } from '../../application/use-cases/ListarCierresDia';

export interface ApiGatewayEventLike {
  readonly resource?: string;
  readonly path?: string;
  readonly httpMethod?: string;
  readonly queryStringParameters?: Record<string, string | undefined> | null;
  readonly requestContext?: { authorizer?: { claims?: Record<string, string> } };
}

export function mapListarCierresTurnoQuery(event: ApiGatewayEventLike): ListarCierresTurnoQuery {
  const qs = event.queryStringParameters ?? {};
  return {
    estacionCodigo: qs.estacionCodigo,
    fechaDesde: qs.fechaDesde,
    fechaHasta: qs.fechaHasta,
    turno: qs.turno,
    usuarioCodigo: qs.usuarioCodigo,
    estado: qs.estado,
    page: qs.page,
    pageSize: qs.pageSize,
  };
}

export function mapListarCierresDiaQuery(event: ApiGatewayEventLike): ListarCierresDiaQuery {
  const qs = event.queryStringParameters ?? {};
  return {
    estacionCodigo: qs.estacionCodigo,
    fechaDesde: qs.fechaDesde,
    fechaHasta: qs.fechaHasta,
    estado: qs.estado,
    page: qs.page,
    pageSize: qs.pageSize,
  };
}

/**
 * Distingue qué operación del contrato (sección 11.2) se está invocando —
 * este Lambda expone las dos rutas `GET /cierres-turno` y `GET /cierres-dia`
 * (sección 4.1: agrupadas para consulta-cierres, a diferencia de
 * consulta-cierre-detalle que queda en su propio Lambda).
 */
export type OperacionConsultaCierres = 'cierres-turno' | 'cierres-dia' | 'desconocida';

export function resolverOperacion(event: ApiGatewayEventLike): OperacionConsultaCierres {
  const recurso = event.resource ?? event.path ?? '';
  if (recurso.includes('cierres-turno')) return 'cierres-turno';
  if (recurso.includes('cierres-dia')) return 'cierres-dia';
  return 'desconocida';
}
