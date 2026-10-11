// application/ports/ReporteComprasSemanalQueryRepository.ts
//
// Puerto de lectura para el reporte semanal de COMPRAS de combustible
// (v1.86) -- a diferencia de día/turno (que leen `cierres_turno_detalle`,
// venta real del POS), este lee la tabla `compras` -- corrección real de
// Jorge durante el diseño: el pedido original decía "ventas" pero la
// planilla de ejemplo que compartió era claramente de compras a PETROPERU
// (código SCOP, guía, placa, terminal de abastecimiento).
//
// Solo cuenta `compras.estado = 'ACTIVO'` -- un `ANULADO` no es una compra
// real, y una `PENDIENTE_REVISION` no tiene `categoria` confiable (puede
// no haber matcheado ningún producto del catálogo, ver
// `MatchearProducto.ts`), así que no se puede asegurar que sea combustible.
//
// La fecha base es `compras.fecha` (fecha de EMISIÓN de la factura, la
// única fecha que confirmamos que viene siempre en el XML de los
// proveedores -- ver sesión de diseño, v1.86) -- no hay "fecha de venta"
// ni "fecha de despacho" en ningún lado todavía.
export interface ReporteComprasSemanalItemDTO {
  readonly producto: string;
  readonly volumen: number;
}

/**
 * A diferencia de `listarCodigosEstacionesActivas` (día/consolidado, que
 * solo necesita el código para armar la key de S3), acá hace falta también
 * el `id` -- el evento `ReporteComprasSemanalRegistrado` lo exige
 * (`estacionId`, mismo campo que ya traen CierreDiaRegistrado/
 * CierreTurnoRegistrado) y, a diferencia de día/turno, no hay ningún INSERT
 * del que sacarlo.
 */
export interface EstacionActivaDTO {
  readonly id: string;
  readonly codigo: string;
}

export interface ReporteComprasSemanalQueryRepository {
  /**
   * Suma el volumen comprado por producto, para UNA estación, en el rango
   * `[fechaInicio, fechaFin]` (ambos inclusive, formato YYYY-MM-DD) --
   * filtrado a `categoria = 'COMBUSTIBLE'`. Devuelve `[]` si no hubo
   * ninguna compra de combustible esa semana -- el caso de uso igual genera
   * y manda el Excel en cero (decisión de Jorge: un reporte vacío confirma
   * "no hubo compras", en vez de que el administrador no reciba nada y no
   * sepa si fue un fallo del sistema).
   */
  obtenerVolumenesPorProducto(estacionCodigo: string, fechaInicio: string, fechaFin: string): Promise<readonly ReporteComprasSemanalItemDTO[]>;

  listarEstacionesActivas(): Promise<readonly EstacionActivaDTO[]>;
}
