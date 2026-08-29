// application/ports/CierreTurnoDetalleRepository.ts
//
// Puerto de salida del Lambda `consulta-cierre-detalle` (sección 4.1) — a
// diferencia de consulta-cierres, acá se resuelve un único recurso por id,
// no una lista paginada.
//
// CORRECCIÓN v1.34: hasta la v1.33 este archivo definía su propia forma de
// `Pago`/`DetalleLinea` con nombres inventados (`metodoPago`, `manguera*`,
// `lectura*`) que no correspondían ni al DDL real (sección 3.3:
// `cierres_turno_pagos.medio_pago`, `cierres_turno_detalle.producto_codigo_local`/
// `total_cantidad`/etc.) ni al contrato OpenAPI (`Pago.medio`, `DetalleLinea`).
// Se corrige importando la forma canónica desde @fuelhub/shared-kernel.

import type { CierreTurnoDetalleDTO } from '@fuelhub/shared-kernel';

export type { CierreTurnoDetalleDTO };

export interface CierreTurnoDetalleRepository {
  /** Devuelve `undefined` si no existe — el caso de uso decide si eso es un 404. */
  obtenerPorId(id: string): Promise<CierreTurnoDetalleDTO | undefined>;
}
