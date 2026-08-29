// infrastructure/http/ApiGatewayRequestMapper.ts
//
// Parsea el body de `POST /cierres-turno` (evento crudo de API Gateway) a la
// forma de dominio. La forma del JSON ya es camelCase (sección 11.1) — no hay
// mapeo de nombres acá, solo `JSON.parse` + tipado; el mapeo real
// camelCase↔snake_case ocurre en el adaptador Postgres (infra), nunca en esta
// capa HTTP (sección 11.1: "nunca se expone el nombre de columna... en el
// contrato público" también implica que el HTTP mapper no debe conocerlos).

import { ParametrosInvalidosError } from '@fuelhub/shared-kernel';
import type { CierreTurnoInput } from '../../domain/CierreTurnoInput';

export interface ApiGatewayEventLike {
  readonly body?: string | null;
  readonly isBase64Encoded?: boolean;
  readonly headers?: Record<string, string | undefined>;
  readonly requestContext?: { authorizer?: { claims?: Record<string, string> } };
}

export function extraerIdempotencyKey(event: ApiGatewayEventLike): string | undefined {
  const headers = event.headers ?? {};
  // API Gateway normaliza nombres de header con distinta capitalización según
  // el caso — se busca sin sensibilidad a mayúsculas para no depender de eso.
  const clave = Object.keys(headers).find((h) => h.toLowerCase() === 'idempotency-key');
  return clave ? headers[clave] : undefined;
}

export function parsearCierreTurnoInput(event: ApiGatewayEventLike): CierreTurnoInput {
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

  // Se castea sin validar campo por campo acá — la validación estructural
  // real (tipos, enums, reglas de negocio) vive en `domain/CierreTurnoInput.ts`
  // (`validarCierreTurno`), llamada desde el caso de uso.
  return json as CierreTurnoInput;
}
