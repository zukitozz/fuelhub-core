// application/use-cases/ListarCompras.ts
//
// GET /compras (v1.67) -- mismo criterio de autorización que
// `ListarCierresTurno`/`ListarTanques`: si no viene `estacionCodigo`
// explícito, se usa la estación única del token cuando aplica (sección
// 5.4); si el caller manda una estación, o el token resuelve a varias, se
// valida contra `custom:station_scope` antes de tocar el repositorio.
//
// v1.82.2 -- `estado` deja de tener un default implícito ('ACTIVO'):
// pedido explícito de Jorge, `GET /compras` sin ningún parámetro `estado`
// ahora devuelve compras de CUALQUIER estado (ACTIVO, ANULADO,
// PENDIENTE_REVISION), no solo ACTIVO. Antes de este cambio, un caller que
// llamaba `/compras` a secas nunca veía las ANULADO/PENDIENTE_REVISION sin
// saber que tenía que pedirlas explícito -- confuso justo ahora que el
// Lambda de correo empieza a dejar compras en PENDIENTE_REVISION con
// regularidad. Si el caller SÍ quiere un estado puntual, sigue pudiendo
// pedirlo con `?estado=ACTIVO` como siempre -- este cambio solo afecta el
// comportamiento cuando el parámetro se omite del todo.

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
        estado, // undefined -- ver cabecera v1.82.2 -- retorna cualquier estado
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
//
// v1.82.2: ya NO hay default -- si `valor` viene undefined, se devuelve
// undefined (sin filtro de estado, ver cabecera del archivo), no 'ACTIVO'.
function validarEstado(valor?: string): EstadoCompra | undefined {
  if (valor === undefined) return undefined;
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
