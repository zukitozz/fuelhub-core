// application/ports/ReporteAbastecimientoQueryRepository.ts
//
// Puerto para `GET /v1/reportes/abastecimiento` (sección 3.8.2.c / 11.2).
// Forma de `ReporteAbastecimientoItemDTO` calcada del schema
// `ReporteAbastecimientoItem` del contrato OpenAPI.

export interface ReporteAbastecimientoItemDTO {
  readonly estacion: string;
  readonly tanque: string;
  readonly producto: string;
  readonly capacidad: number;
  /** `null` cuando no hay ventas del producto en los últimos 30 días (sin dato para estimar). */
  readonly ventaPromedioDiaria: number | null;
  /** `null` cuando no se puede calcular (sin `ventaPromedioDiaria`). */
  readonly diasDeAutonomiaEstimados: number | null;
  /** `null` cuando el tanque/producto no tiene aún 2 compras registradas (no hay intervalo que promediar). */
  readonly frecuenciaRealDias: number | null;
  readonly enRiesgo: boolean;
}

export interface FiltrosReporteAbastecimiento {
  readonly estacionCodigo?: string;
  /** Mismo criterio que en `FiltrosReporteMargen` — ver ese puerto. */
  readonly estacionesCodigos?: readonly string[];
}

export interface ReporteAbastecimientoQueryRepository {
  obtener(filtros: FiltrosReporteAbastecimiento): Promise<ReporteAbastecimientoItemDTO[]>;
}
