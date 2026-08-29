// application/use-cases/ListarCierresDia.ts — mismo patrón que ListarCierresTurno.

import { AuthContext, estacionUnicaDelToken, hasAccessToStation } from '@fuelhub/shared-kernel';
import { AccesoDenegadoEstacionError, ParametrosInvalidosError } from '@fuelhub/shared-kernel';
import { normalizarPaginacion, construirPaginacion, type ResultadoPaginado } from '../../domain/value-objects/Paginacion';
import type { CierreDiaQueryRepository, CierreDiaResumenDTO } from '../ports/CierreDiaQueryRepository';
import type { EstadoCierre } from '../ports/CierreTurnoQueryRepository';

export interface ListarCierresDiaQuery {
  readonly estacionCodigo?: string;
  readonly fechaDesde?: string;
  readonly fechaHasta?: string;
  readonly estado?: string;
  readonly page?: string;
  readonly pageSize?: string;
}

export class ListarCierresDia {
  constructor(private readonly repo: CierreDiaQueryRepository) {}

  async ejecutar(auth: AuthContext, query: ListarCierresDiaQuery): Promise<ResultadoPaginado<CierreDiaResumenDTO>> {
    const estacionCodigo = query.estacionCodigo ?? estacionUnicaDelToken(auth);

    if (estacionCodigo !== undefined && !hasAccessToStation(auth, estacionCodigo)) {
      throw new AccesoDenegadoEstacionError(estacionCodigo);
    }

    const estado = validarEstado(query.estado);
    const paginacion = normalizarPaginacion(query.page, query.pageSize);

    const resultado = await this.repo.listar(
      { estacionCodigo, fechaDesde: query.fechaDesde, fechaHasta: query.fechaHasta, estado },
      paginacion
    );

    return {
      data: resultado.data,
      pagination: construirPaginacion(paginacion, resultado.pagination.totalItems),
    };
  }
}

function validarEstado(valor?: string): EstadoCierre {
  if (valor === undefined) return 'ACTIVO';
  if (valor !== 'ACTIVO' && valor !== 'ANULADO') {
    throw new ParametrosInvalidosError('Parámetro "estado" inválido.', [
      { field: 'estado', issue: 'debe ser ACTIVO o ANULADO' },
    ]);
  }
  return valor;
}
