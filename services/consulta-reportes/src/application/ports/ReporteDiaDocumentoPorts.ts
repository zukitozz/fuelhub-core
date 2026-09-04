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

import type { ReporteDiaDTO } from './ReporteDiaQueryRepository';

/**
 * Lo que hay que renderizar: o el reporte de UNA estación (mismo caso que
 * GET /reportes/dia en JSON), o el CONSOLIDADO de varias (nuevo en v1.60,
 * solo alcanzable con un token cross-estación -- wildcard o multi-estación
 * explícito -- que no mandó estacionCodigo).
 */
export type ReporteDiaDocumentoDatos =
  | { readonly modo: 'individual'; readonly reporte: ReporteDiaDTO }
  | { readonly modo: 'consolidado'; readonly fechaNegocio: string; readonly reportes: readonly ReporteDiaDTO[] };

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
