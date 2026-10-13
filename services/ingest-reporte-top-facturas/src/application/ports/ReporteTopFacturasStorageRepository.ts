// application/ports/ReporteTopFacturasStorageRepository.ts
//
// Puerto de storage del reporte -- guarda DOS objetos bajo la misma key
// base (ver construirKeyReporteTopFacturasJson/Excel, @fuelhub/shared-kernel):
// el JSON crudo (detalle completo, registro de auditoría) y el Excel ya
// renderizado (lo que sirve GET /reportes/top-facturas/documento en
// consulta-reportes -- ver la nota de cabecera de
// ReporteTopFacturasRendererPort.ts sobre por qué se agrega el Excel, v1.89).

import type { ClienteTopFacturasInput } from '../../domain/ReporteTopFacturasInput';

export interface ReporteTopFacturasGuardadoDTO {
  readonly key: string;
  readonly keyExcel: string;
}

export interface ReporteTopFacturasStorageRepository {
  guardar(params: {
    readonly codigoEstacion: string;
    readonly semanaInicio: string;
    readonly top: readonly ClienteTopFacturasInput[];
    readonly excelBuffer: Buffer;
  }): Promise<ReporteTopFacturasGuardadoDTO>;
}
