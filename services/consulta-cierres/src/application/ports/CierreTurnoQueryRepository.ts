// application/ports/CierreTurnoQueryRepository.ts
//
// Puerto de salida (interfaz) — el caso de uso depende solo de esto, nunca
// de una implementación concreta (sección 4, regla 2).
//
// `Turno`/`EstadoCierre`/`CierreTurnoResumenDTO` viven en @fuelhub/shared-kernel
// (v1.34) — se re-exportan acá tal cual para no romper los imports existentes
// de este servicio (`ListarCierresTurno.ts`, `ListarCierresDia.ts`, el
// adaptador Postgres), pero la definición fuente ya es una sola, compartida
// con ingest-cierre-turno y consulta-cierre-detalle.

import type { ParametrosPaginacion, ResultadoPaginado } from '../../domain/value-objects/Paginacion';
import type { CierreTurnoResumenDTO, EstadoCierre, Turno } from '@fuelhub/shared-kernel';

export type { Turno, EstadoCierre, CierreTurnoResumenDTO };

export interface FiltrosCierreTurno {
  /** Código de estación ya autorizado por el caso de uso (sección 5.4) — el adaptador resuelve el JOIN contra `estaciones` internamente. */
  readonly estacionCodigo?: string;
  readonly fechaDesde?: string; // YYYY-MM-DD, sección 11 (fechaDesde)
  readonly fechaHasta?: string;
  readonly turno?: Turno;
  /** Filtra por `empleado.codigo` — habilita "quiénes trabajaron el día X" (sección 3.4). */
  readonly usuarioCodigo?: string;
  readonly estado: EstadoCierre;
}

export interface CierreTurnoQueryRepository {
  listar(
    filtros: FiltrosCierreTurno,
    paginacion: ParametrosPaginacion
  ): Promise<ResultadoPaginado<CierreTurnoResumenDTO>>;
}
