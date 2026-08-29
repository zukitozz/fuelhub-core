// application/ports/CierreDiaIngestaRepository.ts
//
// Mismo criterio que `ingest-cierre-turno/application/ports/CierreTurnoIngestaRepository.ts`:
// el adaptador resuelve `codigoEstacion`→`estacion_id` y auto-provisiona/
// verifica al `administrador` (rol `ADMINISTRADOR`, sección 3.7.1 — distinto
// del `OPERADOR` de cada turno) dentro de la MISMA transacción que el
// `INSERT`, por la misma razón (atomicidad, evitar TOCTOU entre verificar e
// insertar). El caso de uso conserva la autorización por estación (5.4), que
// ocurre antes de llamar a este puerto.

import type { CierreDiaInput } from '../../domain/CierreDiaInput';
import type { CierreDiaResumenDTO } from '@fuelhub/shared-kernel';

export interface DatosCierreDiaAInsertar extends CierreDiaInput {
  readonly clienteOrigen: string;
}

export interface CierreDiaIngestaRepository {
  /**
   * Lanza `ParametrosInvalidosError` si `codigoEstacion` no existe o si
   * `administrador.codigo` ya pertenece a otra estación (mismo criterio que
   * `empleado.codigo` en ingest-cierre-turno, sección 9.7).
   *
   * Devuelve también `estacionId` (el UUID interno, no solo `codigoEstacion`)
   * porque el evento `CierreDiaRegistrado` (sección 4.1) lo necesita en su
   * `detail` y el caso de uso no tiene otra forma de obtenerlo sin una
   * segunda consulta — el DTO de la respuesta HTTP nunca expone UUIDs
   * internos de `estaciones`, solo el `codigoEstacion` público.
   */
  registrar(datos: DatosCierreDiaAInsertar): Promise<{ dto: CierreDiaResumenDTO; estacionId: string }>;
}
