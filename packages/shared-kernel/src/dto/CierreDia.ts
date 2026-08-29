// packages/shared-kernel/src/dto/CierreDia.ts
//
// Espejo de `components.schemas.CierreDiaResumen` del contrato OpenAPI —
// compartido entre `ingest-cierre-dia` (que lo devuelve en el 201/200) y
// `consulta-cierres` (que lo devuelve en el listado `GET /cierres-dia`).
// Mismo motivo que `dto/CierreTurno.ts` (v1.34): una sola definición fuente
// para que ambos servicios no se desalineen entre sí.

import type { EstadoCierre, Empleado } from './CierreTurno';

export interface CierreDiaResumenDTO {
  readonly id: string;
  readonly codigoEstacion: string;
  readonly isla: string | null;
  readonly fechaNegocio: string;
  readonly fecha: string;
  readonly total: number;
  readonly estado: EstadoCierre;
  readonly administrador: Empleado;
  readonly recibidoEn: string;
}
