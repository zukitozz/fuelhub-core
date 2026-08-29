// application/ports/CierreDiaQueryRepository.ts
//
// `CierreDiaResumenDTO` vive en @fuelhub/shared-kernel (v1.34), compartido con
// ingest-cierre-dia — se re-exporta acá para no romper los imports existentes.

import type { ParametrosPaginacion, ResultadoPaginado } from '../../domain/value-objects/Paginacion';
import type { EstadoCierre } from './CierreTurnoQueryRepository';
import type { CierreDiaResumenDTO } from '@fuelhub/shared-kernel';

export type { CierreDiaResumenDTO };

export interface FiltrosCierreDia {
  readonly estacionCodigo?: string;
  readonly fechaDesde?: string;
  readonly fechaHasta?: string;
  readonly estado: EstadoCierre;
}

export interface CierreDiaQueryRepository {
  listar(
    filtros: FiltrosCierreDia,
    paginacion: ParametrosPaginacion
  ): Promise<ResultadoPaginado<CierreDiaResumenDTO>>;
}
