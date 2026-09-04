// application/ports/ReporteDiaDocumentoPorts.ts
//
// Puertos para GET /v1/reportes/dia/documento (v1.60) -- variante de
// GET /v1/reportes/dia que en vez de devolver el reporte como JSON, lo
// renderiza como PDF, lo sube a S3, y devuelve una URL firmada de corta
// duración (contrato acordado con notificaciones-whatsapp, fuera de este
// repo -- ver specs-notificaciones-whatsapp.md, que este repo NO modifica).
// Igual que el resto de la arquitectura hexagonal (sección 5), la lógica de
// autorización/resolución de qué estación(es) reportar vive en el caso de
// uso (ObtenerReporteDiaDocumento) -- estos puertos solo saben "renderizar"
// y "guardar+firmar", nada de Cognito ni de Postgres.

import type { ReporteDiaDTO, ReporteDiaTurnoDTO } from './ReporteDiaQueryRepository';

/**
 * Una estación, para el PDF: su reporte del día (mismos totales que ya
 * devuelve GET /reportes/dia en JSON) + el desglose turno por turno (v1.62,
 * a pedido de Jorge -- "apóyate de los cierres de turno que corresponden al
 * cierre de día"). `turnos` puede venir vacío (día cerrado sin haber
 * pasado por cierres de turno individuales) sin que eso invalide `reporte`.
 */
export interface ReporteDiaEstacionDocumentoDTO {
  readonly reporte: ReporteDiaDTO;
  readonly turnos: readonly ReporteDiaTurnoDTO[];
}

/**
 * Lo que hay que renderizar: o el reporte de UNA estación (mismo caso que
 * GET /reportes/dia en JSON, con su desglose por turno), o el CONSOLIDADO de
 * varias (v1.60, solo alcanzable con un token cross-estación -- wildcard o
 * multi-estación explícito -- que no mandó estacionCodigo), cada una con su
 * propio desglose por turno.
 */
export type ReporteDiaDocumentoDatos =
  | { readonly modo: 'individual'; readonly estacion: ReporteDiaEstacionDocumentoDTO }
  | { readonly modo: 'consolidado'; readonly fechaNegocio: string; readonly estaciones: readonly ReporteDiaEstacionDocumentoDTO[] };

export interface ReporteDiaRendererPort {
  /** Devuelve el PDF ya armado, listo para subir tal cual a S3. */
  renderizarPdf(datos: ReporteDiaDocumentoDatos): Promise<Buffer>;
}

export interface DocumentoSubidoDTO {
  readonly url: string;
  readonly expiraEn: number;
}

export interface DocumentoStoragePort {
  /**
   * Sube `buffer` a S3 bajo `key` y devuelve una URL PRESIGNADA de solo
   * lectura, válida por `expiraEnSegundos` -- sin autenticación adicional al
   * descargarla (restricción del contrato: WhatsApp Cloud API la pide
   * directo desde sus propios servidores, sin poder mandar headers custom).
   */
  subirYFirmar(params: {
    readonly buffer: Buffer;
    readonly key: string;
    readonly contentType: string;
    readonly expiraEnSegundos: number;
  }): Promise<DocumentoSubidoDTO>;
}
