// application/ports/CierreTurnoIngestaRepository.ts
//
// Puerto de salida de `ingest-cierre-turno`. A diferencia de los puertos de
// consulta-cierres (que son de solo lectura), acá el adaptador concreto
// también resuelve estado que depende de la base de datos — `codigoEstacion`
// → `estacion_id`, validez de cada `productoId` contra el catálogo activo, y
// el auto-provisioning/verificación del `empleado` (sección 3.7) — antes de
// insertar. Es una desviación deliberada de "el repositorio nunca decide"
// (regla general del resto de este proyecto): esas tres resoluciones tienen
// que ocurrir DENTRO de la misma transacción que el INSERT para ser atómicas
// (evitar condiciones de carrera entre "verificar" e "insertar" — ver el
// comentario en el adaptador Postgres). El caso de uso conserva la única
// decisión que nunca puede delegarse a infraestructura: la autorización por
// `custom:station_scope` del token contra `codigoEstacion` (sección 5.4),
// que ocurre ANTES de llamar a este puerto.

import type { CierreTurnoInput } from '../../domain/CierreTurnoInput';
import type { CierreTurnoDetalleDTO } from '@fuelhub/shared-kernel';

export interface DatosCierreTurnoAInsertar extends CierreTurnoInput {
  /** client_id de Cognito que hizo el request — se graba como `cliente_origen` (sección 3.10). */
  readonly clienteOrigen: string;
}

export interface CierreTurnoIngestaRepository {
  /**
   * Resuelve estación/productos/empleado y hace el INSERT de
   * `cierres_turno` + `cierres_turno_pagos` + `cierres_turno_detalle` en una
   * sola transacción. Lanza `ParametrosInvalidosError` (con `details` por
   * campo, misma forma que `components.schemas.Error` del contrato OpenAPI)
   * si `codigoEstacion` no existe, si algún `productoId` no está en el
   * catálogo activo, o si `empleado.codigo` ya pertenece a otra estación.
   */
  registrar(datos: DatosCierreTurnoAInsertar): Promise<CierreTurnoDetalleDTO>;
}
