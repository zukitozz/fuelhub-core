// application/use-cases/ListarCompras.ts
//
// GET /compras (v1.67) -- mismo criterio de autorización que
// `ListarCierresTurno`/`ListarTanques`: si no viene `estacionCodigo`
// explícito, se usa la estación única del token cuando aplica (sección
// 5.4); si el caller manda una estación, o el token resuelve a varias, se
// valida contra `custom:station_scope` antes de tocar el repositorio.

import { AuthContext, estacionUnicaDelToken, hasAccessToStation } from '@fuelhub/shared-kernel';
import { AccesoDenegadoEstacionError, ParametrosInvalidosError, type CategoriaProducto, type EstadoCompra } from '@fuelhub/shared-kernel';
import { normalizarPaginacion, construirPaginacion, type ResultadoPaginado } from '../../domain/value-objects/Paginacion';
import type { CompraIngestaRepository, CompraResumenDTO } from '../ports/CompraIngestaRepository';

const CATEGORIAS_VALIDAS: readonly CategoriaProducto[] = ['COMBUSTIBLE', 'NO_COMBUSTIBLE'];

export interface ListarComprasQuery {
  readonly estacionCodigo?: string;
  readonly fechaDesde?: string;
  readonly fechaHasta?: string;
  readonly estado?: string;
  readonly productoId?: string;
  readonly categoria?: string;
  readonly page?: string;
  readonly pageSize?: string;
}

export class ListarCompras {
  constructor(private readonly repo: CompraIngestaRepository) {}

  async ejecutar(auth: AuthContext, query: ListarComprasQuery): Promise<ResultadoPaginado<CompraResumenDTO>> {
    const estacionCodigo = query.estacionCodigo ?? estacionUnicaDelToken(auth);

    if (estacionCodigo !== undefined && !hasAccessToStation(auth, estacionCodigo)) {
      throw new AccesoDenegadoEstacionError(estacionCodigo);
    }

    const estado = validarEstado(query.estado);
    const categoria = validarCategoria(query.categoria);
    const paginacion = normalizarPaginacion(query.page, query.pageSize);

    const resultado = await this.repo.listar(
      {
        estacionCodigo,
        fechaDesde: query.fechaDesde,
        fechaHasta: query.fechaHasta,
        estado,
        productoId: query.productoId,
        categoria,
      },
      paginacion
    );

    return {
      data: resultado.data,
      pagination: construirPaginacion(paginacion, resultado.pagination.totalItems),
    };
  }
}

const ESTADOS_VALIDOS: readonly EstadoCompra[] = ['ACTIVO', 'ANULADO', 'PENDIENTE_REVISION'];

// v1.81: acepta PENDIENTE_REVISION -- antes de la capacidad de lectura de
// facturas por correo, ningún flujo escribía ese estado, así que aceptarlo
// acá no tenía ningún efecto real (quedaba documentado como pendiente,
// nunca bloqueaba nada). Ahora sí hace falta: es como Jorge filtra las
// compras que el Lambda de correo dejó para que él revise
// (GET /compras?estado=PENDIENTE_REVISION).
function validarEstado(valor?: string): EstadoCompra {
  if (valor === undefined) return 'ACTIVO'; // default del contrato, mismo criterio que GET /cierres-turno
  if (!ESTADOS_VALIDOS.includes(valor as EstadoCompra)) {
    throw new ParametrosInvalidosError('Parámetro "estado" inválido.', [
      { field: 'estado', issue: `debe ser uno de: ${ESTADOS_VALIDOS.join(', ')}` },
    ]);
  }
  return valor as EstadoCompra;
}

function validarCategoria(valor?: string): CategoriaProducto | undefined {
  if (valor === undefined) return undefined;
  if (!CATEGORIAS_VALIDAS.includes(valor as CategoriaProducto)) {
    throw new ParametrosInvalidosError('Parámetro "categoria" inválido.', [
      { field: 'categoria', issue: `debe ser uno de: ${CATEGORIAS_VALIDAS.join(', ')}` },
    ]);
  }
  return valor as CategoriaProducto;
}
