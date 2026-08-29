// infrastructure/http/ApiGatewayRequestMapper.ts
//
// Traduce el evento crudo de API Gateway a los DTOs de query que esperan los
// casos de uso — mismo patrón que consulta-cierres (un solo Lambda resuelve
// las 2 rutas de reportes, sección 4.1).

import type { ObtenerReporteMargenQuery } from '../../application/use-cases/ObtenerReporteMargen';
import type { ObtenerReporteAbastecimientoQuery } from '../../application/use-cases/ObtenerReporteAbastecimiento';

export interface ApiGatewayEventLike {
  readonly resource?: string;
  readonly path?: string;
  readonly httpMethod?: string;
  readonly queryStringParameters?: Record<string, string | undefined> | null;
  readonly requestContext?: { authorizer?: { claims?: Record<string, string> } };
}

export type OperacionConsultaReportes = 'margen' | 'abastecimiento' | 'desconocida';

export function resolverOperacion(event: ApiGatewayEventLike): OperacionConsultaReportes {
  const recurso = event.resource ?? event.path ?? '';
  if (recurso.includes('margen')) return 'margen';
  if (recurso.includes('abastecimiento')) return 'abastecimiento';
  return 'desconocida';
}

export function mapObtenerReporteMargenQuery(event: ApiGatewayEventLike): ObtenerReporteMargenQuery {
  const qs = event.queryStringParameters ?? {};
  return {
    estacionCodigo: qs.estacionCodigo,
    fechaDesde: qs.fechaDesde,
    fechaHasta: qs.fechaHasta,
  };
}

export function mapObtenerReporteAbastecimientoQuery(event: ApiGatewayEventLike): ObtenerReporteAbastecimientoQuery {
  const qs = event.queryStringParameters ?? {};
  return {
    estacionCodigo: qs.estacionCodigo,
  };
}
