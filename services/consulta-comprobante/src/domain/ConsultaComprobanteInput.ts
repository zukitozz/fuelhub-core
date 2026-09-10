// domain/ConsultaComprobanteInput.ts
//
// Validacion estructural pura de GET /v1/comprobantes/{numeracion}?ruc=... --
// espejo reducido de ComprobantePdfInput.ts (mismo par ruc+numeracion que
// arma la key de S3, ver S3ComprobantePdfStorageRepository.ts), pero de
// lectura: no hay contentBase64 que decodificar.
//
// v1.72, a pedido de Jorge: el proyecto nuevo fuelhub-comprobantes necesita
// poder buscar un comprobante por el mismo criterio ruc-serie-correlativo
// que ya usa la key de S3 desde v1.69 -- este servicio es el Lambda de
// lectura que la nota de la seccion 3.8.9 dejaba pendiente ("el Lambda de
// LECTURA que la futura pagina web de consulta de comprobantes va a
// necesitar").

import { ParametrosInvalidosError, type DetalleValidacion } from '@fuelhub/shared-kernel';

export interface ConsultaComprobanteInput {
  readonly ruc: string | undefined;
  readonly numeracion: string | undefined;
}

export interface NumeracionDescompuesta {
  readonly serie: string;
  readonly correlativo: string;
  /**
   * Heuristica a partir de la primera letra de la serie (F=Factura,
   * B=Boleta) -- SUNAT define mas tipos de comprobante (notas de
   * credito/debito, guias, etc.) que esta heuristica no cubre todavia; si
   * fuelhub-facturador empieza a mandar otras series, ajustar este mapeo
   * (o mejor: mandar tipoComprobante explicito como parte de la metadata
   * opcional que se agrega en v1.72 a ComprobantePdfInput.ts).
   */
  readonly tipoComprobante: 'FACTURA' | 'BOLETA' | 'DESCONOCIDO';
}

export interface ConsultaComprobanteValidado {
  readonly ruc: string;
  readonly numeracion: string;
  readonly descompuesta: NumeracionDescompuesta;
}

const RUC_REGEX = /^\d{11}$/;
const NUMERACION_REGEX = /^([A-Za-z0-9]{1,6})-(\d{1,15})$/;

export function validarConsultaComprobante(input: ConsultaComprobanteInput): ConsultaComprobanteValidado {
  const errores: DetalleValidacion[] = [];

  if (!input.ruc?.trim()) {
    errores.push({ field: 'ruc', issue: 'requerido (query string)' });
  } else if (!RUC_REGEX.test(input.ruc.trim())) {
    errores.push({ field: 'ruc', issue: 'debe tener 11 digitos (RUC SUNAT)' });
  }

  if (!input.numeracion?.trim()) {
    errores.push({ field: 'numeracion', issue: 'requerido (path)' });
  } else if (!NUMERACION_REGEX.test(input.numeracion.trim())) {
    errores.push({ field: 'numeracion', issue: 'formato esperado {serie}-{correlativo}, ej. F001-000123' });
  }

  if (errores.length > 0) {
    throw new ParametrosInvalidosError('El request no paso la validacion.', errores);
  }

  const ruc = input.ruc!.trim();
  const numeracion = input.numeracion!.trim();
  const match = NUMERACION_REGEX.exec(numeracion)!;
  const serie = match[1]!;
  const correlativo = match[2]!;
  const primeraLetra = serie.charAt(0).toUpperCase();
  const tipoComprobante = primeraLetra === 'F' ? 'FACTURA' : primeraLetra === 'B' ? 'BOLETA' : 'DESCONOCIDO';

  return { ruc, numeracion, descompuesta: { serie, correlativo, tipoComprobante } };
}
