// packages/shared-kernel/src/http.ts
//
// Helpers de respuesta HTTP, compartidos entre microservicios, y el mapeo
// de errores de dominio/aplicación a la forma de error uniforme del
// contrato OpenAPI (sección 11.1) — un solo lugar que conoce esta forma,
// para que cada `handler.ts` no la reimplemente.

import { DatabaseResumingException } from '@aws-sdk/client-rds-data';
import type { ResponseHook } from '@aws-lambda-powertools/idempotency/types';
import { AccesoDenegadoEstacionError, ParametrosInvalidosError, RecursoNoEncontradoError } from './errors';

export interface ApiResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export function jsonResponse(statusCode: number, body: unknown): ApiResponse {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export function errorBody(error: string, message: string, details?: unknown) {
  return details === undefined ? { error, message } : { error, message, details };
}

/**
 * Traduce un error de dominio/aplicación conocido a la respuesta HTTP que
 * define el contrato OpenAPI (sección 11.1) — errores no reconocidos caen en
 * un 500 genérico, sin filtrar detalles internos al cliente.
 */
export function mapErrorToResponse(err: unknown): ApiResponse {
  if (err instanceof ParametrosInvalidosError) {
    return jsonResponse(400, errorBody('PARAMETROS_INVALIDOS', err.message, err.details));
  }
  if (err instanceof AccesoDenegadoEstacionError) {
    return jsonResponse(403, errorBody('ACCESO_DENEGADO_ESTACION', err.message));
  }
  if (err instanceof RecursoNoEncontradoError) {
    return jsonResponse(404, errorBody('RECURSO_NO_ENCONTRADO', err.message));
  }
  if (err instanceof DatabaseResumingException) {
    // v1.62 -- llega hasta acá solo cuando ya se agotaron los reintentos
    // internos (`conReintentoSiDbEstaResumiendo`, `rds-retry.ts`, ~7s de
    // backoff): la base tardó más que ese presupuesto corto en reanudarse
    // desde 0 ACU (Aurora Serverless v2 scale-to-zero, sección 2.5/10.2).
    // Se devuelve 503 (no el 500 genérico de más abajo) + `Retry-After`
    // para que el consumidor externo (que ya reintenta con su propio
    // backoff, ~90s -- ver changelog v1.62) sepa que esto SÍ vale la pena
    // reintentar, en vez de tratarlo como un error permanente/de payload.
    const respuesta = jsonResponse(
      503,
      errorBody('BASE_DE_DATOS_REANUDANDO', 'La base de datos se está reanudando tras un período de inactividad. Reintentar en unos segundos.')
    );
    return { ...respuesta, headers: { ...respuesta.headers, 'Retry-After': '5' } };
  }
  console.error('Error no controlado:', err);
  return jsonResponse(500, errorBody('ERROR_INTERNO', 'Ocurrió un error inesperado. Ver logs de CloudWatch para más detalle.'));
}

/**
 * `responseHook` de AWS Lambda Powertools Idempotency (sección 2.3/11.2),
 * compartido entre `ingest-cierre-turno` e `ingest-cierre-dia` — los dos
 * Lambdas de escritura que sí son idempotentes por `Idempotency-Key`
 * (`ingest-compra` no lo es, ver su `handler.ts`).
 *
 * Confirmado leyendo la fuente real instalada de `@aws-lambda-powertools/idempotency`
 * (`IdempotencyHandler.determineResultFromIdempotencyRecord`, no solo la
 * documentación): este hook **solo se invoca cuando ya existe un registro de
 * idempotencia** — es decir, en un reintento — nunca en la primera ejecución
 * exitosa (esa pasa por `getFunctionResult`, que no lo llama). Eso es
 * justo lo que hace falta para diferenciar el `201` de la inserción nueva del
 * `200` que el contrato exige en el reintento (11.2), sin tocar el caso de
 * uso ni volver a golpear Postgres: la respuesta cacheada es la misma en
 * ambos casos, solo se le baja el `statusCode`.
 */
export const downgradeReplayStatusTo200: ResponseHook = (response) => {
  if (
    typeof response === 'object' &&
    response !== null &&
    !Array.isArray(response) &&
    response.statusCode === 201
  ) {
    return { ...response, statusCode: 200 };
  }
  return response;
};
