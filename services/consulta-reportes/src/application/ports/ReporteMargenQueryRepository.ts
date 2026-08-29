// application/ports/ReporteMargenQueryRepository.ts
//
// Puerto para `GET /v1/reportes/margen` (sección 3.8.2.b / 11.2). Forma de
// `ReporteMargenItemDTO` calcada del schema `ReporteMargenItem` del contrato
// OpenAPI (adjunto aparte) — solo lo usa este Lambda, así que no hace falta
// centralizarlo en `@fuelhub/shared-kernel` (criterio fijado en el bug de
// `consulta-cierre-detalle`, sección 4.1: se centraliza cuando el mismo DTO
// lo consumen varios Lambdas independientes, no antes).

export interface ReporteMargenItemDTO {
  readonly estacion: string;
  readonly ingresosTotales: number;
  readonly costoVentasEstimado: number;
  readonly margenEstimado: number;
}

export interface FiltrosReporteMargen {
  /** Filtro exacto por una estación puntual (ya autorizado contra el token). */
  readonly estacionCodigo?: string;
  /**
   * Restricción a la lista de estaciones permitidas del token (sección 5.4,
   * `estacionesPermitidasDelToken`) — se usa solo cuando NO se pidió
   * `estacionCodigo` puntual y el token no es wildcard ('*'). `undefined`
   * significa "sin restricción adicional" (token wildcard, o ya se filtró
   * por `estacionCodigo`).
   */
  readonly estacionesCodigos?: readonly string[];
  readonly fechaDesde?: string;
  readonly fechaHasta?: string;
}

export interface ReporteMargenQueryRepository {
  obtener(filtros: FiltrosReporteMargen): Promise<ReporteMargenItemDTO[]>;
}
