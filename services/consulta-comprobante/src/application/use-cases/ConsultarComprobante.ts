// application/use-cases/ConsultarComprobante.ts
//
// Espejo de lectura de GuardarComprobantePdf.ts -- sin autorizacion por
// estacion, a diferencia de ese caso de uso: este endpoint es de cara al
// cliente final que busca su propio comprobante por ruc+serie+correlativo
// (spec original, seccion 7, "pagina web de consulta de comprobantes"), no
// una operacion interna de un grifo. El AuthContext que llega es el del
// cliente M2M propio de fuelhub-comprobantes (scope
// fuelhub-api/comprobantes.read), sin custom:station_scope relevante aca.

import { RecursoNoEncontradoError } from '@fuelhub/shared-kernel';
import { validarConsultaComprobante, type ConsultaComprobanteInput } from '../../domain/ConsultaComprobanteInput';
import type { ComprobanteLecturaRepository } from '../ports/ComprobanteLecturaRepository';

export interface ComprobanteConsultaResultado {
  readonly ruc: string;
  readonly numeracion: string;
  readonly serie: string;
  readonly correlativo: string;
  readonly tipoComprobante: string;
  readonly urlPdf: string;
  readonly urlXml?: string;
  readonly urlCdr?: string;
  readonly expiraEnSegundos: number;
  readonly fechaEmision?: string;
  readonly importeTotal?: number;
  readonly moneda?: string;
  readonly estadoSunat?: string;
}

export class ConsultarComprobante {
  constructor(private readonly repo: ComprobanteLecturaRepository) {}

  async ejecutar(input: ConsultaComprobanteInput): Promise<ComprobanteConsultaResultado> {
    const { ruc, numeracion, descompuesta } = validarConsultaComprobante(input);

    const encontrado = await this.repo.buscar({ ruc, numeracion });
    if (!encontrado) {
      throw new RecursoNoEncontradoError('Comprobante', `${ruc}/${numeracion}`);
    }

    return {
      ruc,
      numeracion,
      serie: descompuesta.serie,
      correlativo: descompuesta.correlativo,
      tipoComprobante: descompuesta.tipoComprobante,
      urlPdf: encontrado.urlPdf,
      urlXml: encontrado.urlXml,
      urlCdr: encontrado.urlCdr,
      expiraEnSegundos: encontrado.expiraEnSegundos,
      fechaEmision: encontrado.metadata.fechaEmision,
      importeTotal: encontrado.metadata.importeTotal,
      moneda: encontrado.metadata.moneda,
      estadoSunat: encontrado.metadata.estadoSunat,
    };
  }
}
