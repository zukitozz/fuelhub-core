// application/ports/ComprobantePeriodoLecturaRepository.ts
//
// Puerto de lectura masiva (v1.79) -- contraparte de ComprobanteLecturaRepository.ts
// (que resuelve UN comprobante por ruc+numeracion contra la key vieja,
// {ruc}/{numeracion}.pdf). Este puerto trabaja contra la key nueva
// {ruc}/{numeroDocumentoReceptor}/{yyyy}/{mm}/{dd}/{numeracion}.pdf --
// listado por prefijo (ListObjectsV2), sin tabla Postgres de por medio (ver
// la nota de cabecera de ComprobantePdfInput.ts en ingest-comprobante-pdf).

export interface ComprobanteZipResultadoDTO {
  readonly url: string;
  readonly expiraEnSegundos: number;
  readonly cantidad: number;
}

export interface ComprobanteIndividualResultadoDTO {
  readonly url: string;
  readonly expiraEnSegundos: number;
}

export interface ComprobantePeriodoLecturaRepository {
  /** Devuelve null si no existe el PDF bajo esa key exacta. */
  buscarIndividual(params: {
    readonly rucEmisor: string;
    readonly numeroDocumentoReceptor: string;
    readonly anio: string;
    readonly mes: string;
    readonly dia: string;
    readonly numeracion: string;
  }): Promise<ComprobanteIndividualResultadoDTO | null>;

  /**
   * Arma un .zip con todos los comprobantes del mes y lo sube a S3 bajo una
   * key propia (no reutiliza el bucket de comprobantes para no mezclar
   * documentos SUNAT reales con archivos generados), devolviendo una URL
   * firmada de corta duración. Devuelve null si no hay NINGUN comprobante
   * para ese emisor+receptor+mes (el caso de uso lo traduce a 404).
   */
  buscarMasivo(params: {
    readonly rucEmisor: string;
    readonly numeroDocumentoReceptor: string;
    readonly anio: string;
    readonly mes: string;
  }): Promise<ComprobanteZipResultadoDTO | null>;
}
