// http.test.ts — `npm run test:unit` (sección 7/12.6, v1.50).
//
// `downgradeReplayStatusTo200` ya se había probado a mano en sandbox al
// resolverse v1.48 (compilado con esbuild + instanciando el
// IdempotencyHandler interno de Powertools) — esto la deja como prueba real
// y repetible en el repo, para que una regresión futura la rompa en CI, no
// en producción. `mapErrorToResponse` no se había probado todavía.

import { DatabaseResumingException } from '@aws-sdk/client-rds-data';
import { AccesoDenegadoEstacionError, ParametrosInvalidosError, RecursoNoEncontradoError } from './errors';
import { downgradeReplayStatusTo200, mapErrorToResponse } from './http';

describe('downgradeReplayStatusTo200', () => {
  it('baja un 201 cacheado a 200 sin mutar el objeto original (sección 11.2)', () => {
    const original = { statusCode: 201, headers: { 'Content-Type': 'application/json' }, body: '{"id":"abc"}' };
    const resultado = downgradeReplayStatusTo200(original, {} as never);
    expect(resultado).toEqual({ ...original, statusCode: 200 });
    expect(original.statusCode).toBe(201); // no debe mutar la respuesta cacheada original
  });

  it('no toca una respuesta con otro statusCode', () => {
    const original = { statusCode: 400, body: '{"error":"x"}' };
    expect(downgradeReplayStatusTo200(original, {} as never)).toBe(original);
  });

  it('no rompe con valores no-objeto (null, string, número)', () => {
    expect(downgradeReplayStatusTo200(null, {} as never)).toBeNull();
    expect(downgradeReplayStatusTo200('texto', {} as never)).toBe('texto');
    expect(downgradeReplayStatusTo200(42, {} as never)).toBe(42);
  });

  it('no rompe con un array (no tiene statusCode como propiedad de objeto plano)', () => {
    const arr = [1, 2, 3];
    expect(downgradeReplayStatusTo200(arr, {} as never)).toBe(arr);
  });
});

describe('mapErrorToResponse', () => {
  it('mapea ParametrosInvalidosError a 400 con los details por campo (sección 11.1)', () => {
    const err = new ParametrosInvalidosError('inválido', [{ field: 'turno', issue: 'requerido' }]);
    const res = mapErrorToResponse(err);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: 'PARAMETROS_INVALIDOS',
      message: 'inválido',
      details: [{ field: 'turno', issue: 'requerido' }],
    });
  });

  it('mapea AccesoDenegadoEstacionError a 403 (sección 5.4)', () => {
    const res = mapErrorToResponse(new AccesoDenegadoEstacionError('MALA'));
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toBe('ACCESO_DENEGADO_ESTACION');
  });

  it('mapea RecursoNoEncontradoError a 404', () => {
    const res = mapErrorToResponse(new RecursoNoEncontradoError('cierre_turno', 'xyz'));
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error).toBe('RECURSO_NO_ENCONTRADO');
  });

  it('cae en 500 genérico para cualquier otro error, sin filtrar el mensaje interno', () => {
    const res = mapErrorToResponse(new Error('detalle interno sensible de Postgres'));
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('ERROR_INTERNO');
    expect(body.message).not.toContain('sensible de Postgres');
  });

  it('mapea DatabaseResumingException a 503 con Retry-After, NO al 500 genérico (v1.62)', () => {
    const err = new DatabaseResumingException({ message: 'resuming', $metadata: {} });
    const res = mapErrorToResponse(err);
    expect(res.statusCode).toBe(503);
    expect(res.headers['Retry-After']).toBe('5');
    expect(JSON.parse(res.body).error).toBe('BASE_DE_DATOS_REANUDANDO');
  });
});
