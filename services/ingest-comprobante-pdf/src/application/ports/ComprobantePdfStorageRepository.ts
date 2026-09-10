// application/ports/ComprobantePdfStorageRepository.ts
//
// Puerto de storage para el PDF de un comprobante -- espejo reducido de
// CierreTurnoIngestaRepository (sin catálogo/empleado que resolver: la
// única operación real es "guardar estos bytes bajo esta key").

export interface ComprobantePdfGuardadoDTO {
  readonly key: string;
}

export interface ComprobantePdfStorageRepository {
  guardar(params: {
    readonly ruc: string;
    readonly numeracion: string;
    readonly buffer: Buffer;
  }): Promise<ComprobantePdfGuardadoDTO>;
}
