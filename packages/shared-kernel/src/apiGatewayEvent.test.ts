// apiGatewayEvent.test.ts — `npm run test:unit` (sección 7/12.6).
//
// Cubre el bug real de casing HTTP/2 (ver comentario de cabecera en
// `apiGatewayEvent.ts`): un cliente que manda `idempotency-key` en vez de
// `Idempotency-Key` no debe romper la extracción de Powertools.

import { withNormalizedIdempotencyKeyHeader } from './apiGatewayEvent';

describe('withNormalizedIdempotencyKeyHeader', () => {
  it('agrega "Idempotency-Key" con el valor de "idempotency-key" (caso real: curl vía HTTP/2)', () => {
    const event: { headers: Record<string, string | undefined> } = {
      headers: { 'idempotency-key': 'abc-123', 'content-type': 'application/json' },
    };
    const resultado = withNormalizedIdempotencyKeyHeader(event);
    expect(resultado.headers['Idempotency-Key']).toBe('abc-123');
    expect(resultado.headers['idempotency-key']).toBe('abc-123'); // no borra la variante original, solo agrega la esperada
    expect(resultado.headers['content-type']).toBe('application/json'); // el resto de headers queda intacto
  });

  it('reconoce cualquier variante de capitalización, no solo todo minúsculas', () => {
    const event: { headers: Record<string, string | undefined> } = { headers: { 'IDEMPOTENCY-KEY': 'xyz-789' } };
    expect(withNormalizedIdempotencyKeyHeader(event).headers['Idempotency-Key']).toBe('xyz-789');
  });

  it('no crea una copia si el header ya viene con el casing esperado', () => {
    const event = { headers: { 'Idempotency-Key': 'ya-correcto' } };
    expect(withNormalizedIdempotencyKeyHeader(event)).toBe(event);
  });

  it('no toca el evento si "headers" no existe (deja que Powertools reporte el error correcto)', () => {
    const event = {};
    expect(withNormalizedIdempotencyKeyHeader(event)).toBe(event);
  });

  it('no toca el evento si "headers" existe pero no trae ninguna variante del header', () => {
    const event = { headers: { 'content-type': 'application/json' } };
    expect(withNormalizedIdempotencyKeyHeader(event)).toBe(event);
  });

  it('no muta el objeto "headers" original', () => {
    const headersOriginal = { 'idempotency-key': 'abc-123' };
    const event = { headers: headersOriginal };
    withNormalizedIdempotencyKeyHeader(event);
    expect(headersOriginal).toEqual({ 'idempotency-key': 'abc-123' }); // sin la clave nueva
  });
});
