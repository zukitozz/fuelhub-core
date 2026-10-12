// retry-con-backoff.test.ts (v1.87)

import { conReintentoConBackoff } from './retry-con-backoff';

describe('conReintentoConBackoff', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('no reintenta si el primer intento sale bien', async () => {
    const llamada = jest.fn().mockResolvedValue('ok');

    const resultado = await conReintentoConBackoff(llamada, { intentosMax: 3, esperasMs: [500, 1500] });

    expect(resultado).toBe('ok');
    expect(llamada).toHaveBeenCalledTimes(1);
  });

  it('reintenta y devuelve el resultado si un intento posterior sale bien', async () => {
    const llamada = jest.fn().mockRejectedValueOnce(new Error('falla transitoria')).mockResolvedValueOnce('ok');

    const promesa = conReintentoConBackoff(llamada, { intentosMax: 3, esperasMs: [500, 1500] });
    await jest.advanceTimersByTimeAsync(500);
    const resultado = await promesa;

    expect(resultado).toBe('ok');
    expect(llamada).toHaveBeenCalledTimes(2);
  });

  it('usa el último valor de esperasMs si hay más reintentos que entradas en la lista', async () => {
    const llamada = jest
      .fn()
      .mockRejectedValueOnce(new Error('1'))
      .mockRejectedValueOnce(new Error('2'))
      .mockResolvedValueOnce('ok');

    const promesa = conReintentoConBackoff(llamada, { intentosMax: 3, esperasMs: [100] });
    await jest.advanceTimersByTimeAsync(100); // 1er reintento
    await jest.advanceTimersByTimeAsync(100); // 2do reintento -- repite el último valor (100), no undefined
    const resultado = await promesa;

    expect(resultado).toBe('ok');
    expect(llamada).toHaveBeenCalledTimes(3);
  });

  it('se rinde tras intentosMax intentos y propaga el último error', async () => {
    const llamada = jest.fn().mockRejectedValue(new Error('siempre falla'));

    const promesa = conReintentoConBackoff(llamada, { intentosMax: 3, esperasMs: [10, 10] });
    const expectativa = expect(promesa).rejects.toThrow('siempre falla');
    await jest.advanceTimersByTimeAsync(10);
    await jest.advanceTimersByTimeAsync(10);
    await expectativa;

    expect(llamada).toHaveBeenCalledTimes(3);
  });

  it('llama a antesDeReintentar con el error y el número de intento antes de cada reintento', async () => {
    const llamada = jest.fn().mockRejectedValueOnce(new Error('falla')).mockResolvedValueOnce('ok');
    const antesDeReintentar = jest.fn();

    const promesa = conReintentoConBackoff(llamada, { intentosMax: 3, esperasMs: [10], antesDeReintentar });
    await jest.advanceTimersByTimeAsync(10);
    await promesa;

    expect(antesDeReintentar).toHaveBeenCalledTimes(1);
    expect(antesDeReintentar).toHaveBeenCalledWith(expect.any(Error), 1);
  });

  it('intentosMax=1 nunca reintenta', async () => {
    const llamada = jest.fn().mockRejectedValue(new Error('falla'));

    await expect(conReintentoConBackoff(llamada, { intentosMax: 1, esperasMs: [500] })).rejects.toThrow('falla');

    expect(llamada).toHaveBeenCalledTimes(1);
  });
});
