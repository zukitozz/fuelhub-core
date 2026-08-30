// infrastructure/http/ApiGatewayRequestMapper.ts
//
// Mismo criterio que los mappers de ingest-cierre-turno/ingest-cierre-dia —
// acá sin `withNormalizedIdempotencyKeyHeader` (`@fuelhub/shared-kernel`)
// porque este endpoint no es idempotente por header (sección 11.2, POST /compras).

import { ParametrosInvalidosError } from '@fuelhub/shared-kernel';
import type { CompraInput } from '../../domain/CompraInput';

export interface ApiGatewayEventLike {
  readonly body?: string | null;
  readonly isBase64Encoded?: boolean;
  readonly requestContext?: { authorizer?: { claims?: Record<string, string> } };
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
