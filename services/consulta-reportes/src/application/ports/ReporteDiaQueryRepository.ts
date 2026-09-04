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

/**
 * Un `cierres_turno` real, con su propio desglose por producto -- v1.62,
 * a pedido de Jorge ("apóyate de los cierres de turno que corresponden al
 * cierre de día"): el PDF de `GET /reportes/dia/documento` deja de mostrar
 * solo el total del día y pasa a mostrar, turno por turno, lo mismo que ya
 * ve el operador de estación en `GET /cierres-turno` -- mismo criterio de
 * "cierres_dia.total no se recalcula de detalle" (v1.59) aplicado acá:
 * `total` es el que reportó el POS al cerrar ESE turno, no una suma de
 * `productos`.
 */
export interface ReporteDiaTurnoDTO {
  readonly cierreTurnoId: string;
  readonly turno: 'TURNO1' | 'TURNO2' | 'TURNO3';
  /** `'(sin asignar)'` cuando el turno no tiene `usuario_id` -- no debería pasar en la práctica, pero `usuarios.estacion_id`/`usuario_id` en `cierres_turno` no son NOT NULL (ver 3.3). */
  readonly empleado: string;
  readonly fechaInicio: string;
  readonly fecha: string;
  readonly total: number;
  readonly productos: readonly ReporteDiaProductoDTO[];
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

  /**
   * Los `cierres_turno` ACTIVOS de una estación+fecha, ordenados por
   * `fecha_inicio`, cada uno con su propio desglose por producto (v1.62) --
   * usado solo por `ObtenerReporteDiaDocumento` para el PDF. Lista vacía
   * cuando no hubo ningún cierre de turno ese día (posible aunque exista un
   * `cierres_dia` para la fecha, si el POS mandó el cierre de día sin pasar
   * antes por cierres de turno individuales -- no se asume que siempre haya
   * al menos uno).
   */
  listarTurnos(filtros: FiltrosReporteDia): Promise<ReporteDiaTurnoDTO[]>;
}
