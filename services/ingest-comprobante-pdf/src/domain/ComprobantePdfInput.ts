// domain/ComprobantePdfInput.ts
//
// Sin dependencias de AWS -- validacion puramente estructural del payload de
// PUT /v1/comprobantes/{numeracion}/pdf (spec pegado por Jorge). Valida Y
// decodifica el base64 en un solo paso (evita decodificar dos veces en el
// caso de uso).
//
// v1.69: se agrega ruc al contrato del spec original -- Jorge pidio
// explicitamente poder ubicar comprobantes por el criterio combinado
// "ruc-serie-correlativo" (el identificador estandar SUNAT de un
// comprobante electronico), y el spec pegado no traia ruc en ningun lado
// (solo codigoEstacion, que es un identificador interno de FuelHub, no
// necesariamente 1:1 con el RUC del emisor). Se agrega como campo requerido
// del payload -- fuelhub-facturador ya lo conoce (todo comprobante SUNAT
// lleva el RUC del emisor embebido en su propio XML), asi que no hace falta
// ningun lookup nuevo del lado del daemon. La key de S3 pasa a construirse
// con ruc, no con codigoEstacion (ver S3ComprobantePdfStorageRepository.ts)
// -- codigoEstacion se sigue exigiendo y validando igual, pero solo para la
// autorizacion por estacion (seccion 5.4), nunca para la key de storage.
//
// v1.69: tambien se corrige MAX_PDF_BYTES -- el spec pegado proponia 8 MB
// "bien por debajo" del limite duro de 10 MB de API Gateway REST, pero un
// PDF de 8 MB codificado en base64 pesa 8 * 4/3 ~ 10.67 MB, que YA SUPERA
// ese limite (antes de sumar el overhead del JSON envolvente). Se baja a
// 7 MB decodificados (~9.33 MB en base64, con margen de sobra).
//
// v1.72, a pedido de Jorge (para que el nuevo proyecto fuelhub-comprobantes
// pueda mostrar mas que solo el PDF): se agregan 4 campos OPCIONALES --
// fechaEmision/importeTotal/moneda/estadoSunat. `fuelhub-facturador` (otro
// repo, fuera de alcance de esta sesion) todavia no los manda -- si no
// vienen, el comprobante se guarda igual, y consulta-comprobante (lectura)
// simplemente no tiene esos datos para mostrar. Se guardan como S3 object
// metadata (ver S3ComprobantePdfStorageRepository.ts), no en una tabla
// nueva de Postgres: la key ya es 100% derivable de ruc+numeracion, asi que
// no hace falta nada consultable por indice -- HeadObject alcanza.

import { ParametrosInvalidosError, type DetalleValidacion } from '@fuelhub/shared-kernel';

export interface ComprobantePdfInput {
  readonly codigoEstacion: string;
  readonly ruc: string;
  readonly contentBase64: string;
  readonly fechaEmision?: string;
  readonly importeTotal?: number;
  readonly moneda?: string;
  readonly estadoSunat?: string;
}

/** Metadata opcional del comprobante, ya validada y normalizada (v1.72). */
export interface ComprobanteMetadata {
  readonly fechaEmision?: string;
  readonly importeTotal?: number;
  readonly moneda?: string;
  readonly estadoSunat?: string;
}

export interface ComprobantePdfValidado {
  readonly buffer: Buffer;
  readonly metadata: ComprobanteMetadata;
}

export const MAX_PDF_BYTES = 7 * 1024 * 1024; // 7 MB decodificados -- ver nota de cabecera sobre el limite de API Gateway

const RUC_REGEX = /^\d{11}$/;
const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MONEDAS_VALIDAS = new Set(['PEN', 'USD']);

/**
 * Valida estructuralmente el input Y decodifica el base64, devolviendo el
 * Buffer ya validado junto con la metadata opcional normalizada (evita
 * decodificar dos veces en el caso de uso). Lanza ParametrosInvalidosError
 * (mismo shape que el resto del proyecto).
 */
