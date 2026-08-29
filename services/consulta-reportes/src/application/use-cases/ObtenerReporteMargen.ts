// application/use-cases/ObtenerReporteMargen.ts
//
// Orquesta `GET /v1/reportes/margen` (sección 3.8.2.b): resuelve
// autorización por estación (5.4) ANTES de tocar el repositorio, igual que
// el resto de casos de uso de consulta (ver `ListarCierresTurno`).

import {
  AccesoDenegadoEstacionError,
  estacionesPermitidasDelToken,
  estacionUnicaDelToken,
  hasAccessToStation,
  type AuthContext,
} from '@fuelhub/shared-kernel';
import { normalizarRangoFechas } from '../../domain/value-objects/RangoFechas';
import type { ReporteMargenItemDTO, ReporteMargenQueryRepository } from '../ports/ReporteMargenQueryRepository';

export interface ObtenerReporteMargenQuery {
  readonly estacionCodigo?: string;
  readonly fechaDesde?: string;
  readonly fechaHasta?: string;
}

export class ObtenerReporteMargen {
  constructor(private readonly repo: ReporteMargenQueryRepository) {}

  async ejecutar(auth: AuthContext, query: ObtenerReporteMargenQuery): Promise<ReporteMargenItemDTO[]> {
    // Igual que en consulta-cierres: si no se pide una estación puntual y el
    // token es de una sola estación, se usa esa por defecto.
    const estacionCodigo = query.estacionCodigo ?? estacionUnicaDelToken(auth);

    if (estacionCodigo !== undefined && !hasAccessToStation(auth, estacionCodigo)) {
      throw new AccesoDenegadoEstacionError(estacionCodigo);
    }

    // Solo se calcula la restricción multi-estación cuando NO hay una
    // estación puntual ya resuelta arriba (ese caso ya queda acotado por
    // `hasAccessToStation`) — evita filtrar dos veces por lo mismo.
    const estacionesCodigos = estacionCodigo === undefined ? soloListaOUndefined(estacionesPermitidasDelToken(auth)) : undefined;

    const { fechaDesde, fechaHasta } = normalizarRangoFechas(query.fechaDesde, query.fechaHasta);

    return this.repo.obtener({ estacionCodigo, estacionesCodigos, fechaDesde, fechaHasta });
  }
}

function soloListaOUndefined(permitidas: readonly string[] | '*'): readonly string[] | undefined {
  return permitidas === '*' ? undefined : permitidas;
}
