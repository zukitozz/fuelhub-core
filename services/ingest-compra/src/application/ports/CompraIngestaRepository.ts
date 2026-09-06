// application/ports/CompraIngestaRepository.ts
//
// Mismo criterio que los puertos de ingesta de cierres: el adaptador resuelve
// `codigoEstacion`→`estacion_id`, valida `productoId` contra el catálogo
// activo cuando viene, y valida cada `destino.tanqueId` -- todo dentro de
// la misma transacción que el INSERT.
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
// `merma` es derivada (`cantidad - suma de destinos[].cantidad`), nunca se
// guarda como columna -- ver nota de cabecera de la migración. Viene en
// `null` cuando la compra no trae `destinos` (p. ej. mercadería sin tanque).

import type { CategoriaProducto } from '@fuelhub/shared-kernel';

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
  /** `cantidad - suma(destinos[].cantidad)` -- `null` si no se mandó `destinos` (v1.65). */
  readonly merma: number | null;
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

export interface CompraIngestaRepository {
  /**
   * Lanza `ParametrosInvalidosError` si `codigoEstacion` no existe, si
   * `productoId` (cuando viene) no está en el catálogo activo, o si algún
   * `destinos[].tanqueId` no existe o no está activo.
   */
  registrar(datos: DatosCompraAInsertar): Promise<CompraOutputDTO>;
}