export function validarYDecodificarComprobantePdf(
  input: ComprobantePdfInput,
  numeracion: string | undefined
): ComprobantePdfValidado {
  const errores: DetalleValidacion[] = [];

  if (!numeracion?.trim()) {
    errores.push({ field: 'numeracion', issue: 'requerido en el path' });
  }
  if (!input.codigoEstacion?.trim()) {
    errores.push({ field: 'codigoEstacion', issue: 'requerido' });
  }
  if (!input.ruc?.trim()) {
    errores.push({ field: 'ruc', issue: 'requerido' });
  } else if (!RUC_REGEX.test(input.ruc.trim())) {
    errores.push({ field: 'ruc', issue: 'debe tener 11 digitos (RUC SUNAT)' });
  }
  if (!input.contentBase64?.trim()) {
    errores.push({ field: 'contentBase64', issue: 'requerido' });
  }

  // v1.72: campos opcionales -- solo se validan si vienen, nunca bloquean
  // el guardado del PDF si estan ausentes.
  let fechaEmision: string | undefined;
  if (input.fechaEmision !== undefined && input.fechaEmision !== null) {
    const valor = String(input.fechaEmision).trim();
    if (!FECHA_REGEX.test(valor)) {
      errores.push({ field: 'fechaEmision', issue: 'debe tener formato YYYY-MM-DD' });
    } else {
      fechaEmision = valor;
    }
  }

  let importeTotal: number | undefined;
  if (input.importeTotal !== undefined && input.importeTotal !== null) {
    if (typeof input.importeTotal !== 'number' || !Number.isFinite(input.importeTotal) || input.importeTotal < 0) {
      errores.push({ field: 'importeTotal', issue: 'debe ser un numero >= 0' });
    } else {
      importeTotal = input.importeTotal;
    }
  }

  let moneda: string | undefined;
  if (input.moneda !== undefined && input.moneda !== null) {
    const valor = String(input.moneda).trim().toUpperCase();
    if (!MONEDAS_VALIDAS.has(valor)) {
      errores.push({ field: 'moneda', issue: 'debe ser PEN o USD' });
    } else {
      moneda = valor;
    }
  }

  let estadoSunat: string | undefined;
  if (input.estadoSunat !== undefined && input.estadoSunat !== null) {
    const valor = String(input.estadoSunat).trim();
    if (valor.length === 0) {
      errores.push({ field: 'estadoSunat', issue: 'no puede ser una cadena vacia si se envia' });
    } else {
      estadoSunat = valor;
    }
  }

  if (errores.length > 0) {
    throw new ParametrosInvalidosError('El payload no paso la validacion.', errores);
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(input.contentBase64, 'base64');
  } catch {
    throw new ParametrosInvalidosError('contentBase64 no es base64 valido.', [
      { field: 'contentBase64', issue: 'base64 malformado' },
    ]);
  }

  if (buffer.length === 0) {
    throw new ParametrosInvalidosError('El PDF decodificado esta vacio.', [
      { field: 'contentBase64', issue: 'vacio tras decodificar' },
    ]);
  }
  if (buffer.length > MAX_PDF_BYTES) {
    throw new ParametrosInvalidosError(`El PDF supera el maximo de ${MAX_PDF_BYTES} bytes.`, [
      { field: 'contentBase64', issue: `${buffer.length} bytes, maximo ${MAX_PDF_BYTES}` },
    ]);
  }
  // Firma minima de un PDF valido -- no es un parser completo, solo evita
  // subir basura arbitraria a S3 bajo pretexto de "PDF".
  if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new ParametrosInvalidosError('El contenido no es un PDF valido.', [
      { field: 'contentBase64', issue: 'no empieza con la firma %PDF-' },
    ]);
  }

  return { buffer, metadata: { fechaEmision, importeTotal, moneda, estadoSunat } };
}
