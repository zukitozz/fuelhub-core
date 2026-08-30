// packages/shared-kernel/src/apiGatewayEvent.ts
//
// Normalización del evento crudo de API Gateway ANTES de que Powertools
// Idempotency (`makeIdempotent`, sección 2.3) lo procese en
// `ingest-cierre-turno`/`ingest-cierre-dia` — bug real encontrado en pruebas
// manuales con Jorge (curl vs. Postman contra `dev`, 30/8/2026), no una
// hipótesis de laboratorio.
//
// Qué pasaba: `IdempotencyConfig.eventKeyJmesPath` está configurado como
// `headers."Idempotency-Key"` (JMESPath, búsqueda de propiedad case-sensitive)
// en ambos handlers. Un curl con soporte HTTP/2 (el caso real que disparó
// esto) manda el nombre del header en minúsculas — `idempotency-key` — porque
// el protocolo HTTP/2 lo EXIGE así (RFC 9113, sección 8.2.1): no es un error
// del cliente, es el estándar. Como los nombres de header HTTP son
// case-insensitive por spec (RFC 7230, sección 3.2), el backend nunca debería
// depender de una capitalización exacta para leerlos — pero acá sí ocurría,
// indirectamente, porque JMESPath compara la clave del objeto JS tal cual.
//
// Consecuencia real: `getHashedIdempotencyKey` (Powertools) no encontraba el
// header, y como `throwOnNoIdempotencyKey: true` (correcto — el contrato
// exige este header, sección 11.2), tiraba `IdempotencyKeyError` — que
// `IdempotencyHandler` de Powertools reempaqueta, sin distinguirlo de un
// fallo real de DynamoDB, como `IdempotencyPersistenceLayerError` (mismo
// mensaje genérico en los dos casos — lo que hizo el diagnóstico largo).
// Postman no lo mostraba porque por defecto negocia HTTP/1.1, donde si
// preserva la capitalización que se escribe a mano.
//
// Por qué no alcanza con cambiar el JMESPath: no soporta case-insensitive
// nativamente, y Powertools evalúa `eventKeyJmesPath` internamente, antes de
// que el código de la aplicación (`manejarRequest`) vea el evento — no hay
// forma de interceptarlo desde adentro. Hay que normalizar el evento ANTES
// de que llegue al handler que envuelve `makeIdempotent`.
//
// Ya existía un intento de resolver esto — `extraerIdempotencyKey` en
// `ingest-cierre-turno/infrastructure/http/ApiGatewayRequestMapper.ts` — pero
// quedó como código muerto: nunca se llamaba desde `handler.ts`, que en
// cambio delega la extracción por completo a Powertools. Se elimina ese
// duplicado a favor de este único lugar compartido (mismo criterio que
// `AuthContext.ts`/`http.ts`: una sola implementación para los 2 microservicios
// que la necesitan).

export interface ApiGatewayEventWithHeaders {
  readonly headers?: Record<string, string | undefined> | null;
}

/**
 * Devuelve una copia del evento con la clave `Idempotency-Key` de `headers`
 * garantizada en ESE casing exacto — el que espera el `eventKeyJmesPath` de
 * Powertools — tomando el valor de cualquier variante de capitalización que
 * haya llegado realmente (`idempotency-key`, `IDEMPOTENCY-KEY`, etc.).
 *
 * Deliberadamente acotado a este único header, no una normalización genérica
 * de todo `headers`: es el único que hoy se lee por nombre exacto en algún
 * lado del código (vía Powertools). `Authorization` lo procesa el Cognito
 * Authorizer nativo de API Gateway antes de que el Lambda lo vea (nunca se
 * lee de `headers` en el código de la aplicación, sección 5.1); `Content-Type`
 * no se inspecciona — el body siempre se trata como JSON (sección 11.1). Si
 * en el futuro se agrega otra lectura de header por nombre exacto, hay que
 * sumarla acá en vez de reinventar la normalización en otro lugar.
 *
 * No hace copia si el header ya viene con el casing esperado (caso común:
 * casi cualquier cliente HTTP/1.1) — evita el `{ ...event }` innecesario en
 * el camino feliz.
 */
export function withNormalizedIdempotencyKeyHeader<T extends ApiGatewayEventWithHeaders>(event: T): T {
  const headers = event.headers;
  if (!headers) return event;
  if (typeof headers['Idempotency-Key'] === 'string') return event;

  const variante = Object.keys(headers).find((clave) => clave.toLowerCase() === 'idempotency-key');
  if (!variante) return event; // no vino en ninguna variante — Powertools/`throwOnNoIdempotencyKey` se encarga de reportarlo con el error correcto

  return {
    ...event,
    headers: {
      ...headers,
      'Idempotency-Key': headers[variante],
    },
  };
}
