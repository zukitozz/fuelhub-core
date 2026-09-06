// application/ports/CompraIngestaRepository.ts
//
// Mismo criterio que los puertos de ingesta de cierres: el adaptador resuelve
// `codigoEstacion`→`estacion_id`, valida `productoId` contra el catálogo
// activo cuando viene, y valida cada `destino.tanqueId` -- todo dentro de
// la misma transacción que el INSERT/UPDATE.
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
// registrada -- corrige campos de la cabecera, reemplaza el reparto a
// tanques completo, y/o anula la compra (`estado`). `CambiosCompra` es el
// tipo de "parche" del adaptador (mismo criterio que `CambiosTanque` allá:
// separado del `CompraUpdateInput` del dominio aunque tengan la misma
// forma).
//
// `merma` es derivada (`cantidad - suma de destinos[].cantidad`), nunca se
// guarda como columna -- ver nota de cabecera de la migración 1788200000000.
// Viene en `null` cuando la compra no tiene ningún `destinos` registrado
// (p. ej. mercadería sin tanque) -- criterio unificado en v1.66: antes
// (v1.65) `registrar` distinguía "destinos ausente" de "destinos vacío", una
// distinción que ningún cliente real iba a producir a propósito y que
// `obtenerPorId`/`actualizar` no pueden replicar (leen filas de
// `compras_abastecimientos`, no lo que vino en el request) -- ahora los tres
// métodos usan la misma regla: sin filas = `null`, con filas = calculada.

import type { CategoriaProducto, EstadoCierre } from '@fuelhub/shared-kernel';

export interface CompraDestinoDTO {
  readonly tanqueId: string;
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

/** PUT parcial (v1.66) -- ver nota de cabecera. `destinos`, cuando viene, reemplaza TODO el reparto existente. */
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
   * `destinos[].tanqueId` no existe o no está activo.
   */
  registrar(datos: DatosCompraAInsertar): Promise<CompraOutputDTO>;

  /** `undefined` si no existe ninguna compra con ese `id` (v1.66). */
  obtenerPorId(id: string): Promise<CompraOutputDTO | undefined>;

  /**
   * Lanza `RecursoNoEncontradoError` si `id` no existe, `ParametrosInvalidosError`
   * si `productoId` (cuando cambia) no está en el catálogo activo, si algún
   * `destinos[].tanqueId` no existe/no está activo, o si la suma de
   * `destinos[].cantidad` supera la cantidad vigente de la compra (v1.66).
   */
  actualizar(id: string, cambios: CambiosCompra): Promise<CompraOutputDTO>;
}
