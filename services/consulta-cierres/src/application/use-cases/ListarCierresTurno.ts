// application/use-cases/ListarCierresTurno.ts
//
// Orquesta el caso de uso (sección 4): resuelve la autorización por estación
// (5.4) ANTES de tocar el repositorio — el repositorio nunca decide quién
// puede ver qué, solo ejecuta la consulta ya autorizada.

import { AuthContext, estacionUnicaDelToken, hasAccessToStation } from '@fuelhub/shared-kernel';
import { AccesoDenegadoEstacionError, ParametrosInvalidosError } from '@fuelhub/shared-kernel';
import { normalizarPaginacion, construirPaginacion, type ResultadoPaginado } from '../../domain/value-objects/Paginacion';
import type {
  CierreTurnoQueryRepository,
  CierreTurnoResumenDTO,
  EstadoCierre,
  Turno,
} from '../ports/CierreTurnoQueryRepository';

const TURNOS_VALIDOS: readonly Turno[] = ['TURNO1', 'TURNO2', 'TURNO3'];

export interface ListarCierresTurnoQuery {
  readonly estacionCodigo?: string;
  readonly fechaDesde?: string;
  readonly fechaHasta?: string;
  readonly turno?: string;
  readonly usuarioCodigo?: string;
  readonly estado?: string;
  readonly page?: string;
  readonly pageSize?: string;
}

export class ListarCierresTurno {
  constructor(private readonly repo: CierreTurnoQueryRepository) {}

  async ejecutar(auth: AuthContext, query: ListarCierresTurnoQuery): Promise<ResultadoPaginado<CierreTurnoResumenDTO>> {
    // Si el cliente no manda `estacionCodigo`, y el token es de una sola
    // estación (el caso normal, sección 9.2.1), se usa esa por defecto — así
    // el integrador no tiene que repetir su propio código en cada request.
    const estacionCodigo = query.estacionCodigo ?? estacionUnicaDelToken(auth);

    // Autorización por estación (5.4) — nunca se confía en el query param:
    // si se resolvió una estación (explícita o por defecto), el token debe
    // tener acceso a ella.
    if (estacionCodigo !== undefined && !hasAccessToStation(auth, estacionCodigo)) {
      throw new AccesoDenegadoEstacionError(estacionCodigo);
    }

    const turno = validarTurno(query.turno);
    const estado = validarEstado(query.estado);
    const paginacion = normalizarPaginacion(query.page, query.pageSize);

    const resultado = await this.repo.listar(
      {
        estacionCodigo,
        fechaDesde: query.fechaDesde,
        fechaHasta: query.fechaHasta,
        turno,
        usuarioCodigo: query.usuarioCodigo,
        estado,
      },
      paginacion
    );

    return {
      data: resultado.data,
      pagination: construirPaginacion(paginacion, resultado.pagination.totalItems),
    };
  }
}

function validarTurno(valor?: string): Turno | undefined {
  if (valor === undefined) return undefined;
  if (!TURNOS_VALIDOS.includes(valor as Turno)) {
    throw new ParametrosInvalidosError('Parámetro "turno" inválido.', [
      { field: 'turno', issue: `debe ser uno de: ${TURNOS_VALIDOS.join(', ')}` },
    ]);
  }
  return valor as Turno;
}

function validarEstado(valor?: string): EstadoCierre {
  if (valor === undefined) return 'ACTIVO'; // default del contrato, sección 11
  if (valor !== 'ACTIVO' && valor !== 'ANULADO') {
    throw new ParametrosInvalidosError('Parámetro "estado" inválido.', [
      { field: 'estado', issue: 'debe ser ACTIVO o ANULADO' },
    ]);
  }
  return valor;
}
