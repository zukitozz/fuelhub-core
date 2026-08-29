// infrastructure/http/ApiGatewayRequestMapper.ts
//
// Idéntico en espíritu a `ingest-cierre-turno/infrastructure/http/ApiGatewayRequestMapper.ts`
// — solo cambia el tipo de salida. El JSON ya es camelCase (sección 11.1), no
// hay mapeo de nombres acá.

import { ParametrosInvalidosError } from '@fuelhub/shared-kernel';
import type { CierreDiaInput } from '../../domain/CierreDiaInput';

export interface ApiGatewayEventLike {
  readonly body?: string | null;
  readonly isBase64Encoded?: boolean;
  readonly headers?: Record<string, string | undefined>;
  readonly requestContext?: { authorizer?: { claims?: Record<string, string> } };
}

export function parsearCierreDiaInput(event: ApiGatewayEventLike): CierreDiaInput {
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

  return json as CierreDiaInput;
}
