// application/ports/CompraIngestaRepository.ts
//
// Mismo criterio que los puertos de ingesta de cierres: el adaptador resuelve
// `codigoEstacion`→`estacion_id`, valida `productoId` contra el catálogo
// activo, y (ver nota abajo) valida `tanqueId` si se envía — todo dentro de
// la misma transacción que el INSERT.
//
// VALIDACIÓN AGREGADA, NO EXPLÍCITA EN EL DOCUMENTO: que `tanqueId` (cuando
// se envía) pertenezca a la MISMA estación que `codigoEstacion`. El DDL
// (sección 3.3) solo declara `tanque_id UUID REFERENCES tanques(id)` — la FK
// garantiza que el tanque exista, pero no que sea de la estación correcta.
// Sin este chequeo, una estación podría (por error de integración o de mala
// fe) registrar una compra apuntando al `tanqueId` de otra estación. Se
// aplica el mismo principio que ya rige para `productoId`/`empleado.codigo`
// en el resto del documento — queda señalado en el changelog para que lo
// confirmes.

export interface CompraOutputDTO {
  readonly id: string;
  readonly codigoEstacion: string;
  readonly tanqueId: string | null;
  readonly productoId: string;
  readonly proveedor: string | null;
  readonly fecha: string;
  readonly cantidad: number;
  readonly costoUnitario: number;
  readonly costoTotal: number;
  readonly numeroGuia: string | null;
  readonly creadoEn: string;
}

export interface DatosCompraAInsertar {
  readonly codigoEstacion: string;
  readonly tanqueId?: string | null;
  readonly productoId: string;
  readonly proveedor?: string | null;
  readonly fecha: string;
  readonly cantidad: number;
  readonly costoUnitario: number;
  readonly numeroGuia?: string | null;
}

export interface CompraIngestaRepository {
  /**
   * Lanza `ParametrosInvalidosError` si `codigoEstacion` no existe, si
   * `productoId` no está en el catálogo activo, o si `tanqueId` no existe o
   * pertenece a otra estación.
   */
  registrar(datos: DatosCompraAInsertar): Promise<CompraOutputDTO>;
}
