// infrastructure/http/ApiGatewayRequestMapper.ts
//
// Este Lambda resuelve 2 operaciones (GET /tanques, PUT /tanques/{id},
// sección 3.8.4) — el mapper extrae lo que cada una necesita del evento
// crudo de API Gateway.

import { ParametrosInvalidosError } from '@fuelhub/shared-kernel';
import type { TanqueUpdateInput } from '../../domain/TanqueUpdateInput';

export interface ApiGatewayEventLike {
  readonly httpMethod?: string;
  readonly queryStringParameters?: Record<string, string | undefined> | null;
  readonly pathParameters?: Record<string, string | undefined> | null;
  readonly body?: string | null;
  readonly isBase64Encoded?: boolean;
  readonly requestContext?: { authorizer?: { claims?: Record<string, string> } };
}

export function extraerEstacionCodigoQuery(event: ApiGatewayEventLike): string | undefined {
  return event.queryStringParameters?.estacionCodigo ?? undefined;
}

export function extraerId(event: ApiGatewayEventLike): string | undefined {
  return event.pathParameters?.id ?? undefined;
}

export function parsearTanqueUpdateInput(event: ApiGatewayEventLike): TanqueUpdateInput {
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

  return json as TanqueUpdateInput;
}
