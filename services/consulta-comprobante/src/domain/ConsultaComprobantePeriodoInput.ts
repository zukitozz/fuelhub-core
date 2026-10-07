// domain/ConsultaComprobantePeriodoInput.ts
//
// Validacion estructural de GET /v1/comprobantes/consulta -- v1.79, pedido
// real de Jorge: sus clientes finales necesitan descargar TODAS sus
// facturas de un mes (no solo una por una, como ya permite
// ConsultaComprobanteInput.ts / GET /comprobantes/{numeracion}?ruc=...).
//
// `anio`+`mes` son SIEMPRE requeridos (decision explicita de Jorge, para
// acotar el tamano maximo de cualquier zip a como mucho un mes -- nunca se
// expone un listado "todo el anio" sin mes). `dia`+`serie`+`correlativo`
// son opcionales, pero si viene alguno de los 3 tienen que venir los 3
// juntos (lookup de UN comprobante puntual dentro del mes, misma key que
// arma S3ComprobantePdfStorageRepository.ts en ingest-comprobante-pdf).

import { ParametrosInvalidosError, type DetalleValidacion } from '@fuelhub/shared-kernel';

export interface ConsultaComprobantePeriodoInput {
  readonly rucEmisor: string | undefined;
  readonly numeroDocumentoReceptor: string | undefined;
  readonly anio: string | undefined;
  readonly mes: string | undefined;
  readonly dia?: string | undefined;
  readonly serie?: string | undefined;
  readonly correlativo?: string | undefined;
}

export interface ConsultaComprobantePeriodoValidado {
  readonly rucEmisor: string;
  readonly numeroDocumentoReceptor: string;
  readonly anio: string;
  readonly mes: string;
  /** Presente solo cuando `dia`+`serie`+`correlativo` vinieron los 3 juntos -- lookup de un solo comprobante en vez del mes completo. */
  readonly individual?: {
    readonly dia: string;
    readonly numeracion: string;
  };
}

const RUC_REGEX = /^\d{11}$/;
const ANIO_REGEX = /^\d{4}$/;
const MES_REGEX = /^(0[1-9]|1[0-2])$/;
const DIA_REGEX = /^(0[1-9]|[12]\d|3[01])$/;
const SERIE_REGEX = /^[A-Za-z0-9]{1,6}$/;
const CORRELATIVO_REGEX = /^\d{1,15}$/;

export function validarConsultaComprobantePeriodo(input: ConsultaComprobantePeriodoInput): ConsultaComprobantePeriodoValidado {
  const errores: DetalleValidacion[] = [];

  if (!input.rucEmisor?.trim()) {
    errores.push({ field: 'rucEmisor', issue: 'requerido (query string)' });
  } else if (!RUC_REGEX.test(input.rucEmisor.trim())) {
    errores.push({ field: 'rucEmisor', issue: 'debe tener 11 digitos (RUC SUNAT)' });
  }

  if (!input.numeroDocumentoReceptor?.trim()) {
    errores.push({ field: 'numeroDocumentoReceptor', issue: 'requerido (query string)' });
  }

  if (!input.anio?.trim()) {
    errores.push({ field: 'anio', issue: 'requerido (query string)' });
  } else if (!ANIO_REGEX.test(input.anio.trim())) {
    errores.push({ field: 'anio', issue: 'formato esperado YYYY' });
  }

  if (!input.mes?.trim()) {
    errores.push({ field: 'mes', issue: 'requerido (query string) -- no se permite listar un anio completo, acota por mes' });
  } else if (!MES_REGEX.test(input.mes.trim())) {
    errores.push({ field: 'mes', issue: 'formato esperado MM (01-12)' });
  }

  // dia/serie/correlativo: todos o ninguno -- lookup individual dentro del mes.
  const traeAlgunoIndividual = input.dia !== undefined || input.serie !== undefined || input.correlativo !== undefined;
  const traeTodosIndividual = input.dia !== undefined && input.serie !== undefined && input.correlativo !== undefined;

  if (traeAlgunoIndividual && !traeTodosIndividual) {
    errores.push({
      field: 'dia',
      issue: 'dia, serie y correlativo deben venir los 3 juntos (lookup de un comprobante puntual) o ninguno (listado del mes completo)',
    });
  } else if (traeTodosIndividual) {
    if (!DIA_REGEX.test(input.dia!.trim())) {
      errores.push({ field: 'dia', issue: 'formato esperado DD (01-31)' });
    }
    if (!SERIE_REGEX.test(input.serie!.trim())) {
      errores.push({ field: 'serie', issue: 'formato invalido' });
    }
    if (!CORRELATIVO_REGEX.test(input.correlativo!.trim())) {
      errores.push({ field: 'correlativo', issue: 'formato invalido' });
    }
  }

  if (errores.length > 0) {
    throw new ParametrosInvalidosError('El request no paso la validacion.', errores);
  }

  const resultado: ConsultaComprobantePeriodoValidado = {
    rucEmisor: input.rucEmisor!.trim(),
    numeroDocumentoReceptor: input.numeroDocumentoReceptor!.trim(),
    anio: input.anio!.trim(),
    mes: input.mes!.trim(),
  };

  if (traeTodosIndividual) {
    return {
      ...resultado,
      individual: {
        dia: input.dia!.trim(),
        numeracion: `${input.serie!.trim()}-${input.correlativo!.trim()}`,
      },
    };
  }

  return resultado;
}
