// rds-retry.test.ts (v1.62) -- usa fake timers para no pagar los ~14s
// reales de backoff en cada corrida de `jest`.

import { DatabaseResumingException } from '@aws-sdk/client-rds-data';
import { conReintentoSiDbEstaResumiendo } from './rds-retry';

function resumingError(): DatabaseResumingException {
  return new DatabaseResumingException({ message: 'resuming', $metadata: {} });
}

describe('conReintentoSiDbEstaResumiendo', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('devuelve el resultado directo si la primera llamada no falla (no espera nada)', async () => {
    const llamada = jest.fn().mockResolvedValue('ok');
    await expect(conReintentoSiDbEstaResumiendo(llamada)).resolves.toBe('ok');
    expect(llamada).toHaveBeenCalledTimes(1);
  });

  it('reintenta con backoff creciente y devuelve el resultado si un intento posterior sí funciona', async () => {
    const llamada = jest
      .fn()
      .mockRejectedValueOnce(resumingError())
      .mockRejectedValueOnce(resumingError())
      .mockResolvedValueOnce('ok-al-tercer-intento');

    const promesa = conReintentoSiDbEstaResumiendo(llamada);
    // Deja correr los timers pendientes (2s, luego 4s) hasta que la promesa resuelva.
    await jest.runAllTimersAsync();

    await expect(promesa).resolves.toBe('ok-al-tercer-intento');
    expect(llamada).toHaveBeenCalledTimes(3);
  });

  it('propaga DatabaseResumingException si se agotan los 3 reintentos (4 intentos en total)', async () => {
    const llamada = jest.fn().mockRejectedValue(resumingError());

    const promesa = conReintentoSiDbEstaResumiendo(llamada);
    promesa.catch(() => {
      // evita un "unhandled rejection" mientras corren los fake timers de abajo.
    });
    await jest.runAllTimersAsync();

    await expect(promesa).rejects.toBeInstanceOf(DatabaseResumingException);
    expect(llamada).toHaveBeenCalledTimes(4); // intento inicial + 3 reintentos
  });

  it('NO reintenta ningún otro tipo de error -- lo propaga de inmediato', async () => {
    const otroError = new Error('esto no es un problema de la base resumiendo');
    const llamada = jest.fn().mockRejectedValue(otroError);

    await expect(conReintentoSiDbEstaResumiendo(llamada)).rejects.toBe(otroError);
    expect(llamada).toHaveBeenCalledTimes(1);
  });
});
