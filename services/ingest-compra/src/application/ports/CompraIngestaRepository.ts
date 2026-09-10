// application/ports/CompraIngestaRepository.ts
//
// Mismo criterio que los puertos de ingesta de cierres: el adaptador resuelve
// `codigoEstacion`→`estacion_id`, valida `productoId` contra el catálogo
// activo cuando viene, y valida cada `destino.tanqueId` (cuando viene) --
// todo dentro de la misma transacción que el INSERT/UPDATE.
//
// v1.65 -- `tanqueId` suelto (relación 1 compra = 1 tanque) se reemplaza por
// `destinos[]` (migración 1788200000000): una compra puede repartirse entre
// varios tanques, incluso de OTRA estación distinta a `codigoEstacion` (el
// caso de contingencia real que describió Jorge -- se factura a una
// estación pero parte del combustible va físicamente a otra). Por eso, a
// diferencia de la validación de `tanqueId` que existía hasta v1.64, el
// adaptador YA NO exige que el tanque de un destino pertenezca a la misma
// estación que la compra -- decisión explícita, ver el comentario de
// `PostgresCompraIngestaRepository.validarDestinos`.
//
// v1.66 -- se agrega `obtenerPorId`/`actualizar` (mismo patrón que
// `TanqueRepository`, admin-tanques): PUT parcial de una compra ya
// registrada -- corrige campos de la cabecera, reemplaza el reparto/entregas
// completo, y/o anula la compra (`estado`). `CambiosCompra` es el
// tipo de "parche" del adaptador (mismo criterio que `CambiosTanque` allá:
// separado del `CompraUpdateInput` del dominio aunque tengan la misma
// forma).
//
// v1.70 (migración 1788400000000_agrega-entregas-externas-compras.sql) --
// `CompraDestinoDTO` deja de ser SIEMPRE un `tanqueId`: un destino ahora es
// exactamente uno de `tanqueId` (tanque registrado) o `descripcionEntrega`
// (entrega externa en texto libre -- reventa/venta al menudeo fuera de los
// grifos del grupo, a pedido de Jorge). Ambos campos quedan opcionales/
// nullable en el DTO (mismo criterio que `productoId`/`productoNombre` en
// este mismo archivo: la forma del DTO espeja la del dominio
// `CompraDestinoInput`, así `RegistrarCompra`/`ActualizarCompra` pueden
// seguir pasando el input del dominio directo al puerto sin mapeo -- el
// adaptador es quien normaliza a "exactamente uno presente" al leer/escribir
// contra la base).
//
// `merma` es derivada (`cantidad - suma de destinos[].cantidad`), nunca se
// guarda como columna -- ver nota de cabecera de la migración 1788200000000.
// Viene en `null` cuando la compra no tiene ningún `destinos` registrado
// (p. ej. mercadería sin tanque). Con v1.70, una entrega externa cuenta
// exactamente igual que un tanque en esa suma -- la merma vuelve a
// significar "pérdida sin explicar", no "todo lo que no fue a un tanque
// propio" (ver nota de cabecera de `CompraInput.ts`).
//
// v1.67 -- se agrega `listar` (`GET /compras`, gap identificado al construir
// `specs-frontend-fuelhub-web.md` sección 8.1: el CRUD de compras no tenía
// forma de listar/buscar sin esto). Devuelve `CompraResumenDTO` -- mismos
// campos que `CompraOutputDTO` MENOS `destinos[]` (se omite en el listado
// por volumen, mismo criterio que `CierreTurnoResumenDTO` omite
// `detalle`/`pagos` -- el detalle completo se pide aparte con `GET
// /compras/{id}`, que reusa el `obtenerPorId` de arriba, ya existente desde
// v1.66 para el flujo interno de `actualizar`).

import type { CategoriaProducto, EstadoCierre } from '@fuelhub/shared-kernel';
import type { ParametrosPaginacion, ResultadoPaginado } from '../../domain/value-objects/Paginacion';

export interface CompraDestinoDTO {
  /** Tanque registrado destino del reparto. Exactamente uno de tanqueId/descripcionEntrega (v1.70). */
  readonly tanqueId?: string | null;
  /** Entrega externa en texto libre (reventa, venta al menudeo a granel) -- v1.70. */
  readonly descripcionEntrega?: string | null;
  readonly cantidad: number;
}

