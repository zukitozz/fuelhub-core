// infrastructure/http/ApiGatewayRequestMapper.ts
//
// Mismo criterio que los mappers de ingest-cierre-turno/ingest-cierre-dia —
// acá sin `withNormalizedIdempotencyKeyHeader` (`@fuelhub/shared-kernel`)
// porque este endpoint no es idempotente por header (sección 11.2, POST /compras).
//
// v1.66: este Lambda pasa a resolver 2 operaciones (POST /compras,
// PUT /compras/{id}, sección 3.8.6) -- se agregan `extraerId` y
// `parsearCompraUpdateInput`, mismo patrón que el mapper de `admin-tanques`.
//
// v1.67: se agregan las 2 operaciones de lectura (GET /compras, GET
// /compras/{id}, sección 8.1/8.2 de specs-frontend-fuelhub-web.md) --
// `mapListarComprasQuery` traduce los query params, mismo criterio que
// `mapListarCierresTurnoQuery` (consulta-cierres).

import { ParametrosInvalidosError } from '@fuelhub/shared-kernel';
import type { CompraInput } from '../../domain/CompraInput';
import type { CompraUpdateInput } from '../../domain/CompraUpdateInput';
import type { ListarComprasQuery } from '../../application/use-cases/ListarCompras';

export interface ApiGatewayEventLike {
  readonly httpMethod?: string;
  readonly pathParameters?: Record<string, string | undefined> | null;
  readonly queryStringParameters?: Record<string, string | undefined> | null;
  readonly body?: string | null;
  readonly isBase64Encoded?: boolean;
  readonly requestContext?: { authorizer?: { claims?: Record<string, string> } };
}

export function extraerId(event: ApiGatewayEventLike): string | undefined {
  return event.pathParameters?.id ?? undefined;
}

export function parsearCompraInput(event: ApiGatewayEventLike): CompraInput {
  if (!event.body) {
    throw new ParametrosInvalidosError('El cuerpo del request está vacío.', [{ field: 'body', issue: 'requerido' }]);
  }

  const texto = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf-8') : event.body;

  let json: unknown;
  try {
    json = JSON.parse(texto);
  } catch {
    throw new ParametrosInvalidosError('El cuerpo del request no es JSON válido.', [{ field: 'body', issue: 'JSON malformado' }]);
  }

  if (typeof json !== 'object' || json === null) {
    throw new ParametrosInvalidosError('El cuerpo del request debe ser un objeto JSON.', [{ field: 'body', issue: 'se esperaba un objeto' }]);
  }

  return json as CompraInput;
}

export function parsearCompraUpdateInput(event: ApiGatewayEventLike): CompraUpdateInput {
  if (!event.body) {
    throw new ParametrosInvalidosError('El cuerpo del request está vacío.', [{ field: 'body', issue: 'requerido' }]);
  }

  const texto = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf-8') : event.body;

  let json: unknown;
  try {
    json = JSON.parse(texto);
  } catch {
    throw new ParametrosInvalidosError('El cuerpo del request no es JSON válido.', [{ field: 'body', issue: 'JSON malformado' }]);
  }

  if (typeof json !== 'object' || json === null) {
    throw new ParametrosInvalidosError('El cuerpo del request debe ser un objeto JSON.', [{ field: 'body', issue: 'se esperaba un objeto' }]);
  }

  return json as CompraUpdateInput;
}

export function mapListarComprasQuery(event: ApiGatewayEventLike): ListarComprasQuery {
  const qs = event.queryStringParameters ?? {};
  return {
    estacionCodigo: qs.estacionCodigo,
    fechaDesde: qs.fechaDesde,
    fechaHasta: qs.fechaHasta,
    estado: qs.estado,
    productoId: qs.productoId,
    categoria: qs.categoria,
    page: qs.page,
    pageSize: qs.pageSize,
  };
}
