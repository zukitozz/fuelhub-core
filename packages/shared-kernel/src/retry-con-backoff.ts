// packages/shared-kernel/src/retry-con-backoff.ts
//
// v1.87 -- reintento genérico con backoff creciente, para operaciones que no
// tienen un tipo de excepción puntual al que agarrarse (a diferencia de
// `rds-retry.ts`, que SOLO reintenta `DatabaseResumingException` -- un fallo
// transitorio bien identificado de Aurora). Acá se retiene CUALQUIER error:
// pensado para I/O de red genérica (EventBridge, HTTP saliente) donde los
// fallos transitorios (throttling, blips de red) no vienen con un tipo
// propio y distinguible -- primer uso real: `EventBridgeReporteComprasSemanalPublisher.ts`,
// publicando `ReporteComprasSemanalRegistrado` sin que haya un cliente HTTP
// esperando la respuesta (a diferencia de CierreDiaRegistrado/CierreTurnoRegistrado,
// que se publican en medio de un POST real -- ahí reintentar alargaría esa
// respuesta, por eso siguen siendo best-effort de un solo intento).
//
// Parametrizado (a diferencia de `conReintentoSiDbEstaResumiendo`, que tiene
// su presupuesto fijo de 14s hardcodeado) porque acá no hay un único caso de
// uso con un presupuesto de tiempo ya acordado -- cada llamador decide
// cuántos intentos y cuánto esperar entre ellos según qué tan urgente sea su
// propio contexto (sección completa de un cron vs. un request HTTP real).

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface OpcionesReintentoConBackoff {
  /** Cuántas veces se llama a `llamada` en total (1 intento inicial + el resto reintentos). */
  readonly intentosMax: number;
  /** Espera entre cada intento fallido y el siguiente, en milisegundos -- un valor por posición; el último se repite si `intentosMax` pide más reintentos de los que esta lista tiene. */
  readonly esperasMs: readonly number[];
  /** Se llama con el error y el número de intento (1-based) antes de esperar y reintentar -- para loguear sin acoplar este módulo a `console`. */
  readonly antesDeReintentar?: (err: unknown, intento: number) => void;
}

/**
 * Ejecuta `llamada` y, si falla, reintenta hasta `opciones.intentosMax`
 * veces en total, con el backoff de `opciones.esperasMs` entre intentos.
 * Reintenta ante CUALQUIER error (sin filtrar por tipo) -- si el llamador
 * necesita reintentar solo un error puntual, debe filtrarlo él mismo
 * relanzando los demás desde dentro de `llamada`.
 */
export async function conReintentoConBackoff<T>(llamada: () => Promise<T>, opciones: OpcionesReintentoConBackoff): Promise<T> {
  const ultimaEspera = opciones.esperasMs[opciones.esperasMs.length - 1] ?? 0;
  let intento = 0;
  for (;;) {
    try {
      return await llamada();
    } catch (err) {
      if (intento >= opciones.intentosMax - 1) throw err;
      opciones.antesDeReintentar?.(err, intento + 1);
      const espera = opciones.esperasMs[intento] ?? ultimaEspera;
      await esperar(espera);
      intento++;
    }
  }
}