export interface CompraOutputDTO {
  readonly id: string;
  readonly codigoEstacion: string;
  /** `null` para compras fuera del catálogo cruzado (v1.65). */
  readonly productoId: string | null;
  readonly productoNombre: string;
  readonly categoria: CategoriaProducto | null;
  readonly proveedor: string | null;
  readonly fecha: string;
  readonly cantidad: number;
  readonly costoUnitario: number;
  readonly costoTotal: number;
  readonly numeroGuia: string | null;
  readonly destinos: readonly CompraDestinoDTO[];
  /** `cantidad - suma(destinos[].cantidad)` -- `null` si no hay ningún destino registrado (v1.66). */
  readonly merma: number | null;
  /** v1.66 -- `ANULADO` excluye la compra de reportes/stock (margen, abastecimiento). */
  readonly estado: EstadoCierre;
  readonly creadoEn: string;
}

/**
 * Forma resumida para `GET /compras` (v1.67) -- igual que `CompraOutputDTO`
 * pero sin `destinos[]` (mismo criterio que `CierreTurnoResumenDTO` frente a
 * `CierreTurnoDetalleCompleto`). Trae `merma`/`estado` porque son justo los
 * campos que un listado necesita mostrar sin abrir cada compra.
 */
export interface CompraResumenDTO {
  readonly id: string;
  readonly codigoEstacion: string;
  readonly productoId: string | null;
  readonly productoNombre: string;
  readonly categoria: CategoriaProducto | null;
  readonly proveedor: string | null;
  readonly fecha: string;
  readonly cantidad: number;
  readonly costoUnitario: number;
  readonly costoTotal: number;
  readonly numeroGuia: string | null;
  readonly merma: number | null;
  readonly estado: EstadoCierre;
  readonly creadoEn: string;
}

/** Filtros de `GET /compras` (v1.67) -- `estacionCodigo` ya resuelto/autorizado por el caso de uso (sección 5.4), igual que `FiltrosCierreTurno`. */
export interface FiltrosCompra {
  readonly estacionCodigo?: string;
  readonly fechaDesde?: string; // YYYY-MM-DD, sobre compras.fecha
  readonly fechaHasta?: string;
  readonly estado: EstadoCierre;
  readonly productoId?: string;
  readonly categoria?: CategoriaProducto;
}

export interface DatosCompraAInsertar {
  readonly codigoEstacion: string;
  readonly productoId?: string | null;
  readonly productoNombre?: string | null;
  readonly categoria?: CategoriaProducto | null;
  readonly proveedor?: string | null;
  readonly fecha: string;
  readonly cantidad: number;
  readonly costoUnitario: number;
  readonly numeroGuia?: string | null;
  readonly destinos?: readonly CompraDestinoDTO[];
}

/** PUT parcial (v1.66) -- ver nota de cabecera. `destinos`, cuando viene, reemplaza TODO el reparto/entregas existente. */
export interface CambiosCompra {
  readonly productoId?: string | null;
  readonly productoNombre?: string;
  readonly categoria?: CategoriaProducto | null;
  readonly proveedor?: string | null;
  readonly fecha?: string;
  readonly cantidad?: number;
  readonly costoUnitario?: number;
  readonly numeroGuia?: string | null;
  readonly destinos?: readonly CompraDestinoDTO[];
  readonly estado?: EstadoCierre;
}

export interface CompraIngestaRepository {
  /**
   * Lanza `ParametrosInvalidosError` si `codigoEstacion` no existe, si
   * `productoId` (cuando viene) no está en el catálogo activo, o si algún
   * `destinos[].tanqueId` (cuando viene) no existe o no está activo.
   */
  registrar(datos: DatosCompraAInsertar): Promise<CompraOutputDTO>;

  /** `undefined` si no existe ninguna compra con ese `id` (v1.66). */
  obtenerPorId(id: string): Promise<CompraOutputDTO | undefined>;

  /**
   * Lanza `RecursoNoEncontradoError` si `id` no existe, `ParametrosInvalidosError`
   * si `productoId` (cuando cambia) no está en el catálogo activo, si algún
   * `destinos[].tanqueId` (cuando viene) no existe/no está activo, o si la
   * suma de `destinos[].cantidad` supera la cantidad vigente de la compra (v1.66).
   */
  actualizar(id: string, cambios: CambiosCompra): Promise<CompraOutputDTO>;

  /** `GET /compras` (v1.67) -- listado paginado, filtros ya autorizados por el caso de uso. */
  listar(filtros: FiltrosCompra, paginacion: ParametrosPaginacion): Promise<ResultadoPaginado<CompraResumenDTO>>;
}
