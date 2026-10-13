// infrastructure/http/ApiGatewayRequestMapper.ts
//
// Mismo parseo de body que el resto de los Lambdas de ingesta (ver
// ApiGatewayRequestMapper.ts de ingest-cierre-turno) -- sin path params,
// este endpoint es POST /reportes/top-facturas (sin id en la URL).

import { ParametrosInvalidosError } from '@fuelhub/shared-kernel';
import type { ReporteTopFacturasInput } from '../../domain/ReporteTopFacturasInput';

export interface ApiGatewayEventLike {
  readonly body?: string | null;
  readonly isBase64Encoded?: boolean;
  readonly headers?: Record<string, string | undefined>;
  readonly requestContext?: { authorizer?: { claims?: Record<string, string> } };
}

export function parsearReporteTopFacturasInput(event: ApiGatewayEventLike): ReporteTopFacturasInput {
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

  return json as ReporteTopFacturasInput;
}
