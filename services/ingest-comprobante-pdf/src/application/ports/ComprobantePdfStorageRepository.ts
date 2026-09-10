// application/ports/ComprobantePdfStorageRepository.ts
//
// Puerto de storage para el PDF de un comprobante -- espejo reducido de
// CierreTurnoIngestaRepository (sin catalogo/empleado que resolver: la
// unica operacion real es "guardar estos bytes bajo esta key").
//
// v1.72: `guardar` ahora tambien recibe `metadata` (opcional, ver
// ComprobantePdfInput.ts) para que el adaptador la adjunte como S3 object
// metadata.

import type { ComprobanteMetadata } from '../../domain/ComprobantePdfInput';

export interface ComprobantePdfGuardadoDTO {
  readonly key: string;
}

export interface ComprobantePdfStorageRepository {
  guardar(params: {
    readonly ruc: string;
    readonly numeracion: string;
    readonly buffer: Buffer;
    readonly metadata: ComprobanteMetadata;
  }): Promise<ComprobantePdfGuardadoDTO>;
}
