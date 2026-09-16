// application/ports/ReporteDiaDocumentoPorts.ts
//
// Puertos para el PDF de reporte de día (v1.60) -- variante de
// GET /v1/reportes/dia que en vez de devolver el reporte como JSON, lo sirve
// como PDF desde S3, con una URL firmada de corta duración (contrato
// acordado con notificaciones-whatsapp, fuera de este repo -- ver
// specs-notificaciones-whatsapp.md, que este repo NO modifica).
//
// v1.78 -- cambio de arquitectura a pedido de Jorge: el PDF deja de
// generarse en cada `GET /reportes/dia/documento` y pasa a generarse UNA
// VEZ, apenas se registra el cierre de día (evento `CierreDiaRegistrado`,
// caso de uso nuevo `GenerarReporteDiaDocumento`) -- el GET
// (`ObtenerReporteDiaDocumento`) ahora solo lee de S3. Por eso
// `DocumentoStoragePort` se separa en dos operaciones en vez de la única
// `subirYFirmar` de antes: `subir` (escritura pura, la usa el caso de uso
// de generación) y `obtenerUrlFirmada` (lectura + presign, la usa el GET;
// lanza `DocumentoNoEncontradoError` si la key no existe todavía en S3 --
// ver la nota grande en `ObtenerReporteDiaDocumento.ts` sobre por qué esto
// es un 404 y no un fallback a generar al vuelo).
//
// Igual que el resto de la arquitectura hexagonal (sección 5), estos
// puertos solo saben "renderizar" y "guardar"/"leer" -- nada de Cognito ni
// de Postgres.

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
 * todas las estaciones activas (v1.60; desde v1.78 se regenera cada vez que
 * cualquier estación registra su cierre de ese día -- ver
 * `GenerarReporteDiaDocumento`), cada una con su propio desglose por turno.
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

/**
 * Se lanza desde `obtenerUrlFirmada` cuando la key pedida no existe en S3
 * todavía (el cierre de día llegó pero `GenerarReporteDiaDocumento` no
 * terminó -- best effort, sección 4.1 -- o es un cierre de día anterior a
 * v1.78, sin PDF pre-generado y sin backfill). El caso de uso del GET la
 * traduce a `RecursoNoEncontradoError` (404) -- vive acá y no en
 * `@fuelhub/shared-kernel` porque es un detalle del adaptador de storage,
 * no un error de dominio compartido entre microservicios.
 */
export class DocumentoNoEncontradoError extends Error {
  constructor(public readonly key: string) {
    super(`No existe ningún documento en S3 bajo la key "${key}".`);
    this.name = 'DocumentoNoEncontradoError';
  }
}

export interface DocumentoStoragePort {
  /**
   * Sube `buffer` a S3 bajo `key`, sobrescribiendo lo que hubiera antes --
   * la usa `GenerarReporteDiaDocumento` (escritura pura, nadie lee esta
   * respuesta: la URL firmada se calcula después, en el momento del GET,
   * no en el momento de generar).
   */
  subir(params: { readonly buffer: Buffer; readonly key: string; readonly contentType: string }): Promise<void>;

  /**
   * Verifica que `key` exista en S3 y devuelve una URL PRESIGNADA de solo
   * lectura, válida por `expiraEnSegundos` -- sin autenticación adicional al
   * descargarla (restricción del contrato: WhatsApp Cloud API la pide
   * directo desde sus propios servidores, sin poder mandar headers custom).
   * Lanza `DocumentoNoEncontradoError` si `key` no existe.
   */
  obtenerUrlFirmada(params: { readonly key: string; readonly expiraEnSegundos: number }): Promise<DocumentoSubidoDTO>;
}
