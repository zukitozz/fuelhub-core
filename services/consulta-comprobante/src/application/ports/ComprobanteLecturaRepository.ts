// application/ports/ComprobanteLecturaRepository.ts
//
// Puerto de lectura -- contraparte de ComprobantePdfStorageRepository.ts
// (escritura). La unica operacion real es "buscar estos 3 posibles objetos
// bajo este prefijo y firmar los que existan".

export interface ComprobanteMetadataDTO {
  readonly fechaEmision?: string;
  readonly importeTotal?: number;
  readonly moneda?: string;
  readonly estadoSunat?: string;
}

export interface ComprobanteEncontradoDTO {
  readonly urlPdf: string;
  readonly urlXml?: string;
  readonly urlCdr?: string;
  readonly expiraEnSegundos: number;
  readonly metadata: ComprobanteMetadataDTO;
}

export interface ComprobanteLecturaRepository {
  /** Devuelve null si el PDF no existe bajo {ruc}/{numeracion}.pdf -- el caso de uso lo traduce a 404. */
  buscar(params: { readonly ruc: string; readonly numeracion: string }): Promise<ComprobanteEncontradoDTO | null>;
}
