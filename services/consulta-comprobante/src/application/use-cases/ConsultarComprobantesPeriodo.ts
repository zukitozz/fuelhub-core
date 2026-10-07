// application/use-cases/ConsultarComprobantesPeriodo.ts
//
// v1.79 -- espejo de ConsultarComprobante.ts, de cara al cliente final
// (mismo AuthContext M2M de fuelhub-comprobantes, scope
// fuelhub-api/comprobantes.read, sin custom:station_scope relevante aca).
// Dos modos segun lo que haya validado el dominio: individual (un
// comprobante puntual del mes) o masivo (zip del mes completo).

import { RecursoNoEncontradoError } from '@fuelhub/shared-kernel';
import {
  validarConsultaComprobantePeriodo,
  type ConsultaComprobantePeriodoInput,
} from '../../domain/ConsultaComprobantePeriodoInput';
import type { ComprobantePeriodoLecturaRepository } from '../ports/ComprobantePeriodoLecturaRepository';

export type ComprobantePeriodoResultado =
  | { readonly modo: 'individual'; readonly url: string; readonly expiraEnSegundos: number }
  | { readonly modo: 'masivo'; readonly url: string; readonly expiraEnSegundos: number; readonly cantidad: number };

export class ConsultarComprobantesPeriodo {
  constructor(private readonly repo: ComprobantePeriodoLecturaRepository) {}

  async ejecutar(input: ConsultaComprobantePeriodoInput): Promise<ComprobantePeriodoResultado> {
    const validado = validarConsultaComprobantePeriodo(input);

    if (validado.individual) {
      const { rucEmisor, numeroDocumentoReceptor, anio, mes } = validado;
      const { dia, numeracion } = validado.individual;
      const encontrado = await this.repo.buscarIndividual({ rucEmisor, numeroDocumentoReceptor, anio, mes, dia, numeracion });
      if (!encontrado) {
        throw new RecursoNoEncontradoError('Comprobante', `${rucEmisor}/${numeroDocumentoReceptor}/${anio}-${mes}-${dia}/${numeracion}`);
      }
      return { modo: 'individual', url: encontrado.url, expiraEnSegundos: encontrado.expiraEnSegundos };
    }

    const { rucEmisor, numeroDocumentoReceptor, anio, mes } = validado;
    const encontrado = await this.repo.buscarMasivo({ rucEmisor, numeroDocumentoReceptor, anio, mes });
    if (!encontrado) {
      throw new RecursoNoEncontradoError('Comprobantes', `${rucEmisor}/${numeroDocumentoReceptor}/${anio}-${mes}`);
    }
    return { modo: 'masivo', url: encontrado.url, expiraEnSegundos: encontrado.expiraEnSegundos, cantidad: encontrado.cantidad };
  }
}
