// application/ports/ReporteDiaQueryRepository.ts
//
// Puerto para `GET /v1/reportes/dia` (v1.58, gap identificado en v1.57 punto
// 2 del contrato con `notificaciones-whatsapp`). A diferencia de
// margen/abastecimiento (cross-estación, sin `estacionCodigo` obligatorio),
// este reporte es siempre de UNA estación y UN día puntual — el consumidor
// típico es el bot de WhatsApp reaccionando al evento `CierreDiaRegistrado`
// (que ya trae `estacionCodigo`+`fechaNegocio`, sección 4.1), no un listado.
//
// `totalCombustible`/`totalNoCombustible` son el campo que exige el
// contrato de `notificaciones-whatsapp` (v1.57) — ver `categoria` en
// `productos_maestro`/`cierres_turno_detalle` (migración 1788000000000).

import type { CategoriaProducto } from '@fuelhub/shared-kernel';

export interface ReporteDiaProductoDTO {
  /** `null` para líneas sin `productoId` (balón de gas, mercadito, etc. — sección 3.8.1.1). */
  readonly productoId: string | null;
  readonly producto: string;
  /**
   * `null` = "sin clasificar" — línea sin `productoId` cuyo cliente tampoco
   * mandó `categoria` explícita al registrar el cierre de turno (v1.58). No
   * es un valor adivinado; ver `totalSinClasificar` más abajo.
   */
  readonly categoria: CategoriaProducto | null;
  readonly cantidadVendida: number;
  readonly ingresos: number;
}

export interface ReporteDiaDTO {
  readonly estacionCodigo: string;
  readonly fechaNegocio: string;
  /** Id del `cierres_dia` real detrás de este reporte — mismo `cierreDiaId` que trae el evento `CierreDiaRegistrado`. */
  readonly cierreDiaId: string;
  /** `cierres_dia.total` — el total que reportó el POS al cerrar el día (sección 3.9), no un cálculo derivado de `detalle`. */
  readonly total: number;
  readonly totalCombustible: number;
  readonly totalNoCombustible: number;
  /** Suma de las líneas con `categoria` NULL — nunca se reparte a combustible/no-combustible por defecto (ver nota de `categoria` arriba). */
  readonly totalSinClasificar: number;
  readonly productos: readonly ReporteDiaProductoDTO[];
}

export interface FiltrosReporteDia {
  readonly estacionCodigo: string;
  readonly fechaNegocio: string;
}

export interface ReporteDiaQueryRepository {
  /** `null` cuando no existe un `cierres_dia` ACTIVO para esa estación+fecha (día aún no cerrado, o anulado). */
  obtener(filtros: FiltrosReporteDia): Promise<ReporteDiaDTO | null>;

  /**
   * Códigos de TODAS las estaciones activas (`estaciones.activo = true`),
   * sin relación con ningún token en particular -- usado solo por
   * `ObtenerReporteDiaDocumento` (v1.60) para resolver el reporte
   * CONSOLIDADO cuando el token que llama tiene `station_scope = '*'` y no
   * manda `estacionCodigo`: el claim wildcard no trae la lista de códigos en
   * sí, así que hay que resolverla contra la base. No lo usa `obtener` de
   * arriba ni ningún otro caso de uso existente.
   */
  listarCodigosEstacionesActivas(): Promise<string[]>;
}
