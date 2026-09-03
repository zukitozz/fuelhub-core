// infrastructure/http/ApiGatewayRequestMapper.ts
//
// Traduce el evento crudo de API Gateway a los DTOs de query que esperan los
// casos de uso — mismo patrón que consulta-cierres (un solo Lambda resuelve
// las 3 rutas de reportes, sección 4.1 — `dia` agregada en v1.58).

import type { ObtenerReporteMargenQuery } from '../../application/use-cases/ObtenerReporteMargen';
import type { ObtenerReporteAbastecimientoQuery } from '../../application/use-cases/ObtenerReporteAbastecimiento';
import type { ObtenerReporteDiaQuery } from '../../application/use-cases/ObtenerReporteDia';

export interface ApiGatewayEventLike {
  readonly resource?: string;
  readonly path?: string;
  readonly httpMethod?: string;
  readonly queryStringParameters?: Record<string, string | undefined> | null;
  readonly requestContext?: { authorizer?: { claims?: Record<string, string> } };
}

export type OperacionConsultaReportes = 'margen' | 'abastecimiento' | 'dia' | 'desconocida';

export function resolverOperacion(event: ApiGatewayEventLike): OperacionConsultaReportes {
  const recurso = event.resource ?? event.path ?? '';
  // Orden importa: 'dia' es un sufijo corto (`/reportes/dia`) que no colisiona
  // con los otros dos, pero se resuelve antes por prolijidad de lectura.
  if (recurso.includes('margen')) return 'margen';
  if (recurso.includes('abastecimiento')) return 'abastecimiento';
  if (recurso.includes('/dia')) return 'dia';
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

export function mapObtenerReporteDiaQuery(event: ApiGatewayEventLike): ObtenerReporteDiaQuery {
  const qs = event.queryStringParameters ?? {};
  return {
    estacionCodigo: qs.estacionCodigo,
    fechaNegocio: qs.fechaNegocio,
  };
}
