// application/ports/ReporteTurnoDocumentoPorts.ts
//
// Puertos para el PDF de reporte de TURNO (v1.85) -- GET /v1/reportes/turno/documento,
// pedido nuevo de notificaciones-whatsapp (mismo contrato/mecanismo que ya
// usan para el reporte de día, ver ReporteDiaDocumentoPorts.ts, del que este
// archivo reusa `DocumentoStoragePort`/`DocumentoNoEncontradoError`/
// `DocumentoSubidoDTO` -- NO se duplican, es el mismo bucket/abstracción de
// S3, solo cambia el prefijo de la key, ver DocumentoReporteKey.ts).
//
// A diferencia de día, acá no existe un modo "consolidado" -- el pedido es
// explícito: "estacionCodigo es obligatorio en este endpoint (solo lo
// reciben administradores de una estación; el dueño no recibe cierres de
// turno)".

import type { ReporteDiaTurnoDTO } from './ReporteDiaQueryRepository';

export interface ReporteTurnoRendererPort {
  /**
   * Devuelve el PDF ya armado para UN turno puntual, listo para subir tal
   * cual a S3. `fechaNegocio` se pasa explícito (no se deriva de
   * `turno.fecha`/`fechaInicio`, que son TIMESTAMPTZ de hora real) porque un
   * turno que arranca de madrugada puede cruzar medianoche -- la fecha de
   * negocio asignada al cierre puede no coincidir con la fecha calendario de
   * esos timestamps, y es la misma `fechaNegocio` que ya se usó para
   * construir la key de S3 (ver DocumentoReporteKey.ts) y que viene en el
   * evento `CierreTurnoRegistrado`.
   */
  renderizarPdfTurno(estacionCodigo: string, fechaNegocio: string, turno: ReporteDiaTurnoDTO): Promise<Buffer>;
}
