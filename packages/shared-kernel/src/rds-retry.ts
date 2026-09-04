// packages/shared-kernel/src/rds-retry.ts
//
// Reintento automático para el error transitorio más común de Aurora
// Serverless v2 en modo scale-to-zero (`serverlessV2MinCapacity: 0`,
// secciones 2.5/10.2 de la especificación, `data-stack.ts`):
// `DatabaseResumingException`, que RDS Data API tira cuando una request le
// pega a un cluster que está resumiendo desde 0 ACU. No es un bug de la
// aplicación ni de una consulta puntual -- es el costo esperado de ese
// ahorro de infraestructura (hallazgo real en producción, v1.62). AWS
// documenta que el resume típico toma ~15s (hasta 30s+ si el cluster estuvo
// pausado más de 24 horas) y recomienda explícitamente reintentar la
// conexión ante este error.
//
// Envuelve UNA llamada individual a RDS Data API (`ExecuteStatementCommand`,
// `BeginTransactionCommand`, `CommitTransactionCommand`, etc.) -- nunca una
// transacción completa de varios pasos. Eso es seguro incluso dentro de una
// transacción ya abierta: `DatabaseResumingException` es un fallo a nivel de
// conexión (`$fault: "client"`, confirmado contra el tipo real del SDK) --
// significa que la llamada nunca llegó a ejecutarse contra la base, así que
// repetir exactamente la misma llamada no puede duplicar ningún efecto (ni
// un INSERT a medias, ni un COMMIT contado dos veces).
//
// Presupuesto total de reintento acá adentro (solo el backoff entre
// intentos, sin contar la duración de cada intento en sí): ~14 segundos --
// pensado para cubrir el caso TÍPICO que documenta AWS (~15s de resume),
// dentro del timeout de 20s que ahora tienen estos Lambdas (`DEFAULT_TIMEOUT`
// en `authenticated-endpoint.ts`, subido de 10s a 20s en el mismo cambio).
// No intenta cubrir por sí solo el peor caso documentado (30s+ tras una
// pausa de más de 24 horas) -- ese caso lo cubre el reintento del lado del
// CONSUMIDOR externo (quien manda los cierres), que ya reintenta con su
// propio backoff durante ~90s (ver specs-cierres-grifo-backend.md,
// changelog v1.62). Cuando ni así alcanza, `mapErrorToResponse` (`http.ts`,
// mismo changelog) devuelve un `503` con `Retry-After` en vez del `500`
// genérico, para que ese reintento externo sepa que sí vale la pena
// insistir en vez de tratarlo como un error permanente.

import { DatabaseResumingException } from '@aws-sdk/client-rds-data';

const REINTENTOS_MAX = 3;
// Backoff creciente, no fijo -- evita que varias Lambdas concurrentes de un
// mismo pico de tráfico (varias estaciones cerrando turno casi al mismo
// tiempo) reintenten todas exactamente en el mismo instante. 2s + 4s + 8s =
// 14s de presupuesto total, ver nota de cabecera del archivo.
const ESPERAS_MS = [2000, 4000, 8000];
// Fallback tipado (no `number | undefined`) para el acceso indexado de
// arriba -- el array nunca está vacío, pero TS no lo sabe por sí solo.
const ULTIMA_ESPERA_MS = ESPERAS_MS[ESPERAS_MS.length - 1] as number;

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Ejecuta `llamada` y, si falla específicamente con `DatabaseResumingException`,
 * reintenta hasta `REINTENTOS_MAX` veces con backoff creciente. Cualquier
 * otro error (de negocio, de red, o cualquier otra excepción de RDS Data
 * API que no sea esta) se propaga de inmediato sin reintentar -- reintentar
 * un error que no es "la base se está despertando" solo demoraría la
 * respuesta de forma inútil, y podría enmascarar un problema real.
 */
export async function conReintentoSiDbEstaResumiendo<T>(llamada: () => Promise<T>): Promise<T> {
  let intento = 0;
  for (;;) {
    try {
      return await llamada();
    } catch (err) {
      if (!(err instanceof DatabaseResumingException) || intento >= REINTENTOS_MAX) {
        throw err;
      }
      const espera = ESPERAS_MS[intento] ?? ULTIMA_ESPERA_MS;
      console.warn(`RDS Data API: DatabaseResumingException, reintento ${intento + 1}/${REINTENTOS_MAX} en ${espera}ms.`);
      await esperar(espera);
      intento++;
    }
  }
}
