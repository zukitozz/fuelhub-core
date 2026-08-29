// application/use-cases/ObtenerReporteAbastecimiento.ts
//
// Orquesta `GET /v1/reportes/abastecimiento` (sección 3.8.2.c) — mismo
// criterio de autorización que `ObtenerReporteMargen`. Sin rango de fechas:
// la ventana de 30 días para `ventaPromedioDiaria` está fija en el SQL
// (sección 3.8.2.c), no es un parámetro del contrato (sección 11.2).

import {
  AccesoDenegadoEstacionError,
  estacionesPermitidasDelToken,
  estacionUnicaDelToken,
  hasAccessToStation,
  type AuthContext,
} from '@fuelhub/shared-kernel';
import type { ReporteAbastecimientoItemDTO, ReporteAbastecimientoQueryRepository } from '../ports/ReporteAbastecimientoQueryRepository';

export interface ObtenerReporteAbastecimientoQuery {
  readonly estacionCodigo?: string;
}

export class ObtenerReporteAbastecimiento {
  constructor(private readonly repo: ReporteAbastecimientoQueryRepository) {}

  async ejecutar(auth: AuthContext, query: ObtenerReporteAbastecimientoQuery): Promise<ReporteAbastecimientoItemDTO[]> {
    const estacionCodigo = query.estacionCodigo ?? estacionUnicaDelToken(auth);

    if (estacionCodigo !== undefined && !hasAccessToStation(auth, estacionCodigo)) {
      throw new AccesoDenegadoEstacionError(estacionCodigo);
    }

    const estacionesCodigos = estacionCodigo === undefined ? soloListaOUndefined(estacionesPermitidasDelToken(auth)) : undefined;

    return this.repo.obtener({ estacionCodigo, estacionesCodigos });
  }
}

function soloListaOUndefined(permitidas: readonly string[] | '*'): readonly string[] | undefined {
  return permitidas === '*' ? undefined : permitidas;
}
