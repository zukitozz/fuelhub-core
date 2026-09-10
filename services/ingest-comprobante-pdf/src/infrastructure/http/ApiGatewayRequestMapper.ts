// infrastructure/http/ApiGatewayRequestMapper.ts
//
// Combina el parseo de body de ingest-cierre-turno con el de path param de
// ingest-compra (extraerId). Sin withNormalizedIdempotencyKeyHeader -- este
// endpoint no es idempotente por header (PUT a una key fija, sin efecto
// secundario al repetirse -- ver spec sección 2).

import { ParametrosInvalidosError } from '@fuelhub/shared-kernel';
import type { ComprobantePdfInput } from '../../domain/ComprobantePdfInput';

export interface ApiGatewayEventLike {
  readonly body?: string | null;
  readonly isBase64Encoded?: boolean;
  readonly pathParameters?: Record<string, string | undefined> | null;
  readonly requestContext?: { authorizer?: { claims?: Record<string, string> } };
}

export function extraerNumeracion(event: ApiGatewayEventLike): string | undefined {
  return event.pathParameters?.numeracion ?? undefined;
}

export function parsearComprobantePdfInput(event: ApiGatewayEventLike): ComprobantePdfInput {
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

  return json as ComprobantePdfInput;
}
