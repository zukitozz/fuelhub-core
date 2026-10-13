// application/ports/ReporteTopFacturasStorageRepository.ts
//
// Puerto de storage del JSON del reporte -- unica operacion real es "guardar
// este reporte bajo su key estable" (ver ReporteTopFacturasKey.ts).

import type { ClienteTopFacturasInput } from '../../domain/ReporteTopFacturasInput';

export interface ReporteTopFacturasGuardadoDTO {
  readonly key: string;
}

export interface ReporteTopFacturasStorageRepository {
  guardar(params: {
    readonly codigoEstacion: string;
    readonly semanaInicio: string;
    readonly top: readonly ClienteTopFacturasInput[];
  }): Promise<ReporteTopFacturasGuardadoDTO>;
}
