// application/ports/ReporteComprasSemanalDocumentoPorts.ts
//
// Puerto de renderizado para el Excel del reporte semanal de compras
// (v1.86) -- reusa `DocumentoStoragePort`/`DocumentoNoEncontradoError`/
// `DocumentoSubidoDTO` de `ReporteDiaDocumentoPorts.ts` tal cual (mismo
// bucket/abstracción de S3, no hay nada día-específico en esos tipos --
// mismo criterio que ya aplica `ReporteTurnoDocumentoPorts.ts`).

export interface ReporteComprasSemanalItemParaExcel {
  readonly producto: string;
  readonly volumen: number;
}

export interface ReporteComprasSemanalRendererPort {
  /**
   * Arma el Excel, listo para subir tal cual a S3 -- una fila por producto
   * combustible, `fechaInicio`/`fechaFin` repetidos en cada fila (son el
   * rango de la semana reportada, no una fecha por compra individual -- ver
   * la nota de cabecera de `ReporteComprasSemanalQueryRepository.ts`).
   * `items` puede venir vacío (semana sin compras de combustible) -- igual
   * se genera el Excel, solo que sin filas de producto.
   */
  renderizarExcel(params: {
    readonly estacionCodigo: string;
    readonly fechaInicio: string;
    readonly fechaFin: string;
    readonly items: readonly ReporteComprasSemanalItemParaExcel[];
  }): Promise<Buffer>;
}
